from __future__ import annotations

import copy
import hashlib
import logging
import re
import threading
import unicodedata
from uuid import uuid4

from app.api.llm_errors import clean_request_id
from app.core.config import settings
from app.core.enums import AssessmentStage, EvidenceStatus
from app.engine.patient_context import PatientContext
from app.engine.evidence_engine import EvidenceEngine
from app.engine.scoring_engine import ScoringEngine
from app.engine.decision_engine import DecisionEngine
from app.knowledge.indicator_repository import IndicatorRepository
from app.knowledge.activity_repository import ActivityRepository
from app.retrieval.filters import candidate_is_usable
from app.services.activity_service import ActivityService
from app.services.ambiguity_service import AmbiguityService
from app.services.contradiction_service import ContradictionService
from app.services.deep_dive_service import DeepDiveService
from app.services.prescription_service import PrescriptionService
from app.services.question_service import QuestionService
from app.services.raga_service import RagaService
from app.services.response_service import ResponseService
from app.services.safety_service import SafetyService
from app.llm.prompts import compact_context


_OPEN_REQUIRES_VALIDATION = [
    "balanced_min_assessed_quadrants (how many quadrants must be assessed before 'Balanced' may be shown)",
    "confidence 'completeness' component definition",
    "AMBER safety phrase list and RED phrase list",
    "deep-dive question wording (neutral templates, not from a validated KB list)",
    "quadrant question text for Personal Interests, Profession, Medical & Therapeutic Background, Music Therapy Profile (no 1:1 KB question bank mapping)",
    "top-two-chakras (KB design) vs all-seven (spec): all seven are evaluated",
    "KB duplicate indicators (SYM-009/EMO-008 same term; SYM-069/070)",
    "handling of KB states 'Either', 'Varies', 'Excess to Deficient', 'Usually Excess' (kept non-directional, never reinterpreted)",
    "direction gray-zone handling (0.10-0.15)",
    "Emergency contact numbers in KB are marked 'requires live verification before production'",
]


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "").lower()
    text = text.replace("\u2019", "'").replace("\u2018", "'")
    return " ".join(re.sub(r"[^a-z0-9']+", " ", text).split())


def quote_is_verbatim(raw_text: str, quote: str | None) -> bool:
    """True only if the quote is a contiguous, word-aligned piece of the patient's raw words."""
    q = _norm(quote or "")
    if len(q) < 3:
        return False
    return f" {q} " in f" {_norm(raw_text)} "


