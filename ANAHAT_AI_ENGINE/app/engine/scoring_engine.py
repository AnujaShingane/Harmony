from __future__ import annotations
from collections import defaultdict
from app.core.enums import EvidenceStatus
from app.models.chakra import ChakraReport, ChakraResult

DEFAULT_STRENGTH = {"Strong": 1.0, "Medium": 0.6, "Weak": 0.3}
DEFAULT_INTENSITY = {"Mild": 0.4, "Moderate": 0.7, "Severe": 1.0}
DEFAULT_RELIABILITY = {"Confirmed": 1.0, "Resolved After Clarification": 1.0, "Provisional": 0.4, "Unresolved": 0.0, "Historical": 0.0, "NEGATIVE": 0.0}

class ScoringEngine:
    def __init__(self, kb):
        cfg = kb.scoring_config or {}
        self.strength = cfg.get("strength_weights", DEFAULT_STRENGTH)
        self.intensity = cfg.get("intensity_weights", DEFAULT_INTENSITY)
        self.reliability = cfg.get("reliability_weights", DEFAULT_RELIABILITY)
        direction = cfg.get("direction", {})
        self.meaningful_threshold = float(direction.get("meaningful_threshold", 0.2))
        self.conflict_margin = float(direction.get("conflict_margin", 0.1))
        gate = cfg.get("imbalance_gate", {})
        # Engineering gates are configurable. Fall back to application settings
        # when the canonical scoring file does not carry numeric thresholds.
        from app.core.config import settings
        self.imbalance_threshold = float(settings.imbalance_score_threshold)
        self.min_confidence = float(settings.minimum_confidence_pct)
        self.min_units = int(settings.minimum_independent_evidence_units)
        self.ambiguity_margin = float(settings.ambiguity_margin)
        self.insufficient_score_threshold = float(settings.insufficient_score_threshold)
        self.evidence_by_id = {i.indicator_id: i for i in kb.indicators}
        self.indicator_repo = kb
        self.chakras = kb.chakra_names

    def _unit(self, evidence, indicator):
        if evidence.polarity != "positive" or evidence.currentness != "current":
            return 0.0
        sw = self.strength.get(indicator.association_rating, 0.0)
        iw = self.intensity.get(evidence.intensity, 0.0)
        rw = self.reliability.get(evidence.status.value, 0.0)
        return sw * iw * rw

    @staticmethod
    def _combine(values):
        combined = 0.0
        for value in values:
            combined += value * (1 - combined)
        return combined

    def _confidence(self, chakra, evidence, contradictions, assessed_quadrants):
        relevant = [e for e in evidence if e.evidence_id in {x for x in self._chakra_evidence_ids(chakra, evidence)}]
        coverage = min(1.0, len(assessed_quadrants) / 10.0)
        consistency = 0.0 if any(c["chakra"] == chakra for c in contradictions) else (1.0 if relevant else 0.0)
        resolved = [e for e in relevant if e.status.value in ("CONFIRMED", "Resolved After Clarification")]
        resolution = len(resolved) / len(relevant) if relevant else 0.0
        completeness = sum(bool(e.intensity and e.context is not None) for e in relevant) / len(relevant) if relevant else 0.0
        return round(100 * (0.30*coverage + 0.30*consistency + 0.25*resolution + 0.15*completeness), 2)

    def _chakra_evidence_ids(self, chakra, evidence):
        ids=[]
        for ev in evidence:
            inds=self.indicator_repo.indicators
            if any(i.indicator_id == ev.canonical_indicator_id and i.chakra == chakra for i in inds): ids.append(ev.evidence_id)
        return ids

    def score(self, evidence, *, contradictions=None, assessed_quadrants=None):
        contradictions = contradictions or []
        assessed_quadrants = assessed_quadrants or set()
        results=[]
        for chakra in self.chakras:
            dirs=defaultdict(list); presence=[]; evidence_ids=[]
            for ev in evidence:
                indicators=[i for i in self.indicator_repo.indicators if i.indicator_id == ev.canonical_indicator_id and i.chakra == chakra and (ev.selected_chakra is None or ev.selected_chakra == chakra)]
                for ind in indicators:
                    if ev.polarity == "positive" and ev.currentness == "current":
                        evidence_ids.append(ev.evidence_id)
                        presence.append(self._unit(ev, ind) if ev.status.value != "NEGATIVE" else 0.0)
                        if ind.state_raw in ("Deficient", "Excess"):
                            dirs[ind.state_raw].append(self._unit(ev, ind))
            deficient=self._combine(dirs["Deficient"]); excess=self._combine(dirs["Excess"]); presence_score=max(presence, default=0.0)
            if deficient >= self.meaningful_threshold and excess >= self.meaningful_threshold and abs(deficient-excess) <= self.conflict_margin:
                status="UNRESOLVED"; direction=None
            elif deficient >= self.meaningful_threshold and excess >= self.meaningful_threshold:
                status="IMBALANCED_DIRECTION_UNRESOLVED"; direction=None
            elif deficient > excess and deficient >= self.meaningful_threshold:
                direction="Deficient"; status="IMBALANCED_DEFICIENT"
            elif excess > deficient and excess >= self.meaningful_threshold:
                direction="Excess"; status="IMBALANCED_EXCESS"
            elif not evidence_ids:
                status="BALANCED" if len(assessed_quadrants) >= 10 else "UNRESOLVED"; direction=None
            else:
                status="UNRESOLVED"; direction=None
            confidence=self._confidence(chakra, evidence, contradictions, assessed_quadrants)
            independent=len(set(ev.response_id for ev in evidence if ev.evidence_id in evidence_ids))
            if status.startswith("IMBALANCED") and (max(deficient, excess) < self.imbalance_threshold or confidence < self.min_confidence or independent < self.min_units):
                status="UNRESOLVED" if direction is None else "UNRESOLVED"
            score=max(deficient, excess, presence_score)
            severity="minimal" if score < .20 else "mild" if score < .45 else "moderate" if score < .70 else "severe"
            results.append(ChakraResult(chakra=chakra,presence_score=round(presence_score,4),deficient_score=round(deficient,4),excess_score=round(excess,4),direction=direction,status=status,severity=severity,confidence_pct=confidence,independent_evidence_units=independent,reasons=[],evidence_ids=sorted(set(evidence_ids))))
        supported=[r.chakra for r in results if r.status in ("IMBALANCED_DEFICIENT","IMBALANCED_EXCESS")]
        return ChakraReport(results=results, supported_chakras=supported, audit={"thresholds":{"imbalance_score":self.imbalance_threshold,"min_confidence_pct":self.min_confidence,"min_independent_units":self.min_units},"clinically_validated":False})
