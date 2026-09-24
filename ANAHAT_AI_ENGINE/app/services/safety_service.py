from __future__ import annotations

# These phrases are a minimal emergency routing safeguard. They do not create
# clinical evidence. Canonical governance/safety metadata remains authoritative
# for policy and is attached to every escalation audit event.
_HIGH_RISK_SIGNALS = (
    "kill myself", "suicide", "suicidal", "end my life", "want to die",
    "hurt myself", "self harm", "self-harm", "harm myself", "overdose",
    "kill someone", "hurt someone", "harm someone", "immediate danger",
)


class SafetyService:
    def __init__(self, kb):
        self.kb = kb

    def assess(self, text: str) -> dict:
        lower = (text or "").lower()
        matched = [p for p in _HIGH_RISK_SIGNALS if p in lower]
        rules = self.kb.safety_rules.get("rules", []) if isinstance(self.kb.safety_rules, dict) else []
        if matched:
            return {
                "status": "ESCALATE",
                "matched_signals": matched,
                "action": "stop_normal_probing_and_route_to_therapist",
                "governance_rule_ids": [r.get("id") for r in rules if r.get("id")],
                "emergency_contacts_available": bool(self.kb.emergency_contacts),
                "clinical_diagnosis": False,
            }
        return {
            "status": "CLEAR",
            "matched_signals": [],
            "action": "continue",
            "governance_rule_ids": [r.get("id") for r in rules if r.get("id")],
            "clinical_diagnosis": False,
        }
