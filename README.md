# Harmony — Frontend-2 wired to the real backend

This package contains:

- **`backend/`** — your existing Express + PostgreSQL + MongoDB backend, unchanged except for
  purely *additive* new files (nothing existing was deleted or rewritten).
- **`frontend/`** — Frontend-2 (kept its UI/design), now actually talking to `backend/` instead
  of using fake/mocked logins and localStorage.
- **`frontend-1-reference/`** — your original Frontend-1, untouched, kept only for reference/diffing.
  It is not part of the running app anymore; Frontend-2 replaces it.

---

## 1. How to run it

**Prerequisites:** Node 18+, a running PostgreSQL instance, a running MongoDB instance.

### Backend

```bash
cd backend
cp .env.example .env      # edit PG_URI / MONGO_URI if yours differ from the defaults
npm install
npm run dev                # or: npm start
```

It listens on `http://localhost:5000`. On first boot it auto-creates the fixed admin account
from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`.

### Frontend

```bash
cd frontend
cp .env.example .env       # leave VITE_API_BASE_URL empty — the Vite proxy handles it
npm install
npm run dev
```

It listens on `http://localhost:5174` and proxies `/api` and `/socket.io` to the backend
(see `vite.config.js`). Open `http://localhost:5174`.

### Try the patient flow

1. Go to **Sign Up**, register as a patient.
2. You land on the **onboarding form** — fill it in (now includes profile photo + health report
   upload, ported over from Frontend-1).
3. Submit → you go **straight to the dashboard**. No approval screen, no waiting.
4. Log out, log back in with the same account → you go **straight to the dashboard** again
   (skips onboarding, since your profile is already complete).

Therapist signup still requires admin approval, by design — only the *patient* flow was
approval-gated before, and now it isn't.

---

## 2. What Frontend-1 had that Frontend-2 was missing

- **Profile photo upload** on the patient demographic form — Frontend-2's onboarding form had no
  avatar upload at all.
- **Health report upload** on the patient demographic form — same gap.
- A working **auth flow talking to a real backend** — Frontend-2's login/register pages had
  hardcoded `http://localhost:3000` URLs, wrong field names (`/auth/register` instead of
  `/auth/signup`, a single `name` field instead of `firstName`/`lastName`), and — most
  importantly — **fell back to a fake local login whenever the real request failed**, so it
  looked functional even with no backend running at all.
- **Session persistence** — Frontend-2 stored a fake `token` in `localStorage` and never
  actually validated it against anything; refreshing the page or opening a new tab had no real
  concept of "am I still logged in."
- A `fee` and `address` on the therapist application — required by the backend to make a
  therapist bookable, but absent from Frontend-2's therapist onboarding survey.

## 3. What I added / changed

**Backend (all additive — nothing existing was modified or deleted):**
- `models/mongo/patientData.js`, `controllers/patientDataController.js`,
  `routes/patientDataRoutes.js` — implements the ~45 endpoints Frontend-2's `API_CONTRACT.md`
  describes and Frontend-1's backend didn't have: patient profile/journey, mood entries,
  relaxation sessions, documents, track selection/history, weekly feedback, therapy records +
  report history, listening log, site feedback, audit log, admin notifications, user directory,
  therapist survey + concern-based auto-assignment, activity plans/check-ins, live session
  workspace (with a clearly-labeled rule-based AI-copilot stand-in, since no LLM key is
  configured), patient notifications, and patient↔therapist conversations.
- **Patient onboarding auto-approves immediately on submit** — this is the core fix for "no
  approval system for patients." There is no pending/waiting state a patient can get stuck in.
- Frontend-2's own booking model lives at `/api/bookings` (not `/api/appointments`) — kept
  deliberately separate from your existing Postgres-backed, payment-integrated
  `/api/appointments` flow so nothing about Frontend-1's booking/payment path changed.
- A real `PATCH /api/account/change-password` endpoint (bcrypt-verified).

**Frontend-2:**
- `services/api.js` — switched from fake Bearer-token/localStorage auth to real cookie-session
  auth (matching how your backend already works), pointed at `/api` via the Vite proxy, and
  added response-shape adapters for the two endpoints that collide with existing backend routes
  (`getTherapists()`, `getTrackCatalog()`).
