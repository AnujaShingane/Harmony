from app.knowledge.loader import KnowledgeBase
from app.services.assessment_service import AssessmentService
from app.models.assessment import AssessmentCreate, BaselineCreate
from app.llm.schemas import SemanticExtraction, ExtractedConcept

class FakeLLM:
    def extract_semantics(self,text,context=None):
        return SemanticExtraction(concepts=[ExtractedConcept(concept='abdominal cramps',domain='symptom',polarity='positive',currentness='current',certainty='certain',intensity='Severe',context='stress',trigger='stress',frequency='sometimes',clarification_required=True)])
class FakeResult:
    score=.95; payload={'indicator_id':'SYM-001','ailment':'Abdominal cramps','diagnostic_type':'ambiguous'}
class FakeRetriever:
    def search(self,q): return [FakeResult()]

def test_end_to_end_candidate_to_unresolved_evidence():
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

    opening = svc.get_opening_questions(sid)

    assert opening["title"] == "Opening Questions"
    assert len(opening["questions"]) == 4

    svc.submit_opening_response(
        sid,
        "I have been experiencing abdominal cramps and stress-related discomfort.",
    )

    svc.select_quadrant(sid, "Lifestyle")
    out = svc.process_response(sid, "I keep getting stomach cramps")
    assert out["status"] == "OK" and out["candidate_count"] == 1
    conf = svc.confirm_candidate(
        sid, out["response_id"], out["candidates"][0]["candidate_id"], True
    )
    assert conf["clarification_required"] is True
