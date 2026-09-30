"""Tests for the specific bugs fixed in this pass."""
import json

import httpx
import pytest

from app.core.exceptions import LLMConfigurationError
from app.llm.mistral_provider import MistralProvider
from app.services.assessment_service import quote_is_verbatim
from app.services.question_service import QuestionService
from tests.scenarios.harness import THROAT, card, concept, cover_all_quadrants, kb, make_session, say
from tests.helpers import positive_payload, as_json, POSITIVE_TEXT


# ---- Balanced must never be the default -------------------------------------------------------
def test_nothing_assessed_is_not_assessed_never_balanced():
    svc, sid = make_session({}, {})
    res = svc.final_result(sid)
    assert all(c["status"] == "UNRESOLVED" and c["status_code"] == "NOT_ASSESSED" for c in res["chakras"])
    assert res["summary"]["balanced"] == []


def test_balanced_only_after_enough_quadrants_and_shows_low_confidence():
    svc, sid = make_session({}, {})
    cover_all_quadrants(svc, sid)
    res = svc.final_result(sid)
    assert all(c["status"] == "BALANCED" and c["confidence_label"] == "Low" for c in res["chakras"])


def test_selecting_a_quadrant_alone_does_not_count_as_assessed():
    svc, sid = make_session({}, {})
    for q in kb().quadrant_names:
        svc.select_quadrant(sid, q)
    assert svc.final_result(sid)["summary"]["balanced"] == []


# ---- quote verification --------------------------------------------------------------------------
@pytest.mark.parametrize("text,quote,ok", [
    ("I can't sleep at night", "can't sleep", True),
    ("I can’t sleep at night", "can't sleep", True),
    ("I can't sleep at night", "cannot sleep", False),
    ("I can't sleep", "", False),
    ("I have a headache", "head", False),         # not word-aligned
])
def test_quote_must_be_verbatim(text, quote, ok):
    assert quote_is_verbatim(text, quote) is ok


# ---- questions: KB only, never "out of questions" ---------------------------------------------------
def test_kb_question_text_is_used_where_it_maps_and_flagged_where_it_does_not():
    qs = QuestionService(kb())
    nature = qs.attribute_queue("Nature")
    assert nature[0]["source"] == "KB question bank"
    prof = qs.attribute_queue("Profession")
    assert all("REQUIRES DOMAIN VALIDATION" in q["source"] for q in prof)


def test_duplicate_kb_attribute_is_asked_once_without_touching_the_kb():
    qs = QuestionService(kb())
    q = next(x for x in kb().quadrants if x["name"] == "Lifestyle")
    names = [a.lower() for a in q["attributes"]]
    asked = [x["attribute"].lower() for x in qs.attribute_queue("Lifestyle")]
    assert len(asked) == len(set(asked)) and len(asked) <= len(names)


def test_quadrant_exhaustion_recommends_next_quadrant_instead_of_running_out():
    svc, sid = make_session({}, {})
    page = svc.select_quadrant(sid, "Nature")
    seen = 0
    while not page["exhausted"]:
        for q in page["questions"]:
                svc.process_response(sid, "I have conflicts with my friends", q["id"], "Nature"); seen += 1
        page = svc.next_questions(sid, "Nature")
    assert seen == page["total"] and page["questions"] == []
    assert page["recommended_quadrants"] and "Nature" not in [r["quadrant"] for r in page["recommended_quadrants"]]
    assert "No" not in page["message"][:2]


def test_all_quadrants_covered_points_to_result():
    svc, sid = make_session({}, {})
    cover_all_quadrants(svc, sid)
    page = svc.next_questions(sid, "Nature")
    assert page["all_quadrants_covered"] is True


def test_routing_uses_embeddings_when_available_and_labels_fallback():
    class Emb:
        def encode_documents(self, texts):
            import numpy as np
            return np.array([[1.0, 0.0] if t.startswith("Family:") or t.lower().startswith("family family")
                             else [0.0, 1.0] for t in texts])
    qs = QuestionService(kb(), embedder=Emb())
    rec = qs.recommend_quadrants(concepts=["family family"], limit=2)
    assert rec[0]["quadrant"] == "Family" and rec[0]["method"] == "bge_m3_semantic"
    fb = QuestionService(kb()).recommend_quadrants(current_issue="my friends provide social support", limit=1)
    assert fb[0]["quadrant"] == "Social Circle" and "KB attributes" in fb[0]["method"]


def test_routing_does_not_recommend_unmatched_quadrants_and_combines_patient_signals():
    qs = QuestionService(kb())
    assert qs.recommend_quadrants(current_issue="nothing specific to report") == []
    rec = qs.recommend_quadrants(concepts=["family conflict"], current_issue="I have irregular sleep and low energy",
                                 baseline={"anxiety": 8})
    names = {item["quadrant"] for item in rec}
    assert names == set()


