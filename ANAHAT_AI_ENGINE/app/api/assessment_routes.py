import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.models.assessment import AssessmentCreate, AssessmentResponse, BaselineCreate, QuadrantSelection
from app.models.response import PatientResponseCreate, ConfirmationRequest
from app.core.enums import EvidenceStatus
from app.core.exceptions import LLMServiceError
from app.core.config import settings
from app.api.llm_errors import GENERIC_PROCESSING_ERROR, clean_request_id, llm_error_response
from app.knowledge.loader import KnowledgeBase
from app.llm.gemini_provider import GeminiProvider
from app.llm.resilient import build_llm_provider
from app.retrieval.retriever import KnowledgeRetriever
from app.services.assessment_service import AssessmentService
from app.llm.openrouter_provider import OpenRouterProvider

router=APIRouter()
_kb=KnowledgeBase().load_directory(settings.kb_path)
_service=AssessmentService(kb=_kb, llm=None, retriever=None)


def _route_error_response(exc: Exception) -> JSONResponse:
    if isinstance(exc, LLMServiceError):
        return llm_error_response(exc)

    logging.getLogger("anahat.api").exception("assessment_route_unexpected_error")
    return JSONResponse(
        status_code=502,
        content={"detail": GENERIC_PROCESSING_ERROR, "error_code": "INTERNAL_ERROR", "retryable": True},
    )

@router.post('/sessions', response_model=AssessmentResponse)
def create_session(request: AssessmentCreate):
    return _service.create_session(request)

@router.post('/sessions/{session_id}/baseline')
def baseline(session_id: str, request: BaselineCreate):
    return _service.set_baseline(session_id, request)
@router.get('/sessions/{session_id}/opening-questions')
def opening_questions(session_id: str):
    try:
        return _service.get_opening_questions(session_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/sessions/{session_id}/opening-response')
def opening_response(session_id: str, request: PatientResponseCreate):
    try:
        return _runtime_service().submit_opening_response(
            session_id,
            request.text,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
@router.get('/sessions/{session_id}/quadrants')
def quadrants(session_id: str, current_issue: str | None = None):
    return _service.recommend_quadrants(session_id, current_issue=current_issue)

@router.post('/sessions/{session_id}/quadrants/select')
def select_quadrant(session_id: str, request: QuadrantSelection):
    return _service.select_quadrant(session_id, request.quadrant)

def _runtime_service():
    if _service.llm is None:
        _service.llm = build_llm_provider()

    if _service.retriever is None:
        _service.retriever = KnowledgeRetriever()

    return _service

@router.post('/sessions/{session_id}/responses')
async def response(session_id: str, request: PatientResponseCreate, req: Request):
    raw_key = req.headers.get("Idempotency-Key")

    try:
        request_id = clean_request_id(raw_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        return _runtime_service().process_response(session_id, request.text, request.question_id, request.quadrant, request_id=request_id)
    except LLMServiceError as exc:
        return llm_error_response(exc)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        return _route_error_response(exc)

@router.post('/sessions/{session_id}/candidates/{candidate_id}/confirm')
def confirm(session_id: str,candidate_id: str,request: ConfirmationRequest,response_id: str,selected_chakra: str | None = None):
    try: return _runtime_service().confirm_candidate(session_id,response_id,candidate_id,request.confirmed,request.evidence_status,request.therapist_note,selected_chakra,request.confirmation_actor)
    except Exception as exc: raise HTTPException(status_code=400,detail=str(exc)) from exc

@router.get('/sessions/{session_id}/chakra-report')
def chakra_report(session_id: str):
    try: return _runtime_service().score(session_id)
    except Exception as exc: raise HTTPException(status_code=400,detail=str(exc)) from exc

@router.post('/sessions/{session_id}/decision')
def therapist_decision(session_id: str, stop: bool = False):
    try:
        return _runtime_service().decision(session_id, therapist_stop=stop)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
