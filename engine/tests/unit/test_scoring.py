from app.knowledge.loader import KnowledgeBase
from app.knowledge.indicator_repository import IndicatorRepository
from app.engine.evidence_engine import EvidenceEngine
from app.engine.scoring_engine import ScoringEngine
from app.core.enums import EvidenceStatus

def make_ev(eid,rid,iid,intensity='Severe'):
    kb=KnowledgeBase().load_directory('knowledge_base/ANAHAT_KnowledgeBase_v3'); repo=IndicatorRepository(kb); eng=EvidenceEngine(repo)
    return eng.build_evidence(response_id=rid,candidate={"candidate_id":eid,"score":.99,"payload":{"indicator_id":iid,"ailment":"x"},"concept":{"polarity":"positive","currentness":"current","certainty":"certain","domain":"symptom","intensity":intensity,"context":"test"}},extraction={},status=EvidenceStatus.CONFIRMED)

def test_diminishing_returns_and_all_seven_chakras():
    kb=KnowledgeBase().load_directory('knowledge_base/ANAHAT_KnowledgeBase_v3'); se=ScoringEngine(kb)
    ev1=make_ev('a','r1','SYM-001'); ev2=make_ev('b','r2','SYM-001')
    report=se.score([ev1,ev2],assessed_quadrants=set(kb.quadrant_names))
    assert len(report.results)==7
    assert any(x.presence_score > 0 for x in report.results)
    sacral=next(x for x in report.results if x.chakra=='Sacral Chakra'); assert sacral.presence_score <= 1

def test_no_evidence_is_unresolved_when_assessment_incomplete():
    kb=KnowledgeBase().load_directory('knowledge_base/ANAHAT_KnowledgeBase_v3'); report=ScoringEngine(kb).score([],assessed_quadrants={'Nature'})
    assert all(r.status=='UNRESOLVED' for r in report.results)

def test_compound_indicator_state_is_normalized_for_scoring():
    kb=KnowledgeBase().load_directory('knowledge_base/ANAHAT_KnowledgeBase_v3')
    anxiety_root=next(i for i in kb.indicators if i.indicator_id=='SYM-009' and i.chakra=='Root Chakra')
    assert anxiety_root.state_raw == 'Deficient'
