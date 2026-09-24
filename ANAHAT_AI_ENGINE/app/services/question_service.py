from __future__ import annotations

import re


class QuestionService:
    def __init__(self, kb):
        self.kb = kb

    def baseline_questions(self):
        return self.kb.opening_questions.get(
            "baseline_rating_questions", {}
        ).get("ratings", [])

    def opening_questions(self):
        return self.kb.opening_questions.get(
            "opening_questions", {}
        )

    def get_opening_questions(self):
        return self.opening_questions().get("questions", [])

    def recommend_quadrants(
        self,
        *,
        current_issue=None,
        opening_answers=None,
        baseline=None,
        demographics=None,
    ):
        assessed = set()
        if isinstance(opening_answers, dict):
            assessed.update(opening_answers.get("assessed_quadrants", []))

        # Recommendations are deliberately transparent and bounded: only
        # patient-provided text, baseline ratings, and the fixed KB vocabulary
        # contribute to the ranking. No quadrant is selected by list order.
        source_text = " ".join(filter(None, [
            self._flatten_text(demographics),
            self._flatten_text(current_issue),
            self._flatten_text(opening_answers),
        ])).lower()
        baseline = baseline or {}
        scores = []
        for index, q in enumerate(self.kb.quadrants):
            name = q.get("name")
            if name in assessed:
                continue
            signals = self._signals_for(name)
            matched = sorted({signal for signal in signals if re.search(rf"\b{re.escape(signal)}\b", source_text)})
            score = len(matched)
            reasons = [f"Matched patient context: {', '.join(matched[:3])}"] if matched else []

            if name in {"Nature", "Lifestyle", "Medical & Therapeutic Background"}:
                for key, label in (("stress", "stress"), ("anxiety", "anxiety"), ("mood", "mood"), ("sleep_quality", "sleep"), ("energy", "energy")):
                    value = baseline.get(key)
                    high = isinstance(value, (int, float)) and value >= 7
                    poor_sleep = key == "sleep_quality" and str(value).lower() in {"poor", "fair"}
                    if high or poor_sleep:
                        score += 1
                        reasons.append(f"Baseline {label}: {value}")

            scores.append({
                "quadrant": name,
                "relevance_score": round(score / max(1, len(signals)), 3),
                "reasons": reasons or ["No direct signal found; therapist confirmation is required."],
                "missing_information": (q.get("attributes") or [])[:3],
                "_order": index,
            })

        scores.sort(key=lambda item: (-item["relevance_score"], item["_order"]))
        for item in scores:
            item.pop("_order", None)
        return scores[:3]

    @staticmethod
    def _flatten_text(value):
        if value is None:
            return ""
        if isinstance(value, dict):
            return " ".join(QuestionService._flatten_text(v) for v in value.values())
        if isinstance(value, (list, tuple, set)):
            return " ".join(QuestionService._flatten_text(v) for v in value)
        return str(value)

    @staticmethod
    def _signals_for(name):
        profiles = {
            "Nature": "personality communication attitude risk taking time management forgiveness memory leadership stress overthink introvert extrovert planner frustration".split(),
            "Family": "family parent parents sibling siblings spouse children caregiver home household relationship relatives support conflict".split(),
            "Social Circle": "friend friends social peer peers community isolation lonely relationship communication belonging".split(),
            "Personal Interests": "hobby hobbies interest music art creative recreation leisure enjoyment passion".split(),
            "Profession": "work job occupation career study studies school student academic college deadline workload performance".split(),
            "Lifestyle": "sleep energy routine daily day exercise activity diet food habit schedule rest".split(),
            "Diet": "diet food eating appetite meal nutrition hunger weight".split(),
            "Physical Nature": "physical body pain fatigue tired exhaustion health symptom sleep".split(),
            "Medical & Therapeutic Background": "medical therapy therapist treatment diagnosis medication trauma anxiety depression stress condition".split(),
            "Music Therapy Profile": "music song raga rhythm instrument listening sound melody relaxation".split(),
        }
        return profiles.get(name, [str(name).lower()])

    def personalized_questions(self, quadrant_name: str, limit=3):
        q = next(
            (x for x in self.kb.quadrants if x.get("name") == quadrant_name),
            None
        )

        if not q:
            return []

        result = []

        for idx, item in enumerate(
            q.get("attributes_with_responses") or []
        ):
            if idx >= limit:
                break

            attr = item.get("attribute")

            result.append({
                "id": f"Q-{q.get('quadrant_id')}-{idx + 1}",
                "quadrant": quadrant_name,
                "attribute": attr,
                "possible_responses": item.get("possible_responses"),
                "question": (
                    f"How would you describe your experience with "
                    f"{str(attr).lower()}?"
                ),
                "source": "validated ANAHAT quadrant question bank",
            })

        return result