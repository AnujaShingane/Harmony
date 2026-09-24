from app.knowledge.loader import KnowledgeBase, Indicator


class IndicatorRepository:
    """Authoritative read-only access to canonical indicator records."""
    def __init__(self, kb: KnowledgeBase):
        self.kb = kb
        self.by_id = {}
        for indicator in kb.indicators:
            self.by_id.setdefault(indicator.indicator_id, []).append(indicator)

    def get_by_id(self, indicator_id: str) -> list[Indicator]:
        return list(self.by_id.get(indicator_id, []))

    def all(self) -> list[Indicator]:
        return list(self.kb.indicators)

    def find_exact_term(self, term: str) -> list[Indicator]:
        return self.kb.find_by_term(term)

    def validate_candidate(self, indicator_id: str, payload: dict | None = None) -> bool:
        records = self.get_by_id(indicator_id)
        if not records:
            return False
        if payload is None:
            return True
        # Retrieval metadata may only narrow to canonical records; it cannot
        # introduce an association. If supplied, fields must agree with at
        # least one authoritative record.
        payload_chakras = payload.get("chakra")
        if payload_chakras is not None:
            if isinstance(payload_chakras, str): payload_chakras = [payload_chakras]
            if set(payload_chakras) != {r.chakra for r in records}:
                return False
        payload_strength = payload.get("indicator_strength_by_chakra")
        if payload_strength is not None:
            expected = {r.chakra: r.association_rating for r in records}
            if payload_strength != expected:
                return False
        payload_state = payload.get("state")
        if payload_state is not None and len({r.state_raw for r in records}) == 1:
            if payload_state != records[0].raw_entry.get("state"):
                return False
        return True
