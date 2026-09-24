from pydantic import BaseModel

class ChakraResult(BaseModel):
    chakra: str
    presence_score: float
    deficient_score: float
    excess_score: float
    direction: str | None
    status: str
    severity: str
    confidence_pct: float
    independent_evidence_units: int
    reasons: list[str] = []
    evidence_ids: list[str] = []

class ChakraReport(BaseModel):
    results: list[ChakraResult]
    supported_chakras: list[str]
    audit: dict
