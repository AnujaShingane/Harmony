from abc import ABC, abstractmethod
from app.llm.schemas import SemanticExtraction

class LLMProvider(ABC):
    @abstractmethod
    def extract_semantics(self, text: str, *, context: dict | None = None) -> SemanticExtraction:
        raise NotImplementedError
