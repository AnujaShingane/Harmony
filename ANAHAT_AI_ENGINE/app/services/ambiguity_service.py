class AmbiguityService:
    def __init__(self, kb):
        self.kb = kb

    def for_indicator(self, indicator_id):
        ids = {i.disambiguation_pattern_id for i in self.kb.indicators if i.indicator_id == indicator_id}
        return [q for q in self.kb.disambiguation_questions if q.get("id") in ids]

    def needs_clarification(self, indicator_id):
        inds = [i for i in self.kb.indicators if i.indicator_id == indicator_id]
        return any(i.disambiguation_pattern_id for i in inds) or any(
            (i.state_raw or "").lower() in {"either", "varies", "depends on area", "conflict in area", "any", "deficient or excess", "excess or deficient"}
            for i in inds
        )
