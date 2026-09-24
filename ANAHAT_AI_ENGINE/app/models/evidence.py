from pydantic import BaseModel, Field
from app.core.enums import EvidenceStatus

class EvidenceRecord(BaseModel):
    evidence_id: str
    response_id: str
    candidate_id: str | None = None
    canonical_indicator_id: str | None = None
    indicator_term: str | None = None
    domain: str | None = None
    status: EvidenceStatus
    polarity: str
    currentness: str
    certainty: str
    intensity: str | None = None
    context: str | None = None
    trigger: str | None = None
    provenance: dict = Field(default_factory=dict)
    confirmation: dict = Field(default_factory=dict)
    selected_chakra: str | None = None
