from app.core.config import settings

def get_qdrant_client():
    try:
        from qdrant_client import QdrantClient
    except ImportError as exc:
        raise RuntimeError('qdrant-client is required for Qdrant retrieval') from exc
    kwargs={'url':settings.qdrant_url}
    if settings.qdrant_api_key: kwargs['api_key']=settings.qdrant_api_key
    return QdrantClient(**kwargs)