- `AuthContext.jsx`, `usePatientSession.js`, `ProtectedRoute.jsx`, `RoleProtectedRoute.jsx` —
  rebuilt around a real session check (`GET /api/auth/me`) instead of a localStorage flag. This
  also fixes a real bug I found: the route guards checked `localStorage.getItem('token')`, which
  is never set under cookie auth, so protected routes would have silently redirected every
  logged-in user back to `/login`.
- `Login.jsx` / `Register.jsx` — real signup/login calls, no mock fallback, real Google OAuth
  redirect, and existing patients now route straight to `/dashboard` (new ones go to
  `/onboarding`) based on the backend's `isProfileComplete` flag.
- `Onboarding.jsx` — added profile photo + health report upload fields; submit now writes to
  *both* the new Mongo onboarding record and the existing Postgres profile-completion endpoint
  (so `isProfileComplete` flips correctly); redirects straight into the app instead of to a
  pending-approval screen; copy no longer claims a therapist has to review you.
- `TherapistOnboardingSurvey.jsx` — added the `fee`/`address` fields the backend requires, and
  now also writes to the real profile-completion endpoint.
- Fixed several other pages (`Reports.jsx`, `Profile.jsx`, `Settings.jsx`, `Feedback.jsx`) that
  called nonexistent backend routes with fake tokens — rewired to real endpoints, or (for
  password change) backed by a small new real endpoint.
- Added `AuthCallback.jsx` for the Google OAuth redirect.

## 4. What's still missing / not wired up

Being direct about the remaining gaps rather than papering over them:

- **`/chat` (AI wellness chat) and `ConversationSettings.jsx`** — this is a large (~1,100 line)
  AI-chatbot feature (session resume, message history, export, clear-all) that needs a real LLM
  backend. Neither provided codebase has one. It's not wired up; it degrades safely to an idle
  screen rather than crashing, since its own auth guard never finds a token.
- **`/report/:sessionId` (`ReportPage.jsx`)** — expects a rich AI-generated report (chakra
  analysis, raga music recommendations) that would need a dedicated analysis backend. It shows a
  graceful "Error Loading Report" rather than the real thing.
- **Caregiver pages** (`CaregiverDashboard`, `CaregiverStatus`, `CaregiverAccessRequest`,
  `CaregiverReportPage`) — a separate role/flow not mentioned in your requirements; left
  unwired. Same story: hardcoded `localhost:3000` calls, not connected.
- **Bulk `PUT /api/therapists`** — Frontend-2's API contract mentions this as a legacy bulk-edit
  convenience endpoint; not implemented (therapists are created via signup, not admin bulk-edit).
  Currently a no-op that returns the existing list.
- **Real-time chat delivery** — the new patient↔therapist conversations endpoints are
  polling-based (no socket.io wiring), unlike the existing `/api/chat` system which does have
  sockets. Messages work, they just aren't pushed instantly.
- **AI copilot in the live session workspace** — implemented as a clearly-labeled rule-based
  stand-in, since no LLM API key is configured.

---

## Update: Auth redesign, demographic form, admin consoles, approval-bug fix

This section documents a later round of changes on top of everything above. As before, nothing
existing was deleted or restructured unless called out here — these are additive/targeted fixes.

### 1. Login / Register
- Added a shared `AuthModeToggle` (animated pill slider) at the top of both the Login and
  Register cards — both options are now equally prominent and immediately visible.
- Phone/OTP login and signup removed completely (state, handlers, and UI) from both pages.
- Google auth is now a single always-visible button at the bottom of both forms, below a
  divider, instead of being hidden behind a third "method" tab.

### 2. Demographic form (patient onboarding)
- Profile photo moved to the very top of the form as a circular avatar with a pencil-icon edit
  button and live preview — no longer looks like a generic file-upload field.
- Added a **Blood Group** field.
- Added dynamic "Other → please specify" text inputs for **Country**, **Occupation**,
  **Education Level**, and **How did you hear about us**, plus a "Which doctor referred you?"
  reveal when "Doctor Referral" is selected. Validation requires these when shown.

### 3. Anahat Admin
- **Root-caused and fixed the therapist-approval bug** (see section 5 below) — this is what
  actually made new therapists invisible to admin.
- Removed the Messages tab (clinical patient↔therapist communication belongs to the therapist
  console, which already has its own).
