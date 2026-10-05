"""Deterministic chakra scoring. NO LLM is involved anywhere in this module.

Pipeline per chakra (PDF Parts 32-47):
  evidence -> KB association (chakra / state / strength) -> contribution
  (strength x intensity x reliability) -> collapse correlated evidence into
  independent units -> diminishing-returns aggregation -> presence gate ->
  direction (separately) -> status.

Design rules enforced here (each has a test in tests/unit/test_scoring_spec.py):
  * A chakra is BALANCED only after adequate assessment. "Not assessed" is UNRESOLVED.
  * Presence and direction are different questions (never presence = def + exc).
  * The same underlying observation is scored once, however often it is repeated.
  * Negative / historical / unresolved / unscored evidence never adds to a score.
  * Missing severity is never invented: the item is listed as a pending detail
    (which triggers a deep-dive question) and contributes nothing until answered.
  * Source states that are not exactly Deficient/Excess ("Either", "Varies",
    "Conflicted", "Excess to Deficient", ...) add PRESENCE only. They are never
    reinterpreted into a direction.
  * All numeric thresholds are ENGINEERING BASELINES, configurable, and reported
    in the audit block with clinically_validated = False.
"""
from __future__ import annotations

import logging
from collections import defaultdict

from app.core.enums import EvidenceStatus
from app.knowledge.indicator_repository import IndicatorRepository
from app.models.chakra import ChakraReport, ChakraResult, TraceItem

DEFAULT_STRENGTH = {"Strong": 1.0, "Medium": 0.6, "Weak": 0.3}
DEFAULT_INTENSITY = {"Mild": 0.4, "Moderate": 0.7, "Severe": 1.0}
DEFAULT_RELIABILITY = {"Confirmed": 1.0, "Resolved After Clarification": 1.0, "Provisional": 0.4,
                       "Unresolved": 0.0, "Historical": 0.0, "NEGATIVE": 0.0}
DEFAULT_CONFIDENCE_WEIGHTS = {"coverage": 0.30, "consistency": 0.30, "resolution": 0.25, "completeness": 0.15}
DIRECTIONS = ("Deficient", "Excess")

STATUS_LABELS = {
    "BALANCED": "Balanced",
    "IMBALANCED_DEFICIENT": "Imbalanced — Deficient",
    "IMBALANCED_EXCESS": "Imbalanced — Excess",
    "IMBALANCED_DIRECTION_UNRESOLVED": "Imbalanced — Direction unresolved",
    "CONFLICTED": "Conflicted — Deficient and Excess",
    "UNRESOLVED": "Unresolved",
}


def band(score: float) -> str:
    return "minimal" if score < .20 else "mild" if score < .45 else "moderate" if score < .70 else "severe"


def confidence_label(pct: float) -> str:
    return "High" if pct >= 80 else "Moderate" if pct >= 60 else "Low"