class AssessmentService:
    _sessions = {}

    def __init__(self, kb=None, llm=None, retriever=None, embedder=None):
        self.kb, self.llm, self.retriever = kb, llm, retriever
        self.embedder = embedder
        if kb:
            self.indicators = IndicatorRepository(kb)
            self.evidence_engine = EvidenceEngine(self.indicators)
            self.scoring = ScoringEngine(kb)
            self.questions = QuestionService(kb, embedder=embedder)
            self.ambiguity = AmbiguityService(kb)
            self.contradictions = ContradictionService()
            self.safety = SafetyService(kb)
            self.activities = ActivityService(ActivityRepository(kb))
            self.ragas = RagaService(kb)
            self.prescriptions = PrescriptionService()
            self.decisions = DecisionEngine()
            self.deep_dive = DeepDiveService(self.ambiguity)

    @classmethod
    def get(cls, session_id):
        return cls._sessions.get(session_id)

    def _ctx(self, sid):
        ctx = self._sessions.get(sid)
        if ctx is None:
            raise ValueError("Assessment session not found")
        return ctx

    def _q_state(self, ctx, quadrant):
        return ctx.quadrants.setdefault(quadrant, {"answered_question_ids": [], "response_ids": [], "completed": False})

    def _guard_safety(self, ctx):
        """RED interrupts the assessment: nothing else is processed until a therapist clears it."""
        if ctx.stage == AssessmentStage.SAFETY_ESCALATION.value:
            return {"status": "SAFETY_ESCALATION",
                    "detail": "Assessment is paused for a safety escalation. A therapist must review and clear it first."}
        return None

    # ------------------------------------------------------------------ session-less, KB-only helpers
    def list_opening_styles(self):
        """Opening styles straight from the KB assessments folder (no session needed)."""
        return {"styles": self.questions.opening_styles(), "rules": self.questions.opening_rules()}

    def suggest_question(self, patient_text="", asked_ids=(), style=None):
        """Pick (never write) the next KB question for a live conversation.
        No patient words -> next unasked opening question of the therapist-chosen style
        (default style 'A', the first KB style: REQUIRES THERAPIST VALIDATION).
        Otherwise -> the best-matching quadrant's next unasked question."""
        asked = set(asked_ids or ())
        style = style or "A"
        text = (patient_text or "").strip()
        rec = self.questions.recommend_quadrants(current_issue=text, limit=1) if text else []
        if not rec or rec[0]["relevance_score"] <= 0:
            for q in self.questions.opening_questions(style):
                if q["id"] not in asked:
                    return {"id": q["id"], "text": q["text"], "quadrant": None, "source": f"KB opening style {style.upper()}",
                            "reason": "No specific area detected yet; continue with the opening questions." if text
                            else "Session just started; begin with the opening questions."}
            if not text:
                return None
        for r in (rec or []):
            page = self.questions.next_questions(r["quadrant"], asked, 1)
            if page["questions"]:
                q = page["questions"][0]
                return {"id": q["id"], "text": q["question"], "quadrant": r["quadrant"], "source": q["source"],
                        "reason": r["reasons"][0]}
        return None

    # ------------------------------------------------------------------ session + baseline
    def create_session(self, request):
        sid = str(uuid4()); ctx = PatientContext()
        ctx.demographics = {"patient_id": request.patient_id, "language": request.language,
                            "communication_preferences": request.communication_preferences}
        ctx.stage = AssessmentStage.BASELINE.value
        ctx.audit("SESSION_CREATED", stage=ctx.stage)
        self._sessions[sid] = ctx
        from app.models.assessment import AssessmentResponse
        return AssessmentResponse(session_id=sid, status="created", current_stage=ctx.stage)

    def set_baseline(self, sid, baseline):
        ctx = self._ctx(sid)
        if ctx.baseline:
            raise ValueError("Baseline ratings are permanent and can only be recorded once")
        ctx.baseline = baseline.model_dump(); ctx.stage = AssessmentStage.OPENING.value
        ctx.audit("BASELINE_RECORDED"); return {"session_id": sid, "baseline": ctx.baseline, "stage": ctx.stage}

    # ------------------------------------------------------------------ opening (KB only)
    def get_opening_questions(self, sid, style=None):
        """Without `style`: the therapist-selectable styles. With `style`: that style's questions.
        Text always comes from the KB assessments folder through the engine, never from callers."""
        ctx = self._ctx(sid)
        if ctx.stage != AssessmentStage.OPENING.value:
            raise ValueError("Opening Questions can only be accessed during the opening stage")
        if not style:
            return {"session_id": sid, "title": "Opening Question Styles", "styles": self.questions.opening_styles(),
                    "rules": self.questions.opening_rules(), "stage": ctx.stage}
        questions = self.questions.opening_questions(style)
        ctx.patient_state["opening_style"] = style.upper()
        ctx.patient_state["opening_questions"] = [q["text"] for q in questions]
        ctx.audit("OPENING_QUESTIONS_PRESENTED", style=style.upper())
        return {"session_id": sid, "title": "Opening Questions", "style": style.upper(),
                "questions": questions, "therapist_may_skip_or_stop": True, "stage": ctx.stage}

    def skip_opening(self, sid):
        ctx = self._ctx(sid)
        if ctx.stage != AssessmentStage.OPENING.value:
            raise ValueError("Opening can only be skipped during the opening stage")
        ctx.stage = AssessmentStage.QUADRANT_RECOMMENDATION.value
        ctx.audit("OPENING_SKIPPED_BY_THERAPIST")
        return {"status": "OK", "stage": ctx.stage}

    def submit_opening_response(self, sid, text, question_id=None):
        ctx = self._ctx(sid)
        if ctx.stage != AssessmentStage.OPENING.value:
            guard = self._guard_safety(ctx)
            if guard:
                return guard
            raise ValueError("Opening response can only be submitted during the opening stage")
        if not text or not text.strip():
            raise ValueError("Opening response cannot be empty")
        text = text.strip()
        response = ResponseService().create(text=text, question_id=question_id, quadrant=None)
        out = self._analyze(ctx, response, text, session_id=sid, weight_source="opening")
        ctx.patient_state["opening_response"] = text
        ctx.audit("OPENING_RESPONSE_SUBMITTED", response_id=response.response_id)
        if out["status"] != "SAFETY_ESCALATION":
            ctx.stage = AssessmentStage.QUADRANT_RECOMMENDATION.value
            out["stage"] = ctx.stage
        return out

    # ------------------------------------------------------------------ shared analysis pipeline
    def _analyze(self, ctx, response, text, *, session_id, weight_source="current_issue", quadrant=None):
        """safety -> LLM extraction -> quote check -> retrieval -> closed-set validation -> sanitized candidates.

        State is committed only at the very end, so any failure leaves the session untouched.
        Patient-reported, validated canonical indicators become confirmed session evidence."""
        safety = self.safety.assess(text)
        if safety["status"] == "ESCALATE":
            ctx.add_response(response); response.safety_status = safety["status"]
            ctx.stage = AssessmentStage.SAFETY_ESCALATION.value
            ctx.audit("SAFETY_ESCALATION", details=safety)
            ctx.audit("RAW_RESPONSE_STORED", response_id=response.response_id)
            return {"status": "SAFETY_ESCALATION", "response_id": response.response_id, "safety": safety}

        if self.llm is None or self.retriever is None:
            raise RuntimeError("LLM provider and retriever are required for semantic assessment")

        llm_ctx = compact_context({**ctx.summary_min(), "quadrant": quadrant}) if hasattr(ctx, "summary_min") else None
        extraction = self.llm.extract_semantics(text, context=llm_ctx)
        # Some providers return an exact concept but omit its quote. Recover a
        # quote only when the concept itself occurs verbatim in the response;
        # this preserves the existing anti-hallucination evidence boundary.
        repaired_concepts = []
        for concept in extraction.concepts:
            if not concept.evidence_quote:
                for variant in (concept.concept, concept.concept.replace("_", " ")):
                    pattern = r"(?<!\w)" + re.escape(variant).replace(r"\ ", r"\s+") + r"(?!\w)"
                    match = re.search(pattern, text, flags=re.IGNORECASE)
                    if match and quote_is_verbatim(text, match.group(0)):
                        concept = concept.model_copy(update={"evidence_quote": match.group(0)})
                        break
            repaired_concepts.append(concept)
        extraction = extraction.model_copy(update={"concepts": repaired_concepts})
        if extraction.safety_relevant and safety["status"] == "CLEAR":
            safety = self.safety.assess(text, llm_safety_relevant=True)

        unverified, per_concept = [], []
        for concept in extraction.concepts:
            if concept.domain not in {"symptom", "emotion", "behaviour"}:
                continue
            if settings.require_evidence_quote and not quote_is_verbatim(text, concept.evidence_quote):
                unverified.append({"concept": concept.concept, "reason": "evidence quote missing or not found in the patient's words"})
                continue
            per_concept.append((concept, self._candidates_for(concept, text)))

        # ---- commit ----
        response.safety_status = safety["status"]
        response.extraction = extraction.model_dump()
        ctx.add_response(response)
        ctx.audit("RAW_RESPONSE_STORED", response_id=response.response_id)
        if safety["status"] == "AMBER":
            ctx.patient_state["safety_amber_unacknowledged"] = True
            ctx.audit("SAFETY_AMBER", details=safety, response_id=response.response_id)

        seen, internal = set(), []
        for concept, cands in per_concept:
            for c in cands:
                iid = c["payload"].get("indicator_id")
                if iid in seen:
                    continue
                seen.add(iid); internal.append(c)
        ctx.candidates.extend(internal)
        # Patient statements in a completed assessment are confirmed session
        # evidence. Retrieval still only contributes validated canonical
        # candidates; the therapist does not have to re-confirm what the
        # patient has already reported.
        confirmed_evidence = []
        if hasattr(self, "evidence_engine"):
            for candidate in internal:
                validation = candidate.get("validation") or {}
                if not validation.get("llm_validated") or validation.get("match") != "exact":
                    continue
                recorded = self.confirm_candidate(
                    session_id,
                    response.response_id,
                    candidate["candidate_id"],
                    confirmed=True,
                    status=EvidenceStatus.CONFIRMED,
                    confirmation_actor="patient",
                )
                if recorded.get("evidence"):
                    concept_text = candidate.get("concept", {}).get("concept") or candidate.get("quote") or ""
                    concept_key = _norm(concept_text)
                    observation_hash = hashlib.sha256(concept_key.encode("utf-8")).hexdigest()[:16]
                    # Keep the extracted concept correlated across the entire session.
                    # This preserves contradiction handling and prevents repeated
                    # mentions or alternate KB matches from inflating independent units.
                    correlation_group = f"signal:{observation_hash}"
                    # Multiple RAG matches (for example Fatigue and Chronic
                    # Fatigue) can describe the same extracted patient signal.
                    # Keep the existing scorer's correlated-evidence collapse
                    # by assigning alternatives from one concept to one unit.
                    for evidence_item in ctx.evidence:
                        if (evidence_item.response_id == response.response_id
                                and evidence_item.candidate_id == candidate["candidate_id"]):
                            evidence_item.correlation_group = correlation_group
                    recorded_evidence = recorded["evidence"]
                    recorded_evidence["correlation_group"] = correlation_group
                    confirmed_evidence.append(recorded_evidence)
        logging.getLogger("anahat.evidence").debug(
            "patient_session_evidence_extracted concepts=%s candidates=%s evidence=%s",
            [{"concept": c.concept, "domain": c.domain, "polarity": c.polarity,
              "currentness": c.currentness, "intensity": c.intensity}
             for c in extraction.concepts],
            [{"indicator": self._term(c["payload"].get("indicator_id"), c["payload"]),
              "retrieval_score": c.get("score"), "validation": c.get("validation")}
             for c in internal],
            [{"indicator": e.get("indicator_term"), "status": e.get("status"),
              "chakra_associations": [i.chakra for i in self.indicators.get_by_id(e.get("canonical_indicator_id"))]}
             for e in confirmed_evidence],
        )
        ctx.stage = AssessmentStage.EVIDENCE_REVIEW.value

        public = [self._public(c) for c in internal]
        result = {"status": "OK" if public else "NO_VALID_INDICATOR", "response_id": response.response_id,
                  "extraction": extraction.model_dump(), "candidates": public, "candidate_count": len(public),
                  "unverified_concepts": unverified, "weight_source": weight_source,
                  "evidence": confirmed_evidence}
        if safety["status"] == "AMBER":
            result["safety"] = safety
        return result

    def _term(self, iid, payload):
        t = self.indicators.term(iid) if hasattr(self.indicators, "term") else None
        return t or payload.get("ailment") or payload.get("term") or iid

    def _candidates_for(self, concept, text):
        queries = [concept.concept]
        if concept.evidence_quote and _norm(concept.evidence_quote) != _norm(concept.concept):
            queries.append(concept.evidence_quote)
        best = {}
        for query in queries:
            for r in self.retriever.search(query):
                if not candidate_is_usable(r, score_threshold=settings.retrieval_score_threshold):
                    continue
                payload = getattr(r, "payload", {}) or {}
                iid = payload.get("indicator_id")
                if not (iid and self.indicators.validate_candidate(iid, payload)):
                    continue
                score = float(getattr(r, "score", 0.0))
                if iid not in best or score > best[iid]["score"]:
                    best[iid] = {"candidate_id": str(uuid4()), "score": score, "payload": payload,
                                 "concept": concept.model_dump(), "quote": concept.evidence_quote,
                                 "validation": {"llm_validated": False, "match": None}}
        cands = sorted(best.values(), key=lambda x: -x["score"])[:settings.retrieval_top_k]
        cands = self._validate(text, concept, cands)
        # Every extracted patient concept is processed above; keep the existing
        # bounded, validated RAG shortlist for each concept to avoid recording
        # broad lower-ranked matches as evidence.
        return cands[:settings.candidate_display_limit]

    def _validate(self, text, concept, cands):
        fn = getattr(self.llm, "validate_candidates", None)
        if not cands or not callable(fn):
            return cands
        listing = [{"indicator_id": c["payload"]["indicator_id"],
                    "term": self._term(c["payload"]["indicator_id"], c["payload"]),
                    "domain": c["payload"].get("domain")} for c in cands]
        try:
            verdict = fn(text, concept.model_dump(), listing)
        except Exception:  # noqa: BLE001 - degrade: keep retrieval order, mark as not validated
            return cands
        allowed = {c["payload"]["indicator_id"] for c in cands}
        judged = {j.indicator_id: j for j in verdict.judgements if j.indicator_id in allowed}  # ids outside the list are ignored
        kept = []
        for c in cands:
            j = judged.get(c["payload"]["indicator_id"])
            if j is None or j.match == "none":
                continue
            c["validation"] = {"llm_validated": True, "match": j.match, "reason": j.reason}
            kept.append(c)
        kept.sort(key=lambda c: (c["validation"]["match"] != "exact", -c["score"]))
        return kept

    def _public(self, c):
        iid = c["payload"]["indicator_id"]
        con = c["concept"]
        amb = getattr(self, "ambiguity", None)
        out = {"candidate_id": c["candidate_id"], "indicator_id": iid, "term": self._term(iid, c["payload"]),
               "domain": c["payload"].get("domain") or con.get("domain"), "quote": c.get("quote"),
               "patient_concept": con.get("concept"), "polarity": con.get("polarity"),
               "currentness": con.get("currentness"), "intensity": con.get("intensity"),
               "match": c["validation"].get("match"), "llm_validated": c["validation"]["llm_validated"],
               "clarification_required": bool(amb.needs_clarification(iid)) if amb else False,
               "requires_confirmation": False,
               "evidence_recorded": bool(c.get("validation", {}).get("llm_validated")
                                          and c.get("validation", {}).get("match") == "exact")}
        if settings.expose_candidate_internals:
            out["score"], out["payload"] = c["score"], c["payload"]
        return out

    # ------------------------------------------------------------------ quadrants + questions
    def _exhausted(self, ctx):
        done = set()
        for name, st in ctx.quadrants.items():
            if st.get("completed") or self.questions.next_questions(name, st["answered_question_ids"], 1)["exhausted"]:
                done.add(name)
        return done

    def assessed_quadrants(self, ctx):
        n = settings.min_responses_per_quadrant_assessed
        return {name for name, st in ctx.quadrants.items()
                if st.get("completed") or len(st.get("answered_question_ids", [])) >= n or len(st.get("response_ids", [])) >= n}

    def recommend_quadrants(self, sid, current_issue=None, opening_answers=None):
        ctx = self._ctx(sid)
        concepts, texts = [], []
        for r in ctx.responses:
            texts.append(r.raw_text)
            for c in (r.extraction or {}).get("concepts", []):
                if c.get("polarity") != "negative" and c.get("domain") in {"symptom", "emotion", "behaviour"}:
                    concepts.append(c["concept"])
        rec = self.questions.recommend_quadrants(
            current_issue=current_issue or " ".join(texts), opening_answers=opening_answers,
            baseline=ctx.baseline, demographics=ctx.demographics, concepts=concepts,
            exhausted=self._exhausted(ctx), assessed=self.assessed_quadrants(ctx))
        ctx.patient_state["current_issue"] = current_issue
        ctx.audit("QUADRANT_RECOMMENDATION", recommendations=rec)
        return rec

    def select_quadrant(self, sid, quadrant):
        ctx = self._ctx(sid)
        if quadrant not in self.kb.quadrant_names:
            raise ValueError(f"Unknown quadrant: {quadrant}")
        st = self._q_state(ctx, quadrant)
        ctx.stage = AssessmentStage.PERSONALIZED_QUESTIONS.value
        ctx.patient_state["current_quadrant"] = quadrant
        ctx.audit("QUADRANT_SELECTED", quadrant=quadrant)
        return {**self._next_for(ctx, quadrant), "stage": ctx.stage}

    def _next_for(self, ctx, quadrant, limit=3):
        st = self._q_state(ctx, quadrant)
        page = self.questions.next_questions(quadrant, st["answered_question_ids"], limit)
        if st.get("completed"):
            page.update(questions=[], exhausted=True)
        if page["exhausted"]:
            others = self.questions.recommend_quadrants(
                current_issue=" ".join(r.raw_text for r in ctx.responses), exhausted=self._exhausted(ctx),
                assessed=self.assessed_quadrants(ctx),
                concepts=[c["concept"] for r in ctx.responses for c in (r.extraction or {}).get("concepts", [])])
            page["recommended_quadrants"] = others
            remaining = set(self.kb.quadrant_names) - self._exhausted(ctx)
            page["message"] = ("All questions for this quadrant are answered. Choose another quadrant, or view the result."
                               if others else ("No additional area is strongly indicated by the available responses. "
                                               "Choose another area if clinically appropriate, or view the result."
                                               if remaining else "Every quadrant is covered. You can view the final result."))
            page["all_quadrants_covered"] = not remaining
        return page

    def next_questions(self, sid, quadrant=None, limit=3):
        ctx = self._ctx(sid)
        quadrant = quadrant or ctx.patient_state.get("current_quadrant")
        if not quadrant:
            raise ValueError("No quadrant selected yet")
        if quadrant not in self.kb.quadrant_names:
            raise ValueError(f"Unknown quadrant: {quadrant}")
        return self._next_for(ctx, quadrant, limit)

    def complete_quadrant(self, sid, quadrant):
        ctx = self._ctx(sid)
        if quadrant not in self.kb.quadrant_names:
            raise ValueError(f"Unknown quadrant: {quadrant}")
        self._q_state(ctx, quadrant)["completed"] = True
        ctx.audit("QUADRANT_MARKED_COMPLETE_BY_THERAPIST", quadrant=quadrant)
        return self._next_for(ctx, quadrant)

    # ------------------------------------------------------------------ responses
    def process_response(self, sid, text, question_id=None, quadrant=None, *, request_id=None):
        ctx = self._ctx(sid)
        request_id = clean_request_id(request_id)

        payload = {"text": text, "question_id": question_id, "quadrant": quadrant}
        if request_id is not None:
            prior = ctx.processed_requests.get(request_id)
            if prior is not None:
                if prior["payload"] != payload:
                    raise ValueError("different patient response for the same request_id")
                replay = copy.deepcopy(prior["result"]); replay["idempotent_replay"] = True
                return replay
            inflight = ctx._inflight_requests.get(request_id)
            if inflight is not None:
                inflight.wait()
                prior = ctx.processed_requests.get(request_id)
                if prior is not None:
                    replay = copy.deepcopy(prior["result"]); replay["idempotent_replay"] = True
                    return replay
                raise ValueError("request still in progress")
            event = threading.Event()
            ctx._inflight_requests[request_id] = event

        try:
            guard = self._guard_safety(ctx)
            if guard:
                return guard
            response = ResponseService().create(text=text, question_id=question_id, quadrant=quadrant)
            result = self._analyze(ctx, response, text, session_id=sid, quadrant=quadrant)
            if quadrant and quadrant in ctx.quadrants:
                st = ctx.quadrants[quadrant]
                st["response_ids"].append(response.response_id)
                if question_id and question_id not in st["answered_question_ids"]:
                    st["answered_question_ids"].append(question_id)
            if request_id is not None:
                ctx.processed_requests[request_id] = {"payload": payload, "result": result}
            return result
        finally:
            if request_id is not None:
                event = ctx._inflight_requests.pop(request_id, None)
                if event is not None:
                    event.set()

    def acknowledge_safety(self, sid, therapist_note=None, resume=False):
        """Therapist acknowledges an AMBER alert, or clears a RED escalation (resume=True)."""
        ctx = self._ctx(sid)
        ctx.patient_state["safety_amber_unacknowledged"] = False
        was_red = ctx.stage == AssessmentStage.SAFETY_ESCALATION.value
        if was_red:
            if not resume:
                raise ValueError("A RED safety escalation stays in force until a therapist explicitly clears it (resume=true)")
            ctx.stage = AssessmentStage.QUADRANT_RECOMMENDATION.value
        ctx.audit("SAFETY_ACKNOWLEDGED", note=therapist_note, cleared_red=was_red)
        return {"status": "OK", "stage": ctx.stage}

    # ------------------------------------------------------------------ evidence
    def confirm_candidate(self, sid, response_id, candidate_id, confirmed=True,
                          status=EvidenceStatus.CONFIRMED, therapist_note=None,
                          selected_chakra=None, confirmation_actor="therapist"):
        ctx = self._ctx(sid)
        candidate = next((c for c in ctx.candidates if c["candidate_id"] == candidate_id), None)
        if not candidate:
            raise ValueError("Candidate not found")
        if not any(r.response_id == response_id for r in ctx.responses):
            raise ValueError("Response not found")
        if confirmation_actor not in {"patient", "therapist"}:
            raise ValueError("confirmation_actor must be patient or therapist")
        if not confirmed:
            ctx.audit("CANDIDATE_REJECTED", candidate_id=candidate_id, actor=confirmation_actor)
            return {"status": "REJECTED", "candidate_id": candidate_id}
        existing = next((e for e in ctx.evidence if e.candidate_id == candidate_id), None)
        if existing:
            ambiguity = getattr(self, "ambiguity", None)
            clarification_required = existing.status == EvidenceStatus.UNRESOLVED
            clarifications = ambiguity.for_indicator(existing.canonical_indicator_id) if clarification_required and ambiguity else []
            twin_ids = [e.evidence_id for e in ctx.evidence if e.twin_of == existing.evidence_id]
            return {"status": "ALREADY_CONFIRMED", "evidence": existing.model_dump(),
                    "clarification_required": clarification_required, "clarifications": clarifications,
                    "twin_evidence_ids": twin_ids}
        iid = candidate["payload"]["indicator_id"]
        if self.ambiguity.needs_clarification(iid) and status == EvidenceStatus.CONFIRMED:
            status = EvidenceStatus.UNRESOLVED
        conf = {f"{confirmation_actor}_confirmed": True, "therapist_note": therapist_note}
        # A chakra chosen at confirmation time is NOT accepted: the chakra only counts once it is
        # resolved through the KB disambiguation step (resolve_ambiguity).
        ev = self.evidence_engine.build_evidence(response_id=response_id, candidate=candidate,
                                                 extraction=candidate["concept"], status=status,
                                                 confirmation=conf, selected_chakra=None)
        if ev is None:
            raise ValueError("Candidate is not a canonical indicator")
        ctx.evidence.append(ev)
        twins = []
        for tid in self.indicators.twins(iid):
            tw = self.evidence_engine.build_evidence(response_id=response_id, candidate=candidate,
                                                     extraction=candidate["concept"], status=status,
                                                     confirmation=conf, indicator_id=tid, twin_of=ev.evidence_id)
            if tw is not None:
                ctx.evidence.append(tw); twins.append(tw.evidence_id)
        ctx.audit("EVIDENCE_CONFIRMED", evidence_id=ev.evidence_id, indicator_id=ev.canonical_indicator_id,
                  status=ev.status.value, actor=confirmation_actor, twin_evidence_ids=twins)
        out = {"status": "CONFIRMED", "evidence": ev.model_dump(),
               "clarification_required": status == EvidenceStatus.UNRESOLVED,
               "clarifications": self.ambiguity.for_indicator(ev.canonical_indicator_id),
               "twin_evidence_ids": twins}
        if selected_chakra:
            out["warning"] = "selected_chakra ignored at confirmation; use the disambiguation step"
        return out

    def resolve_ambiguity(self, sid, evidence_id, selected_chakra, therapist_note=None):
        ctx = self._ctx(sid)
        ev = next((e for e in ctx.evidence if e.evidence_id == evidence_id), None)
        if not ev:
            raise ValueError("Evidence not found")
        valid = {i.chakra for i in self.indicators.get_by_id(ev.canonical_indicator_id)}
        if selected_chakra not in valid:
            raise ValueError("Selected chakra is not an authoritative association for this indicator")
        group = [ev] + [e for e in ctx.evidence if e.twin_of == ev.evidence_id]
        for e in group:
            if selected_chakra in {i.chakra for i in self.indicators.get_by_id(e.canonical_indicator_id)}:
                e.status = EvidenceStatus.RESOLVED_AFTER_CLARIFICATION; e.selected_chakra = selected_chakra
                e.confirmation = {**e.confirmation, "therapist_note": therapist_note, "resolved_after_clarification": True}
        ctx.clarifications.append({"evidence_id": evidence_id, "selected_chakra": selected_chakra, "therapist_note": therapist_note})
        ctx.audit("AMBIGUITY_RESOLVED", evidence_id=evidence_id, selected_chakra=selected_chakra)
        return ev

    def resolve_contradiction(self, sid, keep_evidence_id, therapist_note=None):
        """Therapist keeps one side. The other side is marked superseded (kept for audit, never scored)."""
        ctx = self._ctx(sid)
        self.score(sid)  # refresh contradictions
        keep = next((e for e in ctx.evidence if e.evidence_id == keep_evidence_id), None)
        if not keep:
            raise ValueError("Evidence not found")
        hit = next((c for c in ctx.contradictions
                    if keep_evidence_id in (c.get("positive_evidence_ids") or []) + (c.get("negative_evidence_ids") or [])
                    + (c.get("evidence_ids") or [])), None)
        if not hit:
            raise ValueError("Evidence is not part of an open contradiction")
        involved = set((hit.get("positive_evidence_ids") or []) + (hit.get("negative_evidence_ids") or []) + (hit.get("evidence_ids") or []))
        keep_group = {keep_evidence_id} | {e.evidence_id for e in ctx.evidence if e.twin_of == keep_evidence_id or e.evidence_id == keep.twin_of}
        for e in ctx.evidence:
            if e.evidence_id in involved and e.evidence_id not in keep_group:
                e.superseded, e.superseded_by = True, keep_evidence_id
        ctx.audit("CONTRADICTION_RESOLVED", kept=keep_evidence_id, note=therapist_note)
        return {"status": "RESOLVED", "kept": keep_evidence_id, "superseded": sorted(involved - keep_group)}

    # ------------------------------------------------------------------ deep dive
    def deep_dive_items(self, sid, therapist_stop=False):
        ctx = self._ctx(sid)
        guard = self._guard_safety(ctx)
        if guard:
            return guard
        blocked = bool(ctx.patient_state.get("safety_amber_unacknowledged"))
        res = self.deep_dive.open_items(ctx.evidence, therapist_stop=therapist_stop or ctx.stop_requested, safety_blocked=blocked)
        by_id = {e.evidence_id: e for e in ctx.evidence}
        for it in res["items"]:
            self.deep_dive.mark_presented(by_id[it["evidence_id"]], it["field"])
        if res["items"]:
            ctx.stage = AssessmentStage.DEEP_DIVE.value
        ctx.audit("DEEP_DIVE_PRESENTED", count=len(res["items"]), stop_reason=res.get("stop_reason"))
        return res

    def answer_deep_dive(self, sid, evidence_id, field, value, raw_text=None):
        ctx = self._ctx(sid)
        ev = next((e for e in ctx.evidence if e.evidence_id == evidence_id), None)
        if not ev:
            raise ValueError("Evidence not found")
        if ev.superseded:
            raise ValueError("Evidence was superseded")
        if raw_text and raw_text.strip():  # the patient's own words are kept, never replaced by the structured value
            rec = ResponseService().create(text=raw_text.strip(), question_id=f"DD-{field}", quadrant=None)
            rec.safety_status = self.safety.assess(raw_text)["status"]
            ctx.add_response(rec)
            if rec.safety_status == "ESCALATE":
                ctx.stage = AssessmentStage.SAFETY_ESCALATION.value
                ctx.audit("SAFETY_ESCALATION", response_id=rec.response_id)
                return {"status": "SAFETY_ESCALATION", "response_id": rec.response_id}
        self.deep_dive.apply_answer(ev, field, value)
        ctx.audit("DEEP_DIVE_ANSWERED", evidence_id=evidence_id, field=field)
        return {"status": "OK", "evidence": ev.model_dump()}

    # ------------------------------------------------------------------ scoring / decision / result
    def score(self, sid):
        ctx = self._ctx(sid)
        contradictions = self.contradictions.find(ctx.evidence, self.indicators)
        ctx.contradictions = contradictions
        report = self.scoring.score(ctx.evidence, contradictions=contradictions,
                                    assessed_quadrants=self.assessed_quadrants(ctx),
                                    responses={r.response_id: r.raw_text for r in ctx.responses})
        ctx.stage = AssessmentStage.CHAKRA_SCORING.value
        ctx.audit("CHAKRA_SCORED", supported=report.supported_chakras)
        return report

    def decision(self, sid, therapist_stop=False):
        ctx = self._ctx(sid)
        report = self.score(sid)
        assessed = self.assessed_quadrants(ctx)
        d = self.decisions.decide(report, assessed_quadrants=assessed, therapist_stop=therapist_stop)
        d.recommended_quadrants = [r["quadrant"] for r in self.recommend_quadrants(sid)]
        if therapist_stop:
            ctx.stop_requested = True; ctx.stage = AssessmentStage.COMPLETED.value
        else:
            ctx.stage = AssessmentStage.DEEP_DIVE.value if report.supported_chakras else AssessmentStage.QUADRANT_RECOMMENDATION.value
        ctx.audit("THERAPIST_ASSESSMENT_DECISION", decision=d.action, stop=therapist_stop)
        return {**d.as_dict(), "stage": ctx.stage, "chakra_report": report.model_dump()}

    def final_result(self, sid):
        """Everything the result window needs. Decision SUPPORT for the therapist, not a diagnosis."""
        ctx = self._ctx(sid)
        stage_before = ctx.stage
        report = self.score(sid)
        ctx.stage = stage_before
        cards = []
        for r in report.results:
            cards.append({
                "chakra": r.chakra, "status": r.status, "status_label": r.status_label, "status_code": r.status_code,
                "direction": r.direction, "severity": r.severity,
                "scores": {"presence": r.presence_score, "deficient": r.deficient_score, "excess": r.excess_score},
                "confidence_pct": r.confidence_pct, "confidence_label": r.confidence_label,
                "coverage_pct": r.coverage_pct, "independent_evidence_units": r.independent_evidence_units,
                "high_priority": r.high_priority, "direction_gray_zone": r.direction_gray_zone,
                "reasons": r.reasons, "pending_details": r.pending_details,
                "counts": {"evidence": len(r.evidence_ids), "negative": len(r.negative_evidence_ids),
                           "historical": len(r.historical_evidence_ids), "unresolved": len(r.unresolved_evidence_ids),
                           "non_directional": len(r.nondirectional_evidence_ids)},
                "trace": [t.model_dump() for t in r.trace],
            })
        def names(*codes):
            return [c["chakra"] for c in cards if c["status"] in codes]
        all_names = [q for q in self.kb.quadrant_names]
        assessed = sorted(self.assessed_quadrants(ctx))
        dd = self.deep_dive.open_items(ctx.evidence)
        return {
            "session_id": sid, "stage": ctx.stage, "is_diagnosis": False, "therapist_approval_required": True,
            "summary": {
                "imbalanced": [c["chakra"] for c in cards if c["status"].startswith("IMBALANCED")],
                "balanced": names("BALANCED"),
                "unresolved": names("UNRESOLVED"),
                "needs_therapist_review": [c["chakra"] for c in cards if c["high_priority"] or c["direction_gray_zone"]],
            },
            "chakras": cards,
            "coverage": {**report.coverage, "assessed_quadrants": assessed,
                         "not_yet_assessed_quadrants": [q for q in all_names if q not in assessed]},
            "open_items": {
                "contradictions": ctx.contradictions,
                "pending_deep_dive": [i for i in dd["items"] if i["blocking"]],
                "unresolved_evidence": [e.evidence_id for e in ctx.evidence if e.status == EvidenceStatus.UNRESOLVED and not e.superseded],
                "safety_amber_unacknowledged": bool(ctx.patient_state.get("safety_amber_unacknowledged")),
                "safety_red_active": ctx.stage == AssessmentStage.SAFETY_ESCALATION.value,
            },
            "scoring_audit": report.audit,
            "requires_domain_validation": _OPEN_REQUIRES_VALIDATION,
            "disclaimer": "Decision-support only. Scores show how much confirmed patient evidence points to each chakra; "
                          "they are not a diagnosis. A therapist must review and approve.",
        }

    def recommendations(self, sid, current_time_label=None, preferences=None):
        ctx = self._ctx(sid); report = self.score(sid)
        activities = self.activities.candidates_for_chakras(report.supported_chakras)
        ragas = self.ragas.candidates(approved_chakras=report.supported_chakras, current_time_label=current_time_label, preferences=preferences)
        logging.getLogger("anahat.scoring").debug(
            "raag_candidates supported_chakras=%s candidates=%s",
            report.supported_chakras, ragas.get("candidates", []),
        )
        ctx.stage = AssessmentStage.RAGA_REVIEW.value
        ctx.audit("RECOMMENDATIONS_PREPARED", activity_count=len(activities), raga_count=len(ragas["candidates"]))
        return {"chakra_report": report.model_dump(), "raga": ragas, "activities": activities, "therapist_approval_required": True}

    def prescription(self, sid):
        ctx = self._ctx(sid); rec = self.recommendations(sid)
        ctx.stage = AssessmentStage.PRESCRIPTION.value
        return self.prescriptions.draft(patient_id=ctx.demographics["patient_id"], findings=rec["chakra_report"]["results"],
                                        raga_candidates=rec["raga"]["candidates"], activities=rec["activities"])