- Added a full **Patient Detail View** (click any patient in the Patients tab): demographics,
  profile photo, session history, sessions attended, payments, therapy reports, and a simple
  progress summary (sessions completed + mood check-ins).
- Added **"+ Add Offline Session"** on the patient detail view — a modal to log date, time,
  therapist, session type, status, summary, and notes for a session that happened outside the
  app. Backed by a new endpoint, `POST /api/bookings/offline` (admin/therapist only), which
  reuses the existing frontend-2 booking model rather than creating a parallel one.

### 4. Technical Admin
- Reorganized around system/account administration across **every** role (Anahat Admins,
  therapists, patients, caretakers) rather than clinical workflows — those stay in Anahat Admin.
- **Users tab**: removed the "Create User" button — it only ever wrote a fake, passwordless
  account to a side table with no real backend behind it. Suspend/Reactivate is now real:
  backed by a new `isSuspended` column on the actual `User` table, enforced at login *and* on
  every authenticated request (a suspended user is logged out immediately, not just blocked from
  logging back in).
- **System tab**: replaced a grid of unwired placeholder panels with live data from a new
  `GET /api/admin/system-info` endpoint — PostgreSQL/MongoDB connection status, environment,
  uptime, Google OAuth configuration presence, and account counts by role, all checked in real
  time on every load.
- Therapists tab now reads from the same real source of truth as Anahat Admin (see below), so
  the two consoles can never disagree about who's approved.

### 5. Therapist approval bug — root cause and fix
**Root cause:** Anahat Admin's therapist list was calling `GET /api/therapists` — the
*public-facing directory* endpoint, which by design only returns therapists where
`isApproved: true`. A newly-registered, not-yet-approved therapist can never appear there,
no matter what. It wasn't a database or "hardcoded status" bug — it was the admin UI reading
from the wrong endpoint.

**Fix:**
- Anahat Admin and Technical Admin now both list therapists via `GET /api/admin/users?role=therapist`
  (already existed in the backend, unfiltered by approval status), enriched with the therapist's
  sign-up survey (qualification, specializations) for display.
- Approving/rejecting calls the real `PATCH /api/admin/therapists/:id/approve`, which flips the
  actual `isApproved` column — the same flag checked by login routing, the therapist portal's own
  gate, and the public directory. There is exactly one source of truth now.
- Removed a second, separate "approval status" that had been tracked in MongoDB — it could
  drift out of sync with the real Postgres flag depending on which screen last touched it. Every
  screen that needs to know "is this therapist approved" now reads `isApproved`/
  `isProfileComplete` directly off the session user or the admin user list.
- End-to-end flow verified by code inspection: Register → survey submitted
  (`isProfileComplete: true`) → appears in Anahat Admin's Therapists tab as "Pending" → Approve
  sets `isApproved: true` → therapist's next login (or "Check Again" on the pending screen, which
  re-fetches the real session) routes them straight into the console.

### Migration note
This update adds one new column, `isSuspended` (boolean, default `false`), to the existing
`users` table. With `NODE_ENV=development` the backend's `sequelize.sync({ alter: true })` adds
it automatically on next boot. **In production**, run an explicit migration (or a one-time
`ALTER TABLE users ADD COLUMN "isSuspended" BOOLEAN DEFAULT false;`) before deploying, since
production sync does not auto-alter existing tables.

### Verified
- `npm run build` (frontend) completes with no errors.
- Every backend file passes `node --check` (syntax) and the full `app.js` module graph resolves
  cleanly (import smoke test with dummy env vars, no live DB required).
- Not verified: a live end-to-end run against real Postgres/Mongo instances (not available in
  this environment) — please smoke-test the full Register → Onboarding → Dashboard and
  Therapist Register → Survey → Anahat Admin Approve → Therapist Login flows once against a real
  database before shipping.


---

## Update: Real booking system, no assignment/approval on patient side, demo prompt, level auto-detection

This is the third round of changes. As before, additive/targeted — nothing else was restructured.

### What changed

1. **Registration flow**: removed the "Continue / Back to Form" confirmation screen after
   registration entirely (`Register.jsx`) — it now navigates straight to its destination. New
   patients land on a **"Do you want a demo?"** prompt (`DemoPrompt.jsx`) — Yes opens the existing
   self-guided AI chat experience (no new system built), No goes straight to the demographic form.
   Therapists are never shown to a patient during signup or onboarding.

