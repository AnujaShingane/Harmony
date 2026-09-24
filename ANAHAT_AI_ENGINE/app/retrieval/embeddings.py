from typing import Sequence
from app.core.config import settings

class BGE_M3_Embedder:
    def __init__(self):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise RuntimeError('sentence-transformers is required for BGE-M3 retrieval') from exc
        self.model = SentenceTransformer(settings.embedding_model)
    def encode_documents(self,texts:Sequence[str]):
        return self.model.encode(list(texts),normalize_embeddings=True,convert_to_numpy=True,show_progress_bar=False)
    def encode_query(self,text:str):
        return self.model.encode([text],normalize_embeddings=True,convert_to_numpy=True,show_progress_bar=False)[0]
    @property
    def dimension(self): return settings.embedding_dimension
