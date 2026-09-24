from __future__ import annotations
from uuid import uuid4
from app.core.enums import EvidenceStatus
from app.models.evidence import EvidenceRecord

class EvidenceEngine:
    def __init__(self, indicator_repo):
        self.indicator_repo = indicator_repo

    def build_evidence(self, *, response_id, candidate, extraction, status: EvidenceStatus,
                       confirmation=None, selected_chakra=None):
        concept = candidate.get("concept") or {}
        payload = candidate.get("payload") or {}
        indicator_id = payload.get("indicator_id")
        if not indicator_id or not self.indicator_repo.validate_candidate(indicator_id):
            return None
        polarity = concept.get("polarity", "uncertain")
        currentness = concept.get("currentness", "unknown")
        if polarity == "negative":
            status = EvidenceStatus.NEGATIVE
        elif currentness == "historical":
            status = EvidenceStatus.HISTORICAL
        return EvidenceRecord(
            evidence_id=str(uuid4()), response_id=response_id,
            candidate_id=candidate.get("candidate_id"), canonical_indicator_id=indicator_id,
            indicator_term=payload.get("ailment") or payload.get("term"),
            domain=concept.get("domain"), status=status, polarity=polarity,
            currentness=currentness, certainty=concept.get("certainty", "uncertain"),
            intensity=concept.get("intensity"), context=concept.get("context"),
            trigger=concept.get("trigger"),
            provenance={"retrieval_score": candidate.get("score"), "retrieval_layer": "canonical_indicator"},
            confirmation=confirmation or {}, selected_chakra=selected_chakra,
        )