def test_exact_sleep_anxiety_recovery_case_routes_only_clear_kb_matches_and_keeps_gates():
    from app.models.assessment import AssessmentCreate, BaselineCreate
    from app.retrieval.embeddings import BGE_M3_Embedder
    from app.services.assessment_service import AssessmentService

    issue = """PATIENT ASSESSMENT INFORMATION
MAIN CONCERNS: Anxiety, Sleep Issues, Addiction Recovery
PATIENT FORM NOTES: I have sleep issues not able to feel well throughout the day, feels very low energetic and sleepy throughout the day.
Baseline stress: 6/10
Baseline anxiety: 6/10
Baseline mood: 3/10
Baseline energy: 3/10
Baseline sleep quality: Fair
RECENT ASSESSMENT CONVERSATION:
PATIENT RESPONSE to opening: It makes it difficult for me to stay focused and productive during the day because I feel tired and sleepy most of the time. I don't have much energy to do my usual activities, and sometimes I feel less motivated to interact with others. My anxiety also makes me overthink things and affects my ability to relax. Overall, I feel like my sleep, mood, and energy are affecting my work and daily routine."""

    svc = AssessmentService(kb=kb(), embedder=BGE_M3_Embedder())
    sid = svc.create_session(AssessmentCreate(patient_id="quadrant-regression-case")).session_id
    svc.set_baseline(sid, BaselineCreate(stress=6, anxiety=6, mood=3, energy=3, sleep_quality="Fair"))
    from types import SimpleNamespace
    extracted = ["Fatigue", "Lack of Energy", "Decreased Motivation", "Anxiety",
                 "Impact on Work and Daily Routine"]
    evidence_input = QuestionService._recommendation_evidence(
        issue, None, {"stress": 6, "anxiety": 6, "mood": 3, "energy": 3, "sleep_quality": "Fair"},
        {"occupation": "not supplied"}, extracted)
    input_text = " ".join(item["text"] for item in evidence_input)
    for signal in ("Anxiety", "Sleep Issues", "Addiction Recovery", "sleepy", "low energetic",
                   "stress: 6", "focused and productive", "daily routine", "Fatigue"):
        assert signal.lower() in input_text.lower()
    svc._ctx(sid).responses.append(SimpleNamespace(
        response_id="quadrant-regression-response",
        raw_text="I feel tired and sleepy most of the time.",
        extraction={"concepts": [{"concept": name, "domain": "symptom", "polarity": "positive"}
                                for name in extracted]}))
    rec = svc.recommend_quadrants(sid, current_issue=issue)
    names = {item["quadrant"] for item in rec}
    assert names == {"Lifestyle", "Nature", "Medical & Therapeutic Background"}
    assert "Music Therapy Profile" not in names
    assert "Profession" not in names
    assert len(rec) <= 3

    debug = {item["quadrant"]: item for item in svc.questions.last_recommendation_debug}
    assert len(debug) == len(kb().quadrant_names)
    assert debug["Lifestyle"]["score"] > 0.42
    assert debug["Lifestyle"]["matched_signals"]
    assert debug["Music Therapy Profile"]["matched_signals"] == []
    assert debug["Profession"]["matched_signals"] == []
    assert debug["Medical & Therapeutic Background"]["matched_signals"]
    assert any("extracted patient concept" in label for label in debug["Lifestyle"]["matched_signals"])

    # A single supported concern can yield fewer than three suggestions.
    sleep_only = svc.questions.recommend_quadrants(
        current_issue="MAIN CONCERNS: Sleep Issues\nPATIENT FORM NOTES: Irregular sleep and daytime sleepiness")
    assert [item["quadrant"] for item in sleep_only] == ["Lifestyle"]
    fallback = QuestionService(kb()).recommend_quadrants(
        current_issue=issue, baseline={"stress": 6, "anxiety": 6, "mood": 3, "energy": 3,
                                       "sleep_quality": "Fair"}, concepts=extracted)
    fallback_names = {item["quadrant"] for item in fallback}
    assert "Music Therapy Profile" not in fallback_names and "Profession" not in fallback_names

    # A high-score but unconfirmed candidate cannot produce imbalance evidence.
    from app.core.enums import EvidenceStatus
    candidate = {"candidate_id": "unconfirmed-fatigue", "score": 0.99,
                 "payload": {"indicator_id": "SYM-043"},
                 "concept": {"concept": "Fatigue", "polarity": "positive", "currentness": "current",
                             "certainty": "certain", "domain": "symptom", "intensity": "Severe", "context": "test"},
                 "quote": "I feel tired most of the time"}
    provisional = svc.evidence_engine.build_evidence(
        response_id="opening-response", candidate=candidate, extraction={}, status=EvidenceStatus.PROVISIONAL)
    svc._ctx(sid).evidence.append(provisional)
    result = svc.final_result(sid)
    assert result["summary"]["imbalanced"] == []
    assert all(not item["status"].startswith("IMBALANCED") for item in result["chakras"])
    assert all(item["status_code"] in {"NOT_ASSESSED", "INSUFFICIENT_EVIDENCE"}
               for item in result["chakras"])
    recs = svc.recommendations(sid)
    assert recs["raga"]["candidates"] == []


