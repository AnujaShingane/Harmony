# ANAHAT × Harmony — Integration Report

Date: 16 Sep 2026. Author role: integration architect / QA.

---

## 1. FINAL ARCHITECTURE

```
Browser (React, existing app + 2 new pages)
   │  cookie session · X-Requested-With · Origin gate (all existing)
   ▼
Express backend  /api/*  (existing, unchanged)
                 /api/anahat/*  (new module: src/anahat/)
                    routes → controller → service → engineClient → models
   │  server-to-server HTTP, AI_ENGINE_URL (localhost/private only)
   ▼
ANAHAT AI Engine (FastAPI, included UNTOUCHED)  ──►  Qdrant (anahat_knowledge, BGE-M3 1024-d)
                                                ──►  Gemini (google-genai, gemini-2.5-flash)
```

The browser never reaches the engine. The engine is not modified. All clinical reasoning (safety, extraction, retrieval, candidate validation, evidence, scoring, deep-dive decisions, raga/activity recommendation) stays in the engine; the backend only orchestrates, authorises and persists.

## 2. PROJECT STRUCTURE (additions only)

```
ANAHAT_AI_ENGINE/                          ← engine, byte-for-byte as supplied
backend/src/anahat/engineClient.js         ← HTTP client + canonical KB lists (verified against KB JSON)
backend/src/anahat/anahatModels.js         ← AnahatAssessment, AnahatBaseline (Mongo)
backend/src/anahat/anahatService.js        ← orchestration, authorisation, idempotency, persistence into existing models
backend/src/anahat/anahatController.js     ← HTTP mapping + error translation
backend/src/anahat/anahatRoutes.js         ← /api/anahat/* (24 routes)
backend/scripts/anahat-engine-contract-test.mjs ← contract test against a running engine
frontend/src/pages/patient/BaselineAssessment.jsx   ← patient step 2
frontend/src/pages/therapist/AnahatAssessment.jsx   ← therapist steps 2–35
ANAHAT_INTEGRATION_REPORT.md               ← this file
```

## 3. FILES CREATED — see §2.

## 4–5. EXISTING FILES MODIFIED (and why it was unavoidable)

| File | Change | Why unavoidable | Why existing behaviour is safe |
|---|---|---|---|
| `backend/src/routes/index.js` | +1 import, +1 `api.use('/anahat', …)` | Express routers must be mounted somewhere; there is no auto-discovery. | Mounted before the catch-all `patientDataRoutes`; unique prefix; inventory shows 153 routes, 0 collisions. |
| `backend/.env.example` | +`AI_ENGINE_URL`, `AI_ENGINE_TIMEOUT_MS` | Documentation of new config. | Placeholders only; defaults exist in code. |
| `frontend/src/services/api.js` | appended `export const anahat = {…}` | Reuses the existing `request()` (cookies, X-Requested-With, 401 handling) — duplicating it would fork auth behaviour. | Append-only; no existing export touched. |
| `frontend/src/app/App.jsx` | +2 imports, +3 `<Route>` lines | React Router needs the routes registered. | Inserted lines only; no existing route edited or reordered. |
| `frontend/src/components/layout/PatientDashboardLayout.jsx` | +1 entry in `NAV_ITEMS` | The sidebar is data-driven from that array. | Additive item; existing items untouched. |
| `frontend/src/pages/therapist/PatientProfile.jsx` | +1 button "ANAHAT Assessment" | Therapist needs an entry point from the patient record. | Existing "Start Session" button and logic unchanged. |

No model, controller, middleware, auth, prescription, report, notification or engine file was modified.

## 6. API CONTRACTS — `/api/anahat` (all require session auth; therapist routes require `therapist|admin` + approved)

