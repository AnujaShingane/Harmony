from collections import defaultdict

class ContradictionService:
    def find(self, evidence, indicator_repo):
        by = defaultdict(lambda: {"Deficient": [], "Excess": []})
        for ev in evidence:
            if ev.status.value not in ("CONFIRMED", "Resolved After Clarification", "PROVISIONAL"):
                continue
            if ev.polarity != "positive" or ev.currentness != "current":
                continue
            for ind in indicator_repo.get_by_id(ev.canonical_indicator_id):
                if ev.selected_chakra and ev.selected_chakra != ind.chakra:
                    continue
                if ind.state_raw in by[ind.chakra]:
                    by[ind.chakra][ind.state_raw].append(ev.evidence_id)
        return [
            {"chakra": chakra, "deficient_evidence_ids": vals["Deficient"], "excess_evidence_ids": vals["Excess"]}
            for chakra, vals in by.items() if vals["Deficient"] and vals["Excess"]
        ]