def test_engine_health_distinguishes_process_health_from_llm_readiness(monkeypatch):
    from app.api.health_routes import health
    from app.core.config import settings

    class Response:
        def raise_for_status(self):
            return None

        @staticmethod
        def json():
            return {"models": [{"name": "mistral:latest"}]}

    monkeypatch.setattr(settings, "llm_provider", "local")
    monkeypatch.setattr(settings, "llm_fallback_providers", "")
    monkeypatch.setattr(settings, "local_llm_url", "http://ollama.test")
    monkeypatch.setattr(settings, "local_llm_model", "mistral:latest")
    monkeypatch.setattr("app.api.health_routes.httpx.get", lambda *args, **kwargs: Response())
    assert health()["status"] == "ok" and health()["ai_ready"] is True

    monkeypatch.setattr(settings, "local_llm_model", "missing-model:latest")
    result = health()
    assert result["status"] == "ok" and result["ai_ready"] is False
    assert "not installed" in result["ai_readiness_reason"]


# ---- Mistral provider --------------------------------------------------------------------------------------
def _provider(handler):
    return MistralProvider(api_key="test-key", model="test-model",
                           client=httpx.Client(transport=httpx.MockTransport(handler)))


def _chat(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def test_mistral_extracts_with_json_schema_and_validates():
    seen = {}
    def handler(req):
        seen["body"] = json.loads(req.content); seen["auth"] = req.headers["authorization"]
        return _chat(as_json(positive_payload()))
    ex = _provider(handler).extract_semantics(POSITIVE_TEXT, context={"evidence": ["SECRET"], "baseline": {"stress": 5}})
    assert ex.concepts[0].concept == "lower back pain"
    assert seen["body"]["response_format"]["type"] == "json_schema" and seen["auth"] == "Bearer test-key"
    assert "SECRET" not in json.dumps(seen["body"])                         # no accumulated assessment state sent


def test_mistral_falls_back_to_json_object_when_schema_rejected():
    calls = []
    def handler(req):
        calls.append(json.loads(req.content)["response_format"]["type"])
        return httpx.Response(422, json={}) if len(calls) == 1 else _chat(as_json(positive_payload()))
    _provider(handler).extract_semantics(POSITIVE_TEXT)
    assert calls == ["json_schema", "json_object"]


def test_mistral_rejects_schema_invalid_output_and_needs_key():
    from app.core.exceptions import LLMInvalidResponseError
    with pytest.raises(LLMInvalidResponseError):
        _provider(lambda r: _chat('{"concepts": [{"concept": "x", "polarity": "bogus"}]}')).extract_semantics("x")
    with pytest.raises(LLMConfigurationError):
        MistralProvider(api_key=None, model="m")


def test_mistral_closed_set_validation_and_factory_registration():
    from app.core.config import Settings
    from app.llm.resilient import build_llm_provider
    def handler(req):
        return _chat(json.dumps({"judgements": [{"indicator_id": "EMO-012", "match": "exact"}]}))
    v = _provider(handler).validate_candidates("t", {"concept": "c"}, [{"indicator_id": "EMO-012", "term": "x", "domain": "emotion"}])
    assert v.judgements[0].match == "exact"
    chain = build_llm_provider(Settings(llm_provider="mistral", llm_fallback_providers="", mistral_api_key="k", mistral_model="m"))
    assert chain.provider_names == ["MistralProvider"] or chain.provider_names == ["mistral"]


# ---- result contract ---------------------------------------------------------------------------------------------------
def test_result_contract_has_everything_the_window_needs():
    t = "I feel unheard at home"
    svc, sid = make_session({t: [concept("feel unheard", "feeling unheard", "emotion")]}, {"feeling unheard": [(THROAT["unheard"], .9)]})
    say(svc, sid, t)
    res = svc.final_result(sid)
    assert len(res["chakras"]) == 7
    for c in res["chakras"]:
        for k in ("status", "status_label", "scores", "confidence_pct", "coverage_pct", "reasons", "trace", "pending_details"):
            assert k in c
    assert res["requires_domain_validation"] and res["disclaimer"] and "coverage" in res
    json.dumps(res, default=str)                                             # serialisable for the API


# ---- session-less KB helpers used by the Node backend -----------------------------------------------------
def test_opening_styles_and_suggestions_come_only_from_the_kb():
    svc, _ = make_session({}, {})
    assert len(svc.list_opening_styles()["styles"]) == 10
    first = svc.suggest_question("", [], "C")
    kb_first = next(s for s in kb().opening_styles["styles"] if s["id"] == "C")["questions"][0]
    assert first["text"] == kb_first["text"]
    nxt = svc.suggest_question("", [first["id"]], "C")
    assert nxt["id"] != first["id"]
    fam = svc.suggest_question("family structure and family dynamics matter in my household", [])
    assert fam["quadrant"] == "Family" and fam["source"]