2. **Demographic form**: all fields are mandatory except the medical report/document upload
   (already the only optional upload). Profile photo is a circular upload with live preview
   (from the previous round). Blood Group and all "Other → please specify" dynamic fields already
   in place from the previous round.

3. **No patient-therapist assignment, anywhere.** This was a real gap from the previous round —
   found and removed:
   - The call in `ChooseJourney.jsx` that silently auto-assigned a therapist when a patient chose
     "Professional Consultation."
   - The entire "Patient Assignments" tab from Anahat Admin, plus its sidebar entry, and the
     now-orphaned `AssignmentsTab.jsx` / `AssignmentQueue.jsx` files (deleted).
   - The dormant assignment backend endpoints (`/api/patients/:id/assign-therapist`, etc.) are
     left in place but are no longer called by any part of the UI — nothing reaches them anymore.

4. **Real booking system, not a duplicate one.** The patient booking flow (`BookSession.jsx`) now
   uses the **existing Postgres backend** — `GET /api/therapists` (approved list), the real
   `GET /api/therapists/:id/free-slots` (which already computes genuine availability from
   recurring weekly slots minus blocked dates minus existing bookings), and `POST /api/appointments`
   (which re-validates the slot server-side, preventing double-booking). This replaces an earlier,
   separate Mongo-based booking model that had no real conflict checking — reusing the system that
   was already built for this, rather than maintaining two.
   - Therapist cards now show **Name, Experience, Expertise (from their sign-up survey), Fees,
     and Location** (the existing `therapistProfile.address` field), plus a **location filter**.
   - Added one small, justified backend endpoint, `PATCH /api/appointments/:id`, so a booking can
     be cancelled/completed/rescheduled — the existing backend only had create + list + pay.

5. **Therapist side — no patient-approval UI, real availability, automatic level.**
   - Deleted `PatientApprovalsPanel.jsx` and its nav entry — it was a literal Approve/Reject-patient
     screen, which the product no longer wants (a patient booking a real, available slot is enough;
     the therapist just sees it appear on their dashboard).
   - `AppointmentsTab.jsx` (therapist) no longer has an accept/decline "Requests" concept — bookings
     are already confirmed once paid; the therapist can mark one Completed or Cancel it.
   - **Availability editor** (`ProfileTab.jsx`) now collects real day-of-week + start/end time
     ranges (e.g. Mon–Fri, 10:00–13:00) via the existing `/api/therapists/me/slots` endpoint, and
     blocking a specific date via the existing `/api/therapists/me/blocked-dates` — both already
     existed in the backend and needed no changes.
   - **Beginner/Professional is now fully automatic**, derived from the experience years given at
     registration (`deriveLevel()` — 5+ years = Professional). There is no login-time prompt and
     no manual override; `ProfileTab.jsx` shows it as a read-only badge.
   - The therapist's **Patients list** is now derived from who has actually booked them (their real
     appointments), not an assignment list.

6. **Upload Document page's Back button** (`DocumentUpload.jsx`) was hardcoded to always return to
   "Select Type of Therapy," which was wrong when the page is opened from the dashboard sidebar
   (its more common entry point) rather than during onboarding. Changed to `navigate(-1)`, so it
   correctly returns to wherever the patient actually came from.

7. **Admin**: Anahat Admin's Bookings/Sessions/Reports/Patients tabs now read from the same real
   Postgres appointments table everything else uses (`GET /api/admin/appointments`). "Patient
   Assignments" removed per the explicit instruction not to have one there.

### Known gap — not implemented

**Item 9, PDF session report generation**, is not done. The underlying data model exists (therapist
can already write a report per session via the Reports tab, stored per-patient), but generating
an actual downloadable PDF file was out of scope for the time available in this pass. This is the
one explicitly-requested capability still missing; happy to build it in a follow-up.

### Verified
- `npm run build` (frontend) completes with no errors.
- Every backend file passes `node --check`, and the full module graph resolves cleanly.
- Not verified: a live run against real Postgres/Mongo (still not available in this sandbox) —
  please smoke-test Register → Demo Prompt → Onboarding → Choose Therapy → Book Session → real
  slot picking → payment → appearing on both dashboards, end to end, before shipping.
