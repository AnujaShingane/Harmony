from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"

    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None
    qdrant_collection: str = "anahat_knowledge"
    qdrant_indicator_collection: str = "anahat_indicator_validation_v1"

    embedding_model: str = "BAAI/bge-m3"
    embedding_dimension: int = 1024

    chunk_size: int = 800
    chunk_max_size: int = 1000
    chunk_overlap: int = 120

    # Retrieval only proposes CANDIDATES. Similarity is never evidence.
    retrieval_top_k: int = 8
    retrieval_score_threshold: float = 0.45
    # Max validated candidates shown to the therapist per patient concept.
    candidate_display_limit: int = 3
    # Extracted concepts must carry a verbatim quote that really occurs in the
    # patient's text; anything else is dropped as a possible hallucination.
    require_evidence_quote: bool = True
    # Debug only: expose similarity score / chakra payload of candidates.
    expose_candidate_internals: bool = False

    # ---- Scoring (ENGINEERING BASELINES - not clinically validated) --------
    imbalance_score_threshold: float = 0.45      # presence gate      (PDF Part 40)
    direction_threshold: float = 0.45            # direction gate     (PDF Part 41)
    minimum_confidence_pct: float = 60.0
    minimum_independent_evidence_units: int = 2
    ambiguity_margin: float = 0.10               # PDF Part 42
    direction_gray_zone_margin: float = 0.15     # PDF Part 42 (0.10-0.15 = gray zone)
    insufficient_score_threshold: float = 0.20   # PDF Part 68
    high_priority_single_score: float = 0.70     # KB imbalance_gate.high_priority_single
    # A chakra can only be called BALANCED after adequate assessment.
    # REQUIRES DOMAIN/THERAPIST VALIDATION: 10 keeps the previous baseline
    # (all ten quadrants assessed). Lower it only on therapist approval.
    balanced_min_assessed_quadrants: int = 10
    # A quadrant counts as "assessed" only after this many real patient responses.
    min_responses_per_quadrant_assessed: int = 1

    # ---- Deep dive ----------------------------------------------------------
    # Hard stop so deep dive can never become endless questioning (PDF Part 53).
    deep_dive_max_questions_per_evidence: int = 4

    # LLM provider configuration
    llm_provider: str = "local"
    llm_fallback_providers: str = "gemini,openrouter"

    local_llm_url: str = "http://127.0.0.1:11434"
    local_llm_model: str = "llama3:latest"
    local_llm_keep_alive: str = "30m"

    gemini_api_key: str | None = None
    gemini_model: str | None = None

    openrouter_api_key: str | None = None
    openrouter_model: str | None = None
    openrouter_fallback_models: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    mistral_api_key: str | None = None
    mistral_model: str | None = None
    mistral_base_url: str = "https://api.mistral.ai/v1"

    together_api_key: str | None = None

    llm_model: str = "gemini-2.5-flash"

    # Bounded retry / timeout controls
    llm_request_timeout_seconds: float = 90.0
    llm_total_timeout_seconds: float = 180.0
    llm_max_retries: int = 1
    llm_retry_backoff_seconds: float = 0.5
    llm_retry_backoff_max_seconds: float = 8.0

    kb_path: str = "./knowledge_base/ANAHAT_KnowledgeBase_v3"

    # Optional: persist sessions as JSON so an engine restart does not lose them.
    # Off by default because sessions contain patient text; enable only with
    # disk encryption / access control in place.
    session_store_dir: str | None = None

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