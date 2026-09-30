from app.knowledge.loader import KnowledgeBase
from app.services.ambiguity_service import AmbiguityService

def test_validated_disambiguation_is_used():
    kb=KnowledgeBase().load_directory('knowledge_base/ANAHAT_KnowledgeBase_v3'); svc=AmbiguityService(kb)
    assert svc.needs_clarification('SYM-001')
    assert any(q['id']=='RCD-01' for q in svc.for_indicator('SYM-001'))
