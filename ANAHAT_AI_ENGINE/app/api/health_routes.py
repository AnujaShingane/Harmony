from fastapi import APIRouter
from app.core.config import settings
router=APIRouter()
@router.get('/health')
def health(): return {"status":"ok","engine":"ANAHAT AI Engine","llm_provider":settings.llm_provider,"clinical_validation":False}