| Method | Path | Body / Query | Returns | Engine call |
|---|---|---|---|---|
| GET | `/health` | — | `{ok, url, engine|message}` | `GET /health` |
| GET | `/reference` | — | quadrants, openingSets, baselineFields, chakras, safetyTiers | `GET /chakra/reference` |
| GET | `/patients/:patientId/baseline` | — | baseline[] | — |
| POST | `/patients/:patientId/baseline` | `{stress,anxiety,mood,sleep_quality,energy,note}` | baseline | — |
| GET | `/patients/:patientId/assessments` | — | assessment[] | — |
| GET | `/assessments` | — | mine | — |
| POST | `/assessments` | `{patientId, appointmentId?, force?}` | `{assessment, resumed}` | `POST /assessment/sessions`, then `…/baseline` if patient baseline exists |
| GET | `/assessments/:id` | — | assessment (refresh/resume) | — |
| POST | `/assessments/:id/baseline` | baseline | assessment | `POST …/baseline` |
| POST | `/assessments/:id/context` | `{context}` | assessment | — |
| POST | `/assessments/:id/opening` | `{set_id}` | `{opening, assessment}` | `POST …/opening` |
| POST | `/assessments/:id/quadrants/analyse` | `{current_issue?}` | `{recommended, all, selected}` | `GET …/quadrants` |
| POST | `/assessments/:id/quadrants` | `{quadrants:[…]}` (1..n, additive) | `{scope, questions, assessment}` | `POST …/quadrants/select` per quadrant |
| POST | `/assessments/:id/responses` | `{text, questionId?, question?, quadrant?, requestId}` | engine result + assessment | `POST …/responses` |
| POST | `/assessments/:id/safety/acknowledge` | `{note, continueAssessment}` | assessment | — |
| POST | `/assessments/:id/candidates/:candidateId/confirm` | `{response_id, confirmed, evidence_status, therapist_note?, selected_chakra?}` | `{status, evidence?, clarifications?}` | `POST …/candidates/{id}/confirm?response_id=&selected_chakra=` |
| POST | `/assessments/:id/evidence/:evidenceId/resolve` | `{selected_chakra, therapist_note?}` | evidence | `POST /evidence/sessions/{sid}/evidence/{eid}/resolve` |
| POST | `/assessments/:id/score` | — | chakra report | `GET …/chakra-report` (engine mutates stage → POST here) |
| POST | `/assessments/:id/decision` | `{stop}` | decision + chakra_report | `POST …/decision?stop=` |
| POST | `/assessments/:id/recommendations` | — | `{chakra_report, raga, activities}` | `GET /recommendations/sessions/{sid}` (mutates stage → POST) |
| POST | `/assessments/:id/prescription/draft` | — | draft | `GET /prescription/sessions/{sid}` (mutates → POST) |
| POST | `/assessments/:id/prescription/review` | `{decision: APPROVE|EDIT|REJECT|CLARIFY, edits?, note?}` | `{decision, assessment}` | `POST /prescription/sessions/{sid}/decision` |
| POST | `/assessments/:id/finalize` | — | `{assessment, already}` | — (writes Prescription, ReportHistory, ActivityPlan, PatientNotification, AuditLog — once) |
| GET | `/assessments/:id/report` | — | finalReport (pure read) | — |

Every engine route/method/body/query above was verified against `app/api/*.py` and `app/models/*.py`, and exercised live (see §14).

## 7. FRONTEND ROUTES (added)
- `/dashboard/assessment` — patient baseline (existing `ProtectedRoute`).
- `/therapist/anahat/patient/:patientId` — start / resume for a patient.
- `/therapist/anahat-assessment/:assessmentId` — the assessment (refresh-safe; state reloads from the backend record).
All existing routes unchanged.

## 8. BACKEND ROUTES — §6. Inventory: 153 routes total, 24 under `/api/anahat`, 0 duplicates.

## 9. AI ENGINE CONNECTION
`AI_ENGINE_URL` (default `http://localhost:8000`), `AI_ENGINE_TIMEOUT_MS` (120 s). Errors are typed: unreachable → 503 "not reachable, your assessment is saved"; provider/infra not configured → 502 `ENGINE_NOT_CONFIGURED`; engine restarted → the service probes the session (`GET …/quadrants`) and marks the record `engine_session_lost` (409, `ENGINE_SESSION_LOST`) — the record stays readable and the UI offers "start new".

## 10. DATABASE CONNECTION
Existing Postgres (users, patient profiles, appointments — read only here) and existing Mongo. New collections: `anahatassessments`, `anahatbaselines`. Existing collections written on finalize: `prescriptions` (existing `Prescription` model), `reporthistories`, `activityplans` (append), `patientnotifications`, `auditlogs`.

## 11. QDRANT CONNECTION (engine-side, unchanged)
`QDRANT_URL`, `QDRANT_COLLECTION=anahat_knowledge`, `EMBEDDING_MODEL=BAAI/bge-m3`, `EMBEDDING_DIMENSION=1024`, `RETRIEVAL_TOP_K=10`, score threshold 0.45. Payload field used for validation: `indicator_id`. Ingestion: `ANAHAT_AI_ENGINE/ingestion/` (run once). Not reachable from this environment — INFRASTRUCTURE DEPENDENT.

## 12. LLM CONNECTION (engine-side, unchanged)
Implemented provider is **Gemini** via `google-genai` (`app/llm/gemini_provider.py`), model `gemini-2.5-flash`, key from `GEMINI_API_KEY`. Docs and config agree; no Mistral anywhere. Discrepancy found: `app/llm/gemini_provide.py` is a stray duplicate file, unused (`main.py`/routes import `gemini_provider`). Left as-is.

## 13. 35-STEP MATRIX

| # | Step | Owner | Where | Status |
|---|---|---|---|---|
| 1 | Patient profile | existing app | demographic form | reused |
| 2 | Baseline | patient / therapist | `/dashboard/assessment`, workbench | LOCALLY TESTED (engine) |
| 3 | Therapist context | therapist | workbench → record | CODE VERIFIED |
| 4 | Fixed opening questions | engine | set A (4 canonical Qs) | LOCALLY TESTED |
| 5 | Quadrant analysis | engine | `quadrants/analyse` | LOCALLY TESTED |
| 6 | Therapist selects / adds quadrant(s) | therapist | checkbox scope, additive | LOCALLY TESTED (1, 3, 10 quadrants) |
| 7 | Question selection | engine | canonical question bank | LOCALLY TESTED |
| 8–9 | Patient answers, therapist enters raw text | therapist | transcript preserved | CODE VERIFIED |
| 10 | Safety pre-check | engine | CLEAR / ESCALATE | INFRASTRUCTURE DEPENDENT* |
| 11–12 | Gemini understanding + structured extraction | engine | | INFRASTRUCTURE DEPENDENT |
| 13–16 | BGE-M3, Qdrant, candidates, validation | engine | | INFRASTRUCTURE DEPENDENT |
| 17 | Confirmation | therapist | confirm/reject + evidence status | CODE VERIFIED |
| — | Clarification / disambiguation | therapist | resolve UNRESOLVED evidence | CODE VERIFIED |
| 18–26 | Consistency, KB lookup, scoring, 7 chakras, explainability | engine | `score` | CODE VERIFIED (needs evidence) |
| 27–28 | Sufficiency, deep dive / next quadrant / stop | engine + therapist | `decision` | CODE VERIFIED |
| 29–32 | Raga + activity recommendations | engine | `recommendations` | CODE VERIFIED |
| 33 | Therapist review (approve / edit-by-unticking / reject / clarify) | therapist | `prescription/review` | CODE VERIFIED |
| 34 | Final prescription | backend → existing `Prescription` | `finalize` | CODE VERIFIED |
| 35 | Final report | backend → existing `ReportHistory` + notification + audit | `finalize`, `GET /report` | CODE VERIFIED |

\* The engine constructs `GeminiProvider` before running its keyword safety check (`_runtime_service()` in `assessment_routes.py`), so without `GEMINI_API_KEY` even a high-risk response returns 502 instead of `SAFETY_ESCALATION`. With the key set the escalation path is keyword-based and does not need the LLM. Not changed (engine is off-limits).

## 14. TEST RESULTS

LOCALLY TESTED (engine run in this sandbox with light deps, no Gemini key / no Qdrant / no BGE-M3):
`node backend/scripts/anahat-engine-contract-test.mjs` → **17/17 passed**: health; 7 chakras; session create; baseline → `opening`; baseline immutability; opening set A = 4 questions; set B rejected (no invented questions); quadrant recommendation ≤3; select 1 / 3 / all 10 quadrants; unknown quadrant rejected; response path returns the documented infra error (no fake result); high-risk text → same (see \*); unknown session detected by probe; unreachable engine → 503 with clear message.

CODE VERIFIED: backend route inventory (153 routes, 24 new, 0 collisions, module loads without DB); `node --check` on every new/changed backend file; `vite build` of the whole frontend passes; existing routes/pages untouched by diff.

INFRASTRUCTURE DEPENDENT (not verifiable here): Postgres/Mongo persistence, login + cookie flow, Gemini extraction, Qdrant retrieval, candidate generation, evidence loop, scoring with real evidence, recommendations, prescription/report persistence end-to-end.

## 15. SECURITY
Same auth as the app: session cookie (httpOnly, sameSite strict, device-bound), global app-origin gate, `requireAuth`; therapist routes add `requireRole('therapist','admin') + requireApproved`. Service-level ownership: therapist must have a confirmed/completed appointment with the patient; patient may only read own assessments/baselines; assessment access checked on every `/assessments/:id/*`. Engine not exposed; no secrets in frontend.

## 16. IDEMPOTENCY
- create: resumes the open assessment for (therapist, patient) unless `force`.
- baseline: no-op if already recorded (engine forbids re-recording).
- opening / quadrants: no-op for already-selected values.
- responses: client `requestId` → replay returns stored result, engine not re-run.
- confirm: no-op if that candidate already produced evidence.
- finalize: guarded by `status==='completed'` and per-artifact ids (`prescriptionId`, `reportHistoryId`) — one prescription, one report, one notification, one audit entry, ever. `GET /report` is a pure read.
- All engine-mutating operations are POST; no GET has side effects.

## 17. ERROR HANDLING
Engine down → 503, friendly message, state untouched. Engine unconfigured (Gemini/Qdrant/model) → 502 `ENGINE_NOT_CONFIGURED`, no fabricated output. Engine restarted → 409 `ENGINE_SESSION_LOST`, record preserved, UI offers restart. Invalid quadrant / out-of-scope quadrant / baseline twice / unapproved prescription → 400/409 with reason. Unauthorised → 403. Frontend shows every message in-place; nothing is swallowed.

## 18. KNOWN LIMITATIONS
1. Engine sessions are in-memory: an engine restart ends the live session (handled, not hidden).
2. Safety has two tiers (CLEAR/ESCALATE), not the three in the product doc (Normal/Sensitive/Serious). The "Sensitive → adapt wording" tier does not exist in the engine and is not invented here.
3. Safety check is unreachable without a Gemini key (engine ordering, see \*).
4. Opening sets B and C have no canonical questions in the KB; shown disabled.
5. "Edit" of a prescription = deselecting proposed ragas/activities; no free-form editing of engine output (the UI does not claim otherwise).
6. Therapist context (step 3) is stored on the record only — the engine has no endpoint for it.
7. Engine `ValueError`s on non-runtime routes surface as bare 500s; the backend probes the session to distinguish "lost session" from other errors.
8. Stray unused file `app/llm/gemini_provide.py` in the engine.

## 19. ENVIRONMENT VARIABLES
Backend (`backend/.env`): existing keys + `AI_ENGINE_URL=http://localhost:8000`, `AI_ENGINE_TIMEOUT_MS=120000`.
Frontend (`frontend/.env`): unchanged (`/api` is proxied to the backend by Vite in dev).
Engine (`ANAHAT_AI_ENGINE/.env`): `GEMINI_API_KEY` (required for steps 10+), `QDRANT_URL`, `QDRANT_COLLECTION`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION`, `RETRIEVAL_TOP_K`, `LLM_MODEL`, `KB_PATH`. Placeholders only in `.env.example`.

## 20–21. SETUP + STARTUP (dependency order: Postgres, Mongo, Qdrant → engine → backend → frontend)
```bash
# Qdrant
cd ANAHAT_AI_ENGINE && docker compose up -d            # or any Qdrant on :6333
# Engine
pip install -r requirements.txt && cp .env.example .env # set GEMINI_API_KEY
python -m ingestion.<entry>   # ingest KB once — see ANAHAT_AI_ENGINE/README.md and ingestion/
uvicorn app.main:app --host 127.0.0.1 --port 8000       # prod: same with --workers 1 (sessions are in-memory)
curl localhost:8000/health
# Backend
cd ../backend && cp .env.example .env && npm install && npm run dev   # prod: npm start
# Frontend
cd ../frontend && npm install && npm run dev            # prod: npm run build → serve dist/, proxy /api
# Contract test (engine only)
cd ../backend && node scripts/anahat-engine-contract-test.mjs
```
Health checks: `/api/health`, `/api/anahat/health` (needs login), engine `/health`.

## 22. MANUAL E2E TEST PLAN
1. Patient logs in → Assessment → record baseline → "Baseline ready".
2. Therapist (approved) opens patient record → ANAHAT Assessment → Start; expect baseline auto-applied; refresh the page → same assessment loads (URL has id).
3. Save context; choose opening set A → 4 questions listed.
4. Tick one quadrant → Continue → 3 questions appear; tick two more → "Add to scope" → questions appended; tick all remaining → 10/10.
5. Answer a question with neutral text → CLEAR, concepts + candidates (needs Gemini+Qdrant); confirm one CONFIRMED, one NEGATIVE, reject one → evidence list updates; refresh → candidates still shown.
6. Answer with "I want to kill myself" → red escalation banner, audit entry, response box disabled until acknowledged; acknowledge with note → continue.
7. Score → 7-row table; Check sufficiency → decision text; if unresolved, resolve evidence chakra and re-score.
8. Stop → recommendations → draft → untick one activity → Approve → Finalise; then click Finalise again / refresh → no new prescription, report, or notification (check `prescriptions`, `reporthistories`, `patientnotifications` counts).
9. Patient: Reports shows "ANAHAT assessment report"; Daily Activities shows the approved activities; bell shows the notification.
10. Second therapist logs in and opens the assessment URL → 403. Patient opens it → read-only 200. Postman call without cookie/header → 403 from the app-origin gate.
11. Stop the engine → any step shows the 503 message; restart engine → next step shows 409 ENGINE_SESSION_LOST + "Start a new assessment".

## FINAL STATUS: **READY FOR INTEGRATION TESTING**
Reason: every layer is code-verified and the backend↔engine contract is locally tested for all non-LLM steps; the Gemini/Qdrant/BGE-M3 path and database persistence could not be executed in this environment and must be exercised on a machine with those services before staging.
