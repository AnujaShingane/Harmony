from app.knowledge.loader import KnowledgeBase
from app.services.assessment_service import AssessmentService
from app.models.assessment import AssessmentCreate, BaselineCreate
from app.llm.schemas import CandidateJudgement, CandidateValidation, SemanticExtraction, ExtractedConcept
from fastapi import FastAPI
from fastapi.testclient import TestClient

class FakeLLM:
    def extract_semantics(self,text,context=None):
        return SemanticExtraction(concepts=[ExtractedConcept(concept='abdominal cramps',evidence_quote=None,domain='symptom',polarity='positive',currentness='current',certainty='certain',intensity='Severe',context='stress',trigger='stress',frequency='sometimes',clarification_required=True)])
    def validate_candidates(self,text,concept,candidates):
        return CandidateValidation(judgements=[CandidateJudgement(
            indicator_id=c['indicator_id'],
            match='exact' if c['term'].lower() == concept['concept'].lower() else 'none')
            for c in candidates])
class FakeResult:
    score=.95; payload={'indicator_id':'SYM-001','ailment':'Abdominal cramps','diagnostic_type':'ambiguous'}
class FakeRetriever:
    def search(self,q): return [FakeResult()]

def test_end_to_end_patient_session_response_becomes_evidence_without_confirmation():
    kb=KnowledgeBase().load_directory('knowledge_base/ANAHAT_KnowledgeBase_v3'); svc=AssessmentService(kb=kb,llm=FakeLLM(),retriever=FakeRetriever())
    created=svc.create_session(AssessmentCreate(patient_id='p1')); sid=created.session_id
    svc.set_baseline(
    sid,
    BaselineCreate(
        stress=5,
        anxiety=5,
        mood=5,
        sleep_quality='Good',
        energy=5,
    ),
    )

    styles = svc.get_opening_questions(sid)
    assert len(styles["styles"]) == 10
    opening = svc.get_opening_questions(sid, style="C")
    assert opening["title"] == "Opening Questions"
    assert 2 <= len(opening["questions"]) <= 3

    opening_response = svc.submit_opening_response(
        sid,
        "I have been experiencing abdominal cramps and stress-related discomfort.",
    )
    assert len(opening_response["evidence"]) == 1
    assert opening_response["evidence"][0]["confirmation"]["patient_confirmed"] is True

    svc.select_quadrant(sid, "Lifestyle")
    out = svc.process_response(sid, "I keep getting abdominal cramps")
    assert out["status"] == "OK" and out["candidate_count"] == 1
    assert len(out["evidence"]) == 1
    assert out["evidence"][0]["confirmation"]["patient_confirmed"] is True
    assert out["candidates"][0]["requires_confirmation"] is False


def test_opening_response_route_completes_assessment_to_final_result(monkeypatch):
    import app.api.assessment_routes as assessment_routes
    from app.api.recommendation_routes import router as recommendation_router

    kb = KnowledgeBase().load_directory('knowledge_base/ANAHAT_KnowledgeBase_v3')
    service = AssessmentService(kb=kb, llm=FakeLLM(), retriever=FakeRetriever())
    monkeypatch.setattr(assessment_routes, '_service', service)

    app = FastAPI()
    app.include_router(assessment_routes.router, prefix='/assessment')
    app.include_router(recommendation_router, prefix='/recommendations')
    client = TestClient(app, raise_server_exceptions=False)

    created = client.post('/assessment/sessions', json={'patient_id': 'integration-patient'})
    assert created.status_code == 200
    session_id = created.json()['session_id']

    baseline = client.post(f'/assessment/sessions/{session_id}/baseline', json={
        'stress': 5,
        'anxiety': 5,
        'mood': 5,
        'sleep_quality': 'Good',
        'energy': 5,
    })
    assert baseline.status_code == 200

    styles = client.get(f'/assessment/sessions/{session_id}/opening-questions')
    assert styles.status_code == 200 and len(styles.json()['styles']) == 10
    questions = client.get(f'/assessment/sessions/{session_id}/opening-questions', params={'style': 'A'})
    assert questions.status_code == 200
    assert 2 <= len(questions.json()['questions']) <= 3

    opening = client.post(
        f'/assessment/sessions/{session_id}/opening-response',
        json={'text': 'I have been experiencing abdominal cramps and stress-related discomfort.'},
    )
    assert opening.status_code == 200
    assert opening.json()['status'] == 'OK'

    selected = client.post(
        f'/assessment/sessions/{session_id}/quadrants/select',
        json={'quadrant': 'Lifestyle'},
    )
    assert selected.status_code == 200

    response = client.post(
        f'/assessment/sessions/{session_id}/responses',
        json={'text': 'The abdominal cramps happen sometimes when I am stressed.', 'quadrant': 'Lifestyle'},
    )
    assert response.status_code == 200
    assert response.json()['candidate_count'] == 1
    assert len(response.json()['evidence']) == 1
    assert response.json()['evidence'][0]['confirmation']['patient_confirmed'] is True

    decision = client.post(f'/assessment/sessions/{session_id}/decision', params={'stop': 'true'})
    assert decision.status_code == 200
    assert decision.json()['stage'] == 'completed'
    assert 'chakra_report' in decision.json()

    recommendations = client.get(f'/recommendations/sessions/{session_id}')
    assert recommendations.status_code == 200
    assert 'chakra_report' in recommendations.json()
    assert 'raga' in recommendations.json()
