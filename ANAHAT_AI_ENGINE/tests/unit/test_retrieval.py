from app.retrieval.retriever import KnowledgeRetriever

class E:
    def encode_query(self,q): return [0.1,0.2]
class P:
    def __init__(self): self.score=.9; self.payload={'indicator_id':'SYM-001'}
class C:
    def query_points(self,**kwargs): return type('R',(),{'points':[P()]})()

def test_qdrant_query_points_path_preserves_payload_and_score():
    out=KnowledgeRetriever(client=C(),embedder=E()).search('stomach cramps',1)
    assert out[0].payload['indicator_id']=='SYM-001' and out[0].score==.9
