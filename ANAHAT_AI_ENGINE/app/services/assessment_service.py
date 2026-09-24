from __future__ import annotations

import copy
import threading
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
from app.services.prescription_service import PrescriptionService
from app.services.question_service import QuestionService
from app.services.raga_service import RagaService
from app.services.response_service import ResponseService
from app.services.safety_service import SafetyService


class AssessmentService:
    _sessions = {}

    def __init__(self, kb=None, llm=None, retriever=None):
        self.kb, self.llm, self.retriever = kb, llm, retriever
        if kb:
            self.indicators = IndicatorRepository(kb)
            self.evidence_engine = EvidenceEngine(self.indicators)
            self.scoring = ScoringEngine(kb)
            self.questions = QuestionService(kb)
            self.ambiguity = AmbiguityService(kb)
            self.contradictions = ContradictionService()
            self.safety = SafetyService(kb)
            self.activities = ActivityService(ActivityRepository(kb))
            self.ragas = RagaService(kb)
            self.prescriptions = PrescriptionService()
            self.decisions = DecisionEngine()

    @classmethod
    def get(cls, session_id):
        return cls._sessions.get(session_id)

    def _ctx(self, sid):
        ctx = self._sessions.get(sid)
        if ctx is None:
            raise ValueError("Assessment session not found")
        return ctx

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
        ctx=self._ctx(sid)
        if ctx.baseline: raise ValueError("Baseline ratings are permanent and can only be recorded once")
        ctx.baseline=baseline.model_dump(); ctx.stage=AssessmentStage.OPENING.value
        ctx.audit("BASELINE_RECORDED"); return {"session_id":sid,"baseline":ctx.baseline,"stage":ctx.stage}

    def get_opening_questions(self, sid):
        ctx = self._ctx(sid)

        if ctx.stage != AssessmentStage.OPENING.value:
            raise ValueError("Opening Questions can only be accessed during the opening stage")

        questions = self.questions.get_opening_questions()

        if len(questions) != 4:
            raise ValueError("Opening Questions must contain exactly 4 canonical questions")

        ctx.patient_state["opening_questions"] = questions
        ctx.audit("OPENING_QUESTIONS_PRESENTED")

        return {
            "session_id": sid,
            "title": "Opening Questions",
            "questions": questions,
            "stage": ctx.stage
        }
    def submit_opening_response(self, sid, text):
            ctx = self._ctx(sid)

            if ctx.stage != AssessmentStage.OPENING.value:
                raise ValueError("Opening response can only be submitted during the opening stage")

            if not text or not text.strip():
                raise ValueError("Opening response cannot be empty")

            questions = self.questions.get_opening_questions()

            if len(questions) != 4:
                raise ValueError("Opening Questions must contain exactly 4 canonical questions")

            ctx.patient_state["opening_questions"] = questions
            ctx.patient_state["opening_response"] = text.strip()

            response = ResponseService().create(
                text=text.strip(),
                question_id=None,
                quadrant=None,
            )

            safety = self.safety.assess(text.strip())
            response.safety_status = safety["status"]
            ctx.add_response(response)

            ctx.audit(
                "OPENING_RESPONSE_SUBMITTED",
                response_id=response.response_id,
            )

            if safety["status"] == "ESCALATE":
                ctx.stage = AssessmentStage.SAFETY_ESCALATION.value
                ctx.audit("SAFETY_ESCALATION", details=safety)

                return {
                    "status": "SAFETY_ESCALATION",
                    "response_id": response.response_id,
                    "safety": safety,
                }

            opening_context = {
                "opening_questions": questions,
                "opening_response": text.strip(),
                "baseline": ctx.baseline,
            }

            if self.llm is None:
                raise RuntimeError(
                    "LLM provider is required for Opening Response analysis"
                )

            extraction = self.llm.extract_semantics(
                text.strip(),
                context=opening_context,
            )

            response.extraction = extraction.model_dump()

            ctx.stage = AssessmentStage.QUADRANT_RECOMMENDATION.value

            ctx.audit(
                "OPENING_RESPONSE_ANALYZED",
                response_id=response.response_id,
            )

            return {
                "status": "OK",
                "response_id": response.response_id,
                "opening_questions": questions,
                "extraction": extraction.model_dump(),
                "stage": ctx.stage,
            }
    def recommend_quadrants(self, sid, current_issue=None, opening_answers=None):
        ctx=self._ctx(sid)
        response_text = " ".join(r.raw_text for r in ctx.responses)
        response_extractions = [r.extraction or {} for r in ctx.responses if r.extraction]
        rec=self.questions.recommend_quadrants(
            current_issue=current_issue or response_text,
            opening_answers=opening_answers or {"text": response_text, "extractions": response_extractions},
            baseline=ctx.baseline,
            demographics=ctx.demographics,
        )
        ctx.patient_state["current_issue"]=current_issue; ctx.audit("QUADRANT_RECOMMENDATION",recommendations=rec)
        return rec

    def select_quadrant(self, sid, quadrant):
        ctx=self._ctx(sid)
        if quadrant not in self.kb.quadrant_names: raise ValueError(f"Unknown quadrant: {quadrant}")
        ctx.quadrants.setdefault(quadrant,{"assessed_attributes":set(),"question_ids":[]})
        ctx.stage=AssessmentStage.PERSONALIZED_QUESTIONS.value
        qs=self.questions.personalized_questions(quadrant)
        ctx.quadrants[quadrant]["question_ids"]=[q["id"] for q in qs]
        ctx.audit("QUADRANT_SELECTED",quadrant=quadrant)
        return {"quadrant":quadrant,"questions":qs,"stage":ctx.stage}

    def process_response(self, sid, text, question_id=None, quadrant=None, *, request_id=None):
        ctx = self._ctx(sid)
        request_id = clean_request_id(request_id)

        if request_id is not None:
            payload = {"text": text, "question_id": question_id, "quadrant": quadrant}
            prior = ctx.processed_requests.get(request_id)
            if prior is not None:
                if prior["payload"] != payload:
                    raise ValueError("different patient response for the same request_id")
                replay = copy.deepcopy(prior["result"])
                replay["idempotent_replay"] = True
                return replay

            inflight = ctx._inflight_requests.get(request_id)
            if inflight is not None:
                inflight.wait()
                prior = ctx.processed_requests.get(request_id)
                if prior is not None:
                    replay = copy.deepcopy(prior["result"])
                    replay["idempotent_replay"] = True
                    return replay
                raise ValueError("request still in progress")

            event = threading.Event()
            ctx._inflight_requests[request_id] = event

        try:
            response = ResponseService().create(text=text, question_id=question_id, quadrant=quadrant)
            safety = self.safety.assess(text)
            response.safety_status = safety["status"]

            if quadrant and quadrant in ctx.quadrants:
                ctx.quadrants[quadrant].setdefault("response_ids", []).append(response.response_id)

            if safety["status"] == "ESCALATE":
                ctx.stage = AssessmentStage.SAFETY_ESCALATION.value
                ctx.audit("SAFETY_ESCALATION", details=safety)
                result = {"status": "SAFETY_ESCALATION", "response_id": response.response_id, "safety": safety}
                ctx.add_response(response)
                ctx.audit("RAW_RESPONSE_STORED", response_id=response.response_id)
                if request_id is not None:
                    ctx.processed_requests[request_id] = {"payload": {"text": text, "question_id": question_id, "quadrant": quadrant}, "result": result}
                return result

            if self.llm is None or self.retriever is None:
                raise RuntimeError("LLM provider and retriever are required for semantic assessment")

            extraction = self.llm.extract_semantics(text, context=ctx.summary())
            response.extraction = extraction.model_dump()

            all_candidates = []
            for concept in extraction.concepts:
                if concept.domain not in {"symptom", "emotion", "behaviour"}:
                    continue
                query = "; ".join(x for x in [concept.concept, concept.context, concept.trigger] if x)
                if not query:
                    continue
                for r in self.retriever.search(query):
                    if candidate_is_usable(r, score_threshold=settings.retrieval_score_threshold):
                        payload = getattr(r, "payload", {}) or {}
                        iid = payload.get("indicator_id")
                        if iid and self.indicators.validate_candidate(iid, payload):
                            all_candidates.append({"candidate_id": str(uuid4()), "score": float(getattr(r, "score", 0.0)), "payload": payload, "concept": concept.model_dump()})

            best = {}
            for c in all_candidates:
                iid = c["payload"].get("indicator_id")
                if iid and (iid not in best or c["score"] > best[iid]["score"]):
                    best[iid] = c

            candidates = sorted(best.values(), key=lambda x: x["score"], reverse=True)
            ctx.add_response(response)
            ctx.audit("RAW_RESPONSE_STORED", response_id=response.response_id)
            ctx.candidates.extend(candidates)
            ctx.stage = AssessmentStage.EVIDENCE_REVIEW.value

            result = {"status": "OK" if candidates else "NO_VALID_INDICATOR", "response_id": response.response_id,
                      "extraction": extraction.model_dump(), "candidates": candidates, "candidate_count": len(candidates)}
            if request_id is not None:
                ctx.processed_requests[request_id] = {"payload": {"text": text, "question_id": question_id, "quadrant": quadrant}, "result": result}
            return result
        finally:
            if request_id is not None:
                event = ctx._inflight_requests.pop(request_id, None)
                if event is not None:
                    event.set()

    def confirm_candidate(self, sid, response_id, candidate_id, confirmed=True,
                          status=EvidenceStatus.CONFIRMED, therapist_note=None,
                          selected_chakra=None, confirmation_actor="therapist"):
        ctx=self._ctx(sid); candidate=next((c for c in ctx.candidates if c["candidate_id"]==candidate_id),None)
        if not candidate: raise ValueError("Candidate not found")
        if not any(r.response_id==response_id for r in ctx.responses): raise ValueError("Response not found")
        if confirmation_actor not in {"patient","therapist"}: raise ValueError("confirmation_actor must be patient or therapist")
        if not confirmed:
            ctx.audit("CANDIDATE_REJECTED",candidate_id=candidate_id,actor=confirmation_actor)
            return {"status":"REJECTED","candidate_id":candidate_id}
        iid=candidate["payload"]["indicator_id"]
        if self.ambiguity.needs_clarification(iid) and status==EvidenceStatus.CONFIRMED:
            status=EvidenceStatus.UNRESOLVED
        ev=self.evidence_engine.build_evidence(response_id=response_id,candidate=candidate,
            extraction=candidate["concept"],status=status,
            confirmation={f"{confirmation_actor}_confirmed":True,"therapist_note":therapist_note},selected_chakra=selected_chakra)
        if ev is None: raise ValueError("Candidate is not a canonical indicator")
        ctx.evidence.append(ev); ctx.audit("EVIDENCE_CONFIRMED",evidence_id=ev.evidence_id,
                                           indicator_id=ev.canonical_indicator_id,status=ev.status.value,actor=confirmation_actor)
        return {"status":"CONFIRMED","evidence":ev.model_dump(),"clarification_required":status==EvidenceStatus.UNRESOLVED,
                "clarifications":self.ambiguity.for_indicator(ev.canonical_indicator_id)}

    def resolve_ambiguity(self,sid,evidence_id,selected_chakra,therapist_note=None):
        ctx=self._ctx(sid); ev=next((e for e in ctx.evidence if e.evidence_id==evidence_id),None)
        if not ev: raise ValueError("Evidence not found")
        valid={i.chakra for i in self.indicators.get_by_id(ev.canonical_indicator_id)}
        if selected_chakra not in valid: raise ValueError("Selected chakra is not an authoritative association for this indicator")
        ev.status=EvidenceStatus.RESOLVED_AFTER_CLARIFICATION; ev.selected_chakra=selected_chakra
        ev.confirmation={**ev.confirmation,"therapist_note":therapist_note,"resolved_after_clarification":True}
        ctx.clarifications.append({"evidence_id":evidence_id,"selected_chakra":selected_chakra,"therapist_note":therapist_note})
        ctx.audit("AMBIGUITY_RESOLVED",evidence_id=evidence_id,selected_chakra=selected_chakra); return ev

    def score(self,sid):
        ctx=self._ctx(sid); contradictions=self.contradictions.find(ctx.evidence,self.indicators); ctx.contradictions=contradictions
        report=self.scoring.score(ctx.evidence,contradictions=contradictions,assessed_quadrants=set(ctx.quadrants))
        ctx.stage=AssessmentStage.CHAKRA_SCORING.value; ctx.audit("CHAKRA_SCORED",supported=report.supported_chakras)
        return report

    def decision(self,sid,therapist_stop=False):
        ctx=self._ctx(sid); report=self.score(sid)
        d=self.decisions.decide(report,assessed_quadrants=set(ctx.quadrants),therapist_stop=therapist_stop)
        d.recommended_quadrants=self.decisions.next_quadrants(self.kb,assessed_quadrants=set(ctx.quadrants))
        if therapist_stop:
            ctx.stop_requested=True; ctx.stage=AssessmentStage.COMPLETED.value
        else: ctx.stage=AssessmentStage.DEEP_DIVE.value if report.supported_chakras else AssessmentStage.QUADRANT_RECOMMENDATION.value
        ctx.audit("THERAPIST_ASSESSMENT_DECISION",decision=d.action,stop=therapist_stop)
        return {**d.as_dict(),"stage":ctx.stage,"chakra_report":report.model_dump()}

    def recommendations(self,sid,current_time_label=None,preferences=None):
        ctx=self._ctx(sid); report=self.score(sid)
        activities=self.activities.candidates_for_chakras(report.supported_chakras)
        ragas=self.ragas.candidates(approved_chakras=report.supported_chakras,current_time_label=current_time_label,preferences=preferences)
        ctx.stage=AssessmentStage.RAGA_REVIEW.value; ctx.audit("RECOMMENDATIONS_PREPARED",activity_count=len(activities),raga_count=len(ragas["candidates"]))
        return {"chakra_report":report.model_dump(),"raga":ragas,"activities":activities,"therapist_approval_required":True}

    def prescription(self,sid):
        ctx=self._ctx(sid); rec=self.recommendations(sid)
        ctx.stage=AssessmentStage.PRESCRIPTION.value
        return self.prescriptions.draft(patient_id=ctx.demographics["patient_id"],findings=rec["chakra_report"]["results"],
                                        raga_candidates=rec["raga"]["candidates"],activities=rec["activities"])
