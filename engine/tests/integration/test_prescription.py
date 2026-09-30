from app.knowledge.loader import KnowledgeBase
from app.services.prescription_service import PrescriptionService

def test_therapist_approval_is_explicit():
    svc=PrescriptionService(); draft=svc.draft(patient_id='p',findings=[],raga_candidates=[],activities=[])
    assert draft['status']=='DRAFT_REQUIRES_THERAPIST_APPROVAL'
    final=svc.apply_therapist_decision(draft,{'decision':'approve'})
    assert final['status']=='THERAPIST_APPROVED'
