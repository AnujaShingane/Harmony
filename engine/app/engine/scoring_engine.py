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
        # Engineering gates live in settings (env-configurable), not in code.
        self.imbalance_threshold = float(settings.imbalance_score_threshold)
        self.direction_threshold = float(settings.direction_threshold)
        self.min_confidence = float(settings.minimum_confidence_pct)
        self.min_units = int(settings.minimum_independent_evidence_units)
        self.ambiguity_margin = float(settings.ambiguity_margin)
        self.gray_zone_margin = float(settings.direction_gray_zone_margin)
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
    def score(self, evidence, *, contradictions=None, assessed_quadrants=None, responses=None):
        contradictions = contradictions or []
        assessed = set(assessed_quadrants or [])
        n_assessed = len(assessed)
        adequately_assessed = n_assessed >= self.balanced_min_quadrants
        evidence = list(evidence or [])
        results = []

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

                ind = assoc[0]
                relevant.append(ev)
                sw = float(self.strength.get(ind.association_rating, 0.0))
                iw_raw = self.intensity.get(ev.intensity) if ev.intensity else None
                rw = self._reliability_weight(ev.status.value)
                note = None
                if rw == 0.0:
                    unresolved.append(ev.evidence_id); note = "unresolved: contributes 0 until clarified"
                if iw_raw is None:
                    pending.append({"evidence_id": ev.evidence_id, "indicator": ev.indicator_term,
                                    "missing": ["intensity"]})
                    note = (note + "; " if note else "") + "intensity not stated: contributes 0 until asked"
                iw = float(iw_raw) if iw_raw is not None else 0.0
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

            gate = (presence >= self.imbalance_threshold and units >= self.min_units
                    and confidence >= self.min_confidence and not polarity_conflict)

            if gate:
                top, gap = max(deficient, excess), abs(deficient - excess)
                winner = "Deficient" if deficient > excess else "Excess"
                if top < self.direction_threshold:
                    status, code = "IMBALANCED_DIRECTION_UNRESOLVED", "DIRECTION_BELOW_THRESHOLD"
                    reasons.append(f"Presence is supported ({presence:.2f}) but directional evidence "
                                   f"({top:.2f}) is below the direction threshold {self.direction_threshold:.2f}.")
                elif gap < self.ambiguity_margin:
                    status, code = "IMBALANCED_DIRECTION_UNRESOLVED", "DIRECTION_AMBIGUOUS"
                    reasons.append(f"Deficient ({deficient:.2f}) and Excess ({excess:.2f}) are within "
                                   f"{self.ambiguity_margin:.2f} of each other: direction is ambiguous.")
                elif gap < self.gray_zone_margin:
                    status, code, gray = "IMBALANCED_DIRECTION_UNRESOLVED", "DIRECTION_GRAY_ZONE", True
                    reasons.append(f"Deficient/Excess gap {gap:.2f} is in the {self.ambiguity_margin:.2f}-"
                                   f"{self.gray_zone_margin:.2f} gray zone: inspect the evidence.")
                else:
                    direction = winner
                    status, code = f"IMBALANCED_{winner.upper()}", f"DIRECTION_{winner.upper()}"
                    reasons.append(f"{winner} evidence {max(deficient, excess):.2f} leads by {gap:.2f}.")
                    if min(deficient, excess) >= self.meaningful_threshold:
                        reasons.append("Opposite-direction evidence is also present: therapist should inspect it.")
                if nondirectional:
                    reasons.append("Some contributing indicators have no fixed direction in the KB "
                                   "(Either/Varies/Conflicted/...); they support presence only.")
            elif polarity_conflict and (presence > 0 or relevant):
                status, code = "UNRESOLVED", "CONFLICTING_EVIDENCE"
                reasons.append("Confirmed and denied statements about the same indicator conflict: "
                               "clarification required before this chakra can be called.")
            elif presence >= self.insufficient_score_threshold or has_open_items:
                status, code = "UNRESOLVED", "INSUFFICIENT_EVIDENCE"
                if presence < self.imbalance_threshold:
                    reasons.append(f"Presence {presence:.2f} is below the imbalance gate {self.imbalance_threshold:.2f}.")
                if units < self.min_units:
                    reasons.append(f"{units} independent evidence unit(s); {self.min_units} required.")
                if confidence < self.min_confidence:
                    reasons.append(f"Confidence {confidence:.0f}% is below {self.min_confidence:.0f}%.")
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
                    reasons.append(f"{n_assessed}/{self.n_quadrants} quadrants assessed and no meaningful "
                                   "validated imbalance evidence was found.")
                    if negative:
                        reasons.append(f"{len(negative)} explicit denial(s) recorded.")
                    if presence > 0:
                        reasons.append(f"Minor evidence ({presence:.2f}) is below the meaningful-evidence "
                                       f"threshold {self.insufficient_score_threshold:.2f}.")
                else:
                    status, code = "UNRESOLVED", "NOT_ASSESSED"
                    reasons.append(f"Not adequately assessed ({n_assessed}/{self.balanced_min_quadrants} "
                                   "quadrants with patient responses). Absence of evidence is NOT balance.")

            score = max(presence, deficient, excess)
            results.append(ChakraResult(
                chakra=chakra, presence_score=round(presence, 4), deficient_score=round(deficient, 4),
                excess_score=round(excess, 4), direction=direction, status=status,
                severity=band(score), confidence_pct=confidence, independent_evidence_units=units,
                reasons=reasons, evidence_ids=sorted({t.evidence_id for t in trace}),
                status_label=STATUS_LABELS[status], status_code=code, confidence_label=confidence_label(confidence),
                coverage_pct=round(100 * coverage, 1), high_priority=high_priority, direction_gray_zone=gray,
                negative_evidence_ids=sorted(set(negative)), historical_evidence_ids=sorted(set(historical)),
                unresolved_evidence_ids=sorted(set(unresolved)), nondirectional_evidence_ids=sorted(set(nondirectional)),
                pending_details=pending, trace=trace))

        supported = [r.chakra for r in results if r.status.startswith("IMBALANCED")]
        directional = [r.chakra for r in results if r.status in ("IMBALANCED_DEFICIENT", "IMBALANCED_EXCESS")]
        ranking = [r.chakra for r in sorted(results, key=lambda r: (-r.presence_score, r.chakra))]
        logging.getLogger("anahat.scoring").debug(
            "chakra_score_diagnostics thresholds=%s chakras=%s supported_chakras=%s",
            {"imbalance_score": self.imbalance_threshold, "direction": self.direction_threshold,
             "min_confidence_pct": self.min_confidence, "min_independent_units": self.min_units},
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
            audit={"thresholds": {"imbalance_score": self.imbalance_threshold, "direction": self.direction_threshold,
                                  "ambiguity_margin": self.ambiguity_margin, "gray_zone_margin": self.gray_zone_margin,
                                  "insufficient_score": self.insufficient_score_threshold,
                                  "min_confidence_pct": self.min_confidence, "min_independent_units": self.min_units,
                                  "balanced_min_assessed_quadrants": self.balanced_min_quadrants},
                   "weights": {"strength": self.strength, "intensity": self.intensity, "reliability": self.reliability,
                               "confidence": self.conf_weights},
                   "clinically_validated": False,
                   "note": "All thresholds are engineering baselines, configurable, not clinically validated."})