class ScoringEngine:
    def __init__(self, kb):
        from app.core.config import settings
        cfg = kb.scoring_config or {}
        self.kb = kb
        self.strength = cfg.get("strength_weights", DEFAULT_STRENGTH)
        self.intensity = cfg.get("intensity_weights", DEFAULT_INTENSITY)
        self.reliability = cfg.get("reliability_weights", DEFAULT_RELIABILITY)
        self.conf_weights = (cfg.get("confidence") or {}).get("weights") or DEFAULT_CONFIDENCE_WEIGHTS
        direction = cfg.get("direction", {})
        self.meaningful_threshold = float(direction.get("meaningful_threshold", 0.2))
        # Meaningful directional evidence is the only numeric imbalance gate.
        # Confidence and coverage describe support, but cannot block a result.
        self.imbalance_threshold = self.meaningful_threshold
        self.dominance_ratio = 1.20
        self.insufficient_score_threshold = float(settings.insufficient_score_threshold)
        self.high_priority_single = float(settings.high_priority_single_score)
        self.balanced_min_quadrants = int(settings.balanced_min_assessed_quadrants)
        self.repo = IndicatorRepository(kb)
        self.chakras = kb.chakra_names
        self.n_quadrants = max(1, len(getattr(kb, "quadrants", []) or []) or 10)

    # ------------------------------------------------------------------ helpers
    def _reliability_weight(self, status_value: str) -> float:
        for key in (status_value, status_value.replace("_", " ").title()):
            if key in self.reliability:
                return float(self.reliability[key])
        return float(DEFAULT_RELIABILITY.get(status_value, 0.0))

    @staticmethod
    def _combine(values):
        """Diminishing returns: combined = combined + new * (1 - combined)."""
        combined = 0.0
        for value in sorted(values, reverse=True):
            combined += value * (1 - combined)
        return combined

    @staticmethod
    def _kind(ev) -> str:
        if getattr(ev, "superseded", False):
            return "superseded"
        if ev.polarity == "negative" or ev.status == EvidenceStatus.NEGATIVE:
            return "negative"
        if ev.currentness == "historical" or ev.status == EvidenceStatus.HISTORICAL:
            return "historical"
        if ev.polarity == "positive" and ev.currentness == "current":
            return "scorable"
        return "unscored"          # neutral/uncertain polarity or unknown currentness

    def _associations(self, ev, chakra):
        """KB records for this evidence + chakra. All associations are kept; a therapist
        clarification (Resolved After Clarification) is the only thing that narrows them."""
        records = [i for i in self.repo.get_by_id(ev.canonical_indicator_id) if i.chakra == chakra]
        if ev.status == EvidenceStatus.RESOLVED_AFTER_CLARIFICATION and ev.selected_chakra:
            records = [i for i in records if i.chakra == ev.selected_chakra]
        return records

    @staticmethod
    def _quote(ev, responses):
        if getattr(ev, "quote", None):
            return ev.quote
        text = (responses or {}).get(ev.response_id)
        return (text[:240] + "…") if text and len(text) > 240 else text

    # ---------------------------------------------------------------- confidence
    def _confidence(self, relevant, contradicted, n_assessed):
        w = self.conf_weights
        coverage = min(1.0, n_assessed / self.n_quadrants)
        if not relevant:
            # KB correction: no relevant evidence => Low. Never award consistency /
            # resolution / completeness for having found nothing.
            return round(100 * w["coverage"] * coverage, 2), coverage
        consistency = 0.0 if contradicted else 1.0
        resolved = [e for e in relevant if e.status in (EvidenceStatus.CONFIRMED,
                                                          EvidenceStatus.RESOLVED_AFTER_CLARIFICATION)]
        resolution = len(resolved) / len(relevant)

        def completeness_of(e):
            parts = [bool(e.intensity), bool(e.frequency or e.duration), bool(e.context or e.trigger or e.impact)]
            return sum(parts) / 3.0
        completeness = sum(completeness_of(e) for e in relevant) / len(relevant)
        pct = 100 * (w["coverage"] * coverage + w["consistency"] * consistency
                     + w["resolution"] * resolution + w["completeness"] * completeness)
        return round(pct, 2), coverage

    # --------------------------------------------------------------------- score
    def score(self, evidence, *, contradictions=None, assessed_quadrants=None, responses=None,
              assessment_context=None):
        contradictions = contradictions or []
        assessed = set(assessed_quadrants or [])
        n_assessed = len(assessed)
        adequately_assessed = n_assessed >= self.balanced_min_quadrants
        evidence = list(evidence or [])
        results = []
        if assessment_context is not None:
            logging.getLogger("anahat.scoring").info(
                "FINAL SCORER RECEIVED COMPLETE CONTEXT: demographics=%s baseline=%s opening_responses=%s "
                "selected_quadrants=%s completed_quadrants=%s responses=%s evidence=%s",
                assessment_context.get("demographics"), assessment_context.get("baseline"),
                len(assessment_context.get("opening_responses") or []),
                assessment_context.get("selected_quadrants"), assessment_context.get("completed_quadrants"),
                len(assessment_context.get("responses") or []), len(assessment_context.get("evidence") or []),
            )

        mapping_diagnostics = []
        for ev in evidence:
            canonical_id = ev.canonical_indicator_id
            mapped = [chakra for chakra in self.chakras
                      if any(item.chakra == chakra for item in self.repo.get_by_id(canonical_id))]
            if mapped:
                mapping_reason = "canonical indicator has chakra associations"
            elif not canonical_id:
                mapping_reason = "no canonical indicator ID was attached to this evidence"
            elif not self.repo.get_by_id(canonical_id):
                mapping_reason = "canonical indicator ID is absent from the loaded indicator knowledge base"
            else:
                mapping_reason = "canonical indicator has no association to a configured chakra"
            mapping_diagnostics.append({
                "evidence_id": ev.evidence_id, "label": ev.indicator_term,
                "canonical_indicator_id": canonical_id, "mapped_chakras": mapped,
                "mapping_reason": mapping_reason, "status": ev.status.value,
                "polarity": ev.polarity, "currentness": ev.currentness,
                "intensity": ev.intensity, "superseded": ev.superseded,
            })
        logging.getLogger("anahat.scoring").info(
            "FINAL EVIDENCE -> CHAKRA MAPPING: %s", mapping_diagnostics
        )
        logging.getLogger("anahat.scoring").info(
            "IMBALANCE GATE CONFIG: directional_threshold=%s dominance_ratio=%s "
            "additional_blocking_conditions=%s confidence_role=%s coverage_role=%s",
            self.meaningful_threshold, self.dominance_ratio,
            "none beyond eligible current confirmed/resolved evidence and chakra/direction mapping",
            "reported after status; not a gate", "confidence component only; not a gate",
        )

        for chakra in self.chakras:
            trace: list[TraceItem] = []
            negative, historical, unresolved, nondirectional = [], [], [], []
            pending: list[dict] = []
            relevant = []                       # scorable items linked to this chakra
            contradicted = any(c.get("chakra") == chakra for c in contradictions)
            polarity_conflict = any(c.get("chakra") == chakra and c.get("type") == "polarity"
                                    for c in contradictions)

            for ev in evidence:
                kind = self._kind(ev)
                assoc = self._associations(ev, chakra)
                if not assoc or kind == "superseded":
                    continue
                if kind == "negative":
                    negative.append(ev.evidence_id); continue
                if kind == "historical":
                    historical.append(ev.evidence_id); continue
                if kind == "unscored":
                    unresolved.append(ev.evidence_id); continue

                ind = next((item for item in assoc if item.state_raw in DIRECTIONS), None)
                if ind is None or ev.status not in (EvidenceStatus.CONFIRMED,
                                                     EvidenceStatus.RESOLVED_AFTER_CLARIFICATION):
                    continue
                if not ev.intensity:
                    pending.append({"evidence_id": ev.evidence_id, "indicator": ev.indicator_term,
                                    "missing": ["intensity"]})
                    unresolved.append(ev.evidence_id)
                    continue
                relevant.append(ev)
                sw = float(self.strength.get(ind.association_rating, 0.0))
                iw_raw = self.intensity.get(ev.intensity)
                rw = self._reliability_weight(ev.status.value)
                note = None
                if rw == 0.0:
                    unresolved.append(ev.evidence_id); note = "unresolved: contributes 0 until clarified"
                iw = float(iw_raw)
                contribution = round(sw * iw * rw, 6)
                directional = ind.state_raw in DIRECTIONS
                if not directional:
                    nondirectional.append(ev.evidence_id)
                trace.append(TraceItem(
                    evidence_id=ev.evidence_id, response_id=ev.response_id, quote=self._quote(ev, responses),
                    indicator_id=ev.canonical_indicator_id, term=ev.indicator_term or ind.term, domain=ind.domain,
                    kb_state=ind.state_raw, directional=directional, strength=ind.association_rating,
                    strength_weight=sw, intensity=ev.intensity, intensity_weight=iw_raw,
                    evidence_status=ev.status.value, reliability_weight=rw, contribution=contribution, note=note))

            # ---- collapse correlated evidence: one underlying observation = one unit
            by_group: dict[str, list[int]] = defaultdict(list)
            ev_by_id = {e.evidence_id: e for e in evidence}
            for idx, t in enumerate(trace):
                e = ev_by_id[t.evidence_id]
                by_group[e.correlation_group or self.repo.group_key(e.canonical_indicator_id)].append(idx)
            presence_vals, dir_vals = [], {d: [] for d in DIRECTIONS}
            counted_groups = 0
            for group, idxs in by_group.items():
                best = max(idxs, key=lambda i: (trace[i].contribution, trace[i].evidence_id))
                for i in idxs:
                    if i != best:
                        trace[i].note = ((trace[i].note + "; ") if trace[i].note else "") + \
                            "same underlying observation as another item: counted once"
                if trace[best].contribution > 0:
                    trace[best].counted = True
                    counted_groups += 1
                    presence_vals.append(trace[best].contribution)
                # direction: best per (group, kb_state) so twin entries cannot double count
                by_state: dict[str, int] = {}
                for i in idxs:
                    st = trace[i].kb_state
                    if st in DIRECTIONS and (st not in by_state or trace[i].contribution > trace[by_state[st]].contribution):
                        by_state[st] = i
                for st, i in by_state.items():
                    if trace[i].contribution > 0:
                        dir_vals[st].append(trace[i].contribution)

            presence = self._combine(presence_vals)
            deficient = self._combine(dir_vals["Deficient"])
            excess = self._combine(dir_vals["Excess"])
            units = counted_groups
            confidence, coverage = self._confidence(relevant, contradicted, n_assessed)

            reasons: list[str] = []
            direction, high_priority, gray = None, False, False
            has_open_items = bool(unresolved or pending)

            deficient_meaningful = deficient >= self.meaningful_threshold
            excess_meaningful = excess >= self.meaningful_threshold
            gate = deficient_meaningful or excess_meaningful
            mapped_count = sum(1 for ev in evidence if self._associations(ev, chakra))
            gate_failures = []
            if mapped_count == 0:
                gate_failures.append("no evidence has a canonical association with this chakra")
            if not gate:
                gate_failures.append(f"Deficient {deficient:.2f} and Excess {excess:.2f} are both below "
                                     f"the meaningful directional threshold {self.meaningful_threshold:.2f}")
            gate_reason = (
                "At least one eligible directional score reached the meaningful threshold."
                if gate else "; ".join(gate_failures)
            )

            if gate:
                if deficient_meaningful and excess_meaningful:
                    stronger, weaker = max(deficient, excess), min(deficient, excess)
                    ratio = stronger / weaker
                    if ratio < self.dominance_ratio:
                        status, code = "CONFLICTED", "DIRECTION_CONFLICTED"
                        reasons.append(f"Both directions are meaningful, but dominance ratio {ratio:.3f} "
                                       f"is below {self.dominance_ratio:.2f}; no direction selected.")
                    else:
                        direction = "Deficient" if deficient > excess else "Excess"
                        status, code = f"IMBALANCED_{direction.upper()}", f"DIRECTION_{direction.upper()}"
                        reasons.append(f"{direction} is dominant by ratio {ratio:.3f} (required "
                                       f"{self.dominance_ratio:.2f}).")
                elif deficient_meaningful:
                    direction, status, code = "Deficient", "IMBALANCED_DEFICIENT", "DIRECTION_DEFICIENT"
                else:
                    direction, status, code = "Excess", "IMBALANCED_EXCESS", "DIRECTION_EXCESS"
                if direction:
                    reasons.append(f"{direction} directional score passed the {self.meaningful_threshold:.2f} threshold.")
            elif polarity_conflict and (presence > 0 or relevant):
                status, code = "UNRESOLVED", "CONFLICTING_EVIDENCE"
                reasons.append("Confirmed and denied statements about the same indicator conflict: "
                               "clarification required before this chakra can be called.")
            elif presence >= self.insufficient_score_threshold or has_open_items or mapped_count:
                status, code = "UNRESOLVED", "INSUFFICIENT_EVIDENCE"
                if presence < self.imbalance_threshold:
                    reasons.append(f"Presence {presence:.2f} is below the imbalance gate {self.imbalance_threshold:.2f}.")
                reasons.append(f"Neither direction reached {self.meaningful_threshold:.2f}.")
                if pending:
                    code = "MISSING_DETAILS"
                    reasons.append("Severity not yet stated for some evidence: ask before scoring.")
                if unresolved:
                    reasons.append("Some evidence is unresolved/unscored and contributes nothing yet.")
                top_item = max(trace, key=lambda t: t.contribution, default=None)
                if (units == 1 and top_item and top_item.strength == "Strong" and top_item.intensity == "Severe"
                        and top_item.reliability_weight == 1.0 and top_item.contribution >= self.high_priority_single):
                    high_priority = True
                    reasons.append("Single strong, severe, confirmed indicator: HIGH PRIORITY for therapist "
                                   "review and corroboration; not declared imbalanced automatically.")
            else:
                if adequately_assessed:
                    status, code = "BALANCED", "ADEQUATELY_ASSESSED_NO_EVIDENCE"
                    reasons.append(f"Therapist assessed {n_assessed} relevant quadrant(s); no meaningful "
                                   "validated imbalance evidence was found. Assessing all quadrants is not required.")
                    if negative:
                        reasons.append(f"{len(negative)} explicit denial(s) recorded.")
                    if presence > 0:
                        reasons.append(f"Minor evidence ({presence:.2f}) is below the meaningful-evidence "
                                       f"threshold {self.insufficient_score_threshold:.2f}.")
                else:
                    status, code = "UNRESOLVED", "NOT_ASSESSED"
                    reasons.append("No quadrant has been assessed. Absence of evidence is NOT balance; "
                                   "the therapist chooses which quadrants are relevant to assess.")

            score = max(presence, deficient, excess)
            if mapped_count == 0:
                evidence_state = "NO_MAPPED_EVIDENCE"
            elif not gate:
                evidence_state = "MAPPED_EVIDENCE_DID_NOT_PASS_GATE"
            else:
                evidence_state = "MAPPED_EVIDENCE_PASSED_PRESENCE_GATE"
            results.append(ChakraResult(
                chakra=chakra, score=round(score, 4), presence_score=round(presence, 4), deficient_score=round(deficient, 4),
                excess_score=round(excess, 4), direction=direction, status=status,
                severity=band(score), confidence_pct=confidence, independent_evidence_units=units,
                gate_passed=gate, gate_threshold=self.imbalance_threshold, gate_reason=gate_reason,
                mapped_evidence_count=mapped_count, scored_evidence_count=len(relevant),
                reasons=reasons, evidence_ids=sorted({t.evidence_id for t in trace}),
                status_label=STATUS_LABELS[status], status_code=code, confidence_label=confidence_label(confidence),
                coverage_pct=round(100 * coverage, 1), high_priority=high_priority, direction_gray_zone=gray,
                negative_evidence_ids=sorted(set(negative)), historical_evidence_ids=sorted(set(historical)),
                unresolved_evidence_ids=sorted(set(unresolved)), nondirectional_evidence_ids=sorted(set(nondirectional)),
                pending_details=pending, trace=trace))

            gate_logger = logging.getLogger("anahat.scoring")
            gate_logger.info(
                "FINAL CHAKRA GATE | %s | evidence_state=%s | mapped_evidence_count=%s "
                "scorable_evidence_count=%s | deficient=%s excess=%s threshold=%s "
                "| dominance_ratio_required=%s confidence_pct=%s | passed_gate=%s | final_status=%s "
                "| reason=%s | evidence=%s",
                chakra, evidence_state, mapped_count, len(relevant), round(deficient, 4), round(excess, 4),
                self.meaningful_threshold, self.dominance_ratio, confidence,
                status.startswith("IMBALANCED"), status, reasons,
                [{"evidence_id": item.evidence_id, "term": item.term, "status": item.evidence_status,
                  "intensity": item.intensity, "state": item.kb_state,
                  "contribution": item.contribution, "counted": item.counted, "note": item.note}
                 for item in trace],
            )

        supported = [r.chakra for r in results if r.status.startswith("IMBALANCED")]
        directional = [r.chakra for r in results if r.status in ("IMBALANCED_DEFICIENT", "IMBALANCED_EXCESS")]
        ranking = [r.chakra for r in sorted(results, key=lambda r: (-r.presence_score, r.chakra))]
        logging.getLogger("anahat.scoring").debug(
            "chakra_score_diagnostics thresholds=%s chakras=%s supported_chakras=%s",
            {"meaningful_directional_score": self.meaningful_threshold,
             "dominance_ratio": self.dominance_ratio, "confidence_is_gate": False,
             "coverage_is_gate": False},
            [{"chakra": r.chakra, "presence": r.presence_score,
              "deficient": r.deficient_score, "excess": r.excess_score,
              "confidence_pct": r.confidence_pct, "independent_units": r.independent_evidence_units,
              "status": r.status, "passed_imbalance_gate": r.status.startswith("IMBALANCED"),
              "reasons": r.reasons}
             for r in results],
            supported,
        )
        return ChakraReport(
            results=results, supported_chakras=supported, directional_chakras=directional, ranking=ranking,
            assessed_quadrants=sorted(assessed),
            coverage={"assessed_quadrants": n_assessed, "reference_quadrants": self.n_quadrants,
                      "balanced_requires": self.balanced_min_quadrants, "adequately_assessed": adequately_assessed},
            audit={"thresholds": {"meaningful_directional_score": self.meaningful_threshold,
                                  "insufficient_score": self.insufficient_score_threshold,
                                  "balanced_min_assessed_quadrants": self.balanced_min_quadrants,
                                  "dominance_ratio": self.dominance_ratio,
                                  "confidence_is_gate": False, "coverage_is_gate": False},
                   "weights": {"strength": self.strength, "intensity": self.intensity, "reliability": self.reliability,
                               "confidence": self.conf_weights},
                   "clinically_validated": False,
                   "note": "All thresholds are engineering baselines, configurable, not clinically validated."})
