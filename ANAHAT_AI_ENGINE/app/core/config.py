from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"

    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None
    qdrant_collection: str = "anahat_knowledge"

    embedding_model: str = "BAAI/bge-m3"
    embedding_dimension: int = 1024

    chunk_size: int = 800
    chunk_max_size: int = 1000
    chunk_overlap: int = 120

    retrieval_top_k: int = 10
    retrieval_score_threshold: float = 0.45
    imbalance_score_threshold: float = 0.45
    minimum_confidence_pct: float = 60.0
    minimum_independent_evidence_units: int = 2
    ambiguity_margin: float = 0.10
    insufficient_score_threshold: float = 0.20

    # LLM provider configuration
    llm_provider: str = "gemini"
    llm_fallback_providers: str = ""

    gemini_api_key: str | None = None
    gemini_model: str | None = None

    openrouter_api_key: str | None = None
    openrouter_model: str | None = None
    openrouter_fallback_models: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    together_api_key: str | None = None

    llm_model: str = "gemini-2.5-flash"

    # Bounded retry / timeout controls
    llm_request_timeout_seconds: float = 25.0
    llm_total_timeout_seconds: float = 60.0
    llm_max_retries: int = 1
    llm_retry_backoff_seconds: float = 0.5
    llm_retry_backoff_max_seconds: float = 8.0

    kb_path: str = "./knowledge_base/ANAHAT_KnowledgeBase_v3"

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )

    @field_validator(
        "llm_fallback_providers",
        "openrouter_fallback_models",
        mode="before",
    )
    @classmethod
    def normalize_csv(cls, value):
        if value is None:
            return ""
        return str(value)

    @property
    def llm_fallback_provider_list(self) -> list[str]:
        return [
            item.strip().lower()
            for item in self.llm_fallback_providers.split(",")
            if item.strip()
        ]

    @property
    def openrouter_fallback_model_list(self) -> list[str]:
        return [
            item.strip()
            for item in self.openrouter_fallback_models.split(",")
            if item.strip()
        ]

settings = Settings()    