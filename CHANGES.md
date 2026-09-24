# Changes in this build (15 Sep 2026)

## Public site
- Shared nav (`src/components/public/PublicNav.jsx`): large clickable logo → landing page; Home / About us / Login / Get started.
- Shared footer (`PublicFooter.jsx`): Contact us centred, Instagram / Facebook / Gmail, links. Contact details live in `src/constants/services.js` (CONTACT) — edit phone/email/handles there.
- Landing: removed "AI-Powered Vedic Therapy" pill, the three symbols, admin/therapist login, © line. Added About us section and sliding "Anahat services" strip (images in `public/assets/services/`).

## Auth
- Login and Register are centred cards (no orange panel), Patient/Therapist tabs on top, eye toggle on passwords. "Login as" page and "Welcome back"/"Not you?" removed. Each role is redirected to its own dashboard.

## Patient
- Demographic form: "Who are you filling this form for?" (Myself / Someone in my care + relationship, mandatory); identity-proof upload removed; profile photo & medical report optional; draft auto-saved so going back keeps everything; single "Submit" → consent form.
- New consent page (`/consent`) with checkboxes → dashboard. Dashboard layout forces consent once.
- Dashboard says "Welcome, <name>". Sidebar: Relaxation is 4th; sidebar is drag-resizable; search bar navigates to pages; back-arrow on every non-home page.
- Relaxation page rebuilt (concern dropdown + recommended raags + now-playing panel; playback disabled until tracks are uploaded).
- Music Therapy → "Music Library", Do's & Don'ts shown on open. Weekly Feedback redesigned.
- Book appointment: therapist cards (photo, name, experience, fee) → click opens full profile with available slots → book.
- Messages: WhatsApp-style chat (shared `src/components/chat/WhatsAppChat.jsx`, polls every 1.5s).
- Settings shows the demographic info the patient filled.

## Therapist
- Registration form: name → age → address, optional profile photo, free-text specialization, "Submit" → console.
- Console shows "Not approved yet" banner and locks all tabs (except Dashboard) until admin approval; unlocks automatically.
- Patients tab: cards → full patient record (sessions, attended, reports, payments, demographics, session history + summaries, payment history, progress). Patients numbered #1, #2… in order of first booking with that therapist.
- Messages tab: WhatsApp-style chat with each patient.
- Settings shows the therapist's own registration details; password change is real.
- "Contact support" removed from all dashboards.

## Backend
- `GET /api/therapists/:userId/survey`, `GET /api/therapists/:therapistId/conversations` added; `/api/therapist-surveys` readable by signed-in users (needed for specialization on booking cards).

## Notes
- Real-time chat uses 1.5s polling. For true websockets add `socket.io-client` to the frontend and hook into `backend/src/services/chatSocket.js`.
- `/begin`, `/role-select`, `/relaxation`, `/choose-journey` now redirect to the new routes.

# Round 2 (15 Sep 2026)

## Fixes
- Patient Appointments / Dashboard now read the real Postgres bookings (they were reading a separate demo store, so booked therapists never appeared). Cards show "Session with <therapist>".
- Backend `getCurrentTherapistId` referenced an un-imported model and crashed — this is why the patient Messages box never loaded. Fixed; patient ↔ booked-therapist WhatsApp chat now works both ways.
- Joining a session from a real booking works (session lookup accepts Postgres appointment ids).

## Therapist
- Profile tab is pre-filled from the database (specialization, experience, fee, bio, qualification, address); experience is free text.
- Avatars without a photo show initials from first + last name (e.g. "SP") everywhere.

## Site chrome
- About us is its own page (`/about`); removed from the landing page.
- Navbar on every public/onboarding page (shows "My dashboard / Logout" when signed in). Footer is a solid deep-teal band on every public page and at the bottom of every dashboard.
- Services slider: play/pause button removed (arrows kept).
- Demographic form: single logo (in the navbar, clickable → home), restyled like the sign-up card, on the cream page with navbar + footer. Consent page matches.
- Tracking page redesigned: mood check-in, 14-day mood graph, weekly listening/activity rings, month heat-strip, recent entries.

## Security (backend/src/middleware/auth.js)
- Sessions are bound to the client at login (fingerprint of user-agent + language, plus role). A cookie reused from another browser or an API client is rejected and the session destroyed — every browser must log in itself.
- `requireAppOrigin` now runs on every /api request including GET: `X-Requested-With: XMLHttpRequest` + Origin/Referer must match `CLIENT_URL`. Postman / Hoppscotch / curl calls get 403 before any controller. (Frontend sends the header on every fetch.)
- Ownership gates: patients can only access `/api/patients/<their own id>/…`; therapist settings & conversations are self/admin only; conversation read/send/mark-read verify membership; `send` cannot impersonate another role.
- Cookie: `httpOnly`, `sameSite: strict`, rolling expiry; sessions are regenerated on signup/login/Google callback.
- Frontend: any 401 immediately clears the session in `AuthContext` and routes to login.

# Round 3 (15 Sep 2026)

- Pages scroll again (root container no longer clips) — About us, demographic form, consent.
- Sign-up email check: malformed addresses, Gmail addresses that break Gmail's own username rules, and domains with no mail server are rejected (`backend/src/utils/emailCheck.js`). Note: Google does not expose "does this Gmail exist", so a syntactically valid unused Gmail cannot be detected without sending a verification mail.
- Phone: must be a 10-digit Indian mobile starting 6–9 (patient form, therapist form, profile edit, backend).
- Consent form no longer shows Do's & Don'ts; Music Library opens on a Do's & Don'ts gate → "I understand" → library; "Back to Do's & Don'ts" reopens it.
- Top-right shows the user's real name + photo (or two-letter initials) for patients, therapists and admins. Single-word sign-ups no longer render as "Name Name".
- Footer: thin single-row, light, dashboards only (kept on the landing page as the site's contact block).
- Daily Activities: checklist with checkboxes (auto-saves), progress bar, 14-day history. Tracking reads it.
- Notifications removed from sidebars; the bell opens the notifications page (patient) / tab (therapist). New patient notifications pop up as toasts; booking confirmation, status changes, new activities, reports and messages all notify with encouraging copy.
- Header search is feature-specific: tracks in Music Library, therapist/messages in Messages, therapists in Book Session, appointments, activities; therapist search placeholder changes per tab.
- Login has no role switch and says "Sign in"; the role comes from the account. Register says "Sign up".
- `users.phone` column added (all roles); patient/therapist forms save it; `PATCH /api/profile/contact` updates it; profile pages show it.
- Therapist availability (weekly slots + blocked dates) moved to the dashboard; removed from Profile. Profile pages (patient + therapist) redesigned as header card + detail sections, pre-filled from the demographic form / registration.
- Tracking rebuilt: no questions asked here; progress from sessions attended, raags listened, activity days and weekly-feedback mood trend, with honest, encouraging headlines and affirmations.
- Therapist patient record → Progress tab now includes listening stats and daily-activity completion.
- Payment step minimal (method list + UPI id); AI assistant removed from therapist Reports.

# Round 4 — scrolling fix
- Root cause: `index.html` set `overflow: hidden` on `<body>`, so no page could scroll past the first screen. Removed; the window now scrolls normally with the browser scrollbar visible on the right (About, sign-up, demographic form, consent, therapist form, landing).
- Landing page no longer uses a hidden inner scroll container; it scrolls with the window too.
- Extra top padding under the fixed navbar so the first card is never hidden beneath it.

# ANAHAT AI Engine integration (additive) — see ANAHAT_INTEGRATION_REPORT.md

# Round 7 (16 Sep 2026)
- FIX "Session not found" / "Session has ended" / admin "no sessions in progress": the LiveSession document exposes `_id` + boolean `active`, while every page read `id` + `status`. One adapter in `api.js` (`adaptSession`) normalises all session responses — patient join, therapist room, admin Live-now list all work. Backend untouched.
- Join window: an appointment can be joined from 10 min before start until its scheduled end time (e.g. 12:00–13:00), for patient and therapist.
- Notifications show their text (patient page read a `title` field the backend never set; now falls back to `message`). Therapist notifications now list today's sessions, new bookings and cancellations with precise text.
- Relaxation player fully works: play/pause, seek, next/previous, shuffle, loop, volume/mute. Until recorded raag tracks are uploaded it synthesises a tanpura-style drone with the Web Audio API (swap for `<audio>` later).
- Therapist live session: assistant renamed **Nadika.AI**; "Generate next question" now picks the next canonical ANAHAT question (opening set → quadrant question bank) from what the patient just said (`POST /api/anahat/sessions/:id/suggest`, KB read-only). Patient name resolves from the therapist's patient list.
- After "End session": a clean summary page (duration, messages, readable transcript) with a therapist-only **Nadika.AI chakra scan** — runs the patient's words through the AI engine, records candidates as PROVISIONAL and asks the engine to score the 7 chakras (`POST /api/anahat/sessions/:id/chakra-scan`; needs Gemini + Qdrant). Never shown to patients.
- **Report builder** (`/therapist/report/:patientId?session=…`): editable report pre-filled from the scan; "Download PDF" (print-to-PDF with print stylesheet); "Send to patient" writes to the existing Reports feed + notifies (`POST /api/anahat/reports/send`). Chakra table is included in the patient's copy only if the therapist ticks it.
- Dashboard footer is pinned to the bottom of the content pane even on short pages.
- New env (optional): `ANAHAT_KB_PATH` for Nadika's question bank (defaults to the bundled engine KB).

# Round 8 — offline sessions with Nadika.ai (16 Sep 2026)
- Appointments now have a mode (online / offline) chosen at booking (existing selector) and stored (`appointments.mode`, `appointments.meetLink`; added by sequelize sync in development).
- Patient → Appointments: grouped into Upcoming / Completed / Cancelled. Offline → "Attend Session" (no link); Online → "Join Session" opens the therapist's Google Meet link (falls back to the in-app room until a link is added). Offline sessions marked by the therapist show as "Attended".
- Therapist → Appointments: "Add Meet link" (online; patient is notified), "Join Session", "Attend Session" (offline → Nadika.ai chat), "Mark Attended/Completed".
- **Offline session = one Nadika.ai chat** (`/therapist/session/:patientId?appointment=…&mode=offline`), no patient–therapist chat. The whole ANAHAT flow happens inside it, using the existing /api/anahat endpoints: demographic summary + 3 profile-derived opening questions → baseline card → therapist context → opening sets A/B/C → questions one at a time (answered ones turn green) → engine analysis + indicator confirm/reject → suggested assessment areas ("Select assessment area", multi-select, add more later) → quadrant questions → Deep dive / Next area / Add area / End → chakra imbalances + raag recommendations (therapist-only) → Generate report → Mark session attended. Chat is persisted on the assessment record, so a refresh resumes where it left off. If the AI engine is offline, answers are still recorded against the question (no analysis, clearly stated).
- Patient dashboard: Assessment page and menu item removed; patients cannot reach the ANAHAT assessment.
- Relaxation: feedback form after listening (auto-opens when a raag finishes; also a button). Saved with the relaxation session.
- About us: "Start your healing journey" removed.
- New backend routes (additive, /api/anahat): `POST /assessments/:id/chat`, `POST /assessments/:id/asked`, `POST /assessments/:id/responses/offline`, `PATCH /appointments/:id/meet-link`. Existing `book()` accepts `mode`.

# Round 9 — assessment flow inside the Nadika.ai chat (final flow)
- Patient record: single "Start ANAHAT Session" button (opens/resumes the offline Nadika.ai session; the old ANAHAT Assessment workbench page and its routes were removed — one flow only).
- Context is a card with Save. Opening sets A (Direct & Friendly), B (Gentle Conversation), C (Simple & Supportive) are all selectable; availability is read from the KB file at runtime. B and C currently have 0 canonical questions in `opening_questions.json` — selecting them tells the therapist exactly which KB content is missing (path + the KB's own DATA GAP note) instead of inventing questions.
- Questions are presented ONE at a time (no question-bank list, no per-question Answer buttons); answered questions stay in the chat history in green; only the current question has the active response field.
- After opening responses the engine suggests quadrants; therapist selects one or many. Each quadrant asks 2–3 focused KB questions. After a quadrant: exactly "Move to next selected quadrant" / "Deep dive in this quadrant" / "End assessment", plus an AI-suggested new quadrant with Accept / Not now. Deep dive stays in the quadrant and selects remaining KB questions ranked by overlap with the acquired transcript, then free follow-ups.
- End assessment: sufficiency check (engine) → chakra scoring → raga/activity recommendations (therapist-only) → prescription review (tick/untick, note, Approve & finalise / Reject) → idempotent finalize (existing Prescription + ReportHistory + notification) → "Open report (PDF)" — all inside the chat.
