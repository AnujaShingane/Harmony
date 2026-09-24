from app.core.config import settings
from app.core.exceptions import RetrievalError

class KnowledgeRetriever:
    def __init__(self, client=None, embedder=None):
        if client is None:
            from app.retrieval.qdrant_client import get_qdrant_client
            client = get_qdrant_client()
        if embedder is None:
            from app.retrieval.embeddings import BGE_M3_Embedder
            embedder = BGE_M3_Embedder()
        self.client = client
        self.embedder = embedder

    def search(self, query: str, top_k: int | None = None):
        if not query.strip():
            return []
        try:
            vector = self.embedder.encode_query(query)
            limit = top_k or settings.retrieval_top_k
            vector_list = vector.tolist() if hasattr(vector, "tolist") else list(vector)
            if hasattr(self.client, "query_points"):
                result = self.client.query_points(
                    collection_name=settings.qdrant_collection,
                    query=vector_list,
                    limit=limit,
                    with_payload=True,
                )
                return getattr(result, "points", result)
            return self.client.search(
                collection_name=settings.qdrant_collection,
                query_vector=vector_list,
                limit=limit,
                with_payload=True,
            )
        except Exception as exc:
            raise RetrievalError(f"Qdrant retrieval failed: {exc}") from exc
