import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { LiveSession, ReportHistory, PatientNotification, AuditLog } from '../models/mongo/patientData.js';
import { AnahatBaseline } from './anahatModels.js';
import { engine, EngineError, QUADRANTS } from './engineClient.js';
class AppError extends Error { constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra); } }
export { AppError as NadikaError };

// ---------------------------------------------------------------------------
// "Nadika.AI" — the in-session assistant + post-session chakra scan.
//
//  • suggestNext(): picks the next question from the ANAHAT knowledge base
//    (fixed opening questions + quadrant question bank) using keyword routing
//    on the patient's latest messages. Questions are never generated; only
//    chosen. Read-only access to the engine's KB files.
//  • chakraScan(): after a session ends, feeds the patient's own words to the
//    AI engine (safety → Gemini → BGE-M3/Qdrant → candidates), auto-records
//    candidates as PROVISIONAL evidence and asks the engine to score all 7
//    chakras. Result is therapist-only and clearly labelled provisional.
// ---------------------------------------------------------------------------

const KB_ROOT = process.env.ANAHAT_KB_PATH
  || path.resolve(process.cwd(), '..', 'ANAHAT_AI_ENGINE', 'knowledge_base', 'ANAHAT_KnowledgeBase_v3', 'structured');

let kbCache = null;
function loadKb() {
  if (kbCache) return kbCache;
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(KB_ROOT, f), 'utf8')); } catch { return null; } };
  const opening = read('opening_questions.json');
  const bank = read('quadrant_question_bank.json');
  const quadrants = Array.isArray(bank) ? bank : (bank?.quadrants || Object.values(bank || {}).find(Array.isArray) || []);
  const fixedOpeningQuestions = (opening?.opening_questions?.questions || []).map((q) => ({ id: q.id, text: q.text, source: 'Opening Questions' }));
  kbCache = {
    openingQuestions: fixedOpeningQuestions,
    quadrants: quadrants.map((q) => ({
      name: q.name,
      questions: (q.attributes_with_responses || []).map((a, i) => ({
        id: `Q-${q.quadrant_id}-${i + 1}`, attribute: a.attribute,
        text: `How would you describe your experience with ${String(a.attribute || '').toLowerCase()}?`,
        source: `${q.name} question bank`,
      })),
    })),
  };
  return kbCache;
}

// Keyword routing: which quadrant a message most likely touches. This is a
// UI convenience for choosing the next canonical question — it never feeds
// scoring or evidence.
const ROUTES = [
  ['Family', ['family', 'mother', 'father', 'parent', 'wife', 'husband', 'spouse', 'child', 'son', 'daughter', 'home', 'marriage', 'sibling', 'brother', 'sister']],
  ['Social Circle', ['friend', 'social', 'people', 'alone', 'lonely', 'colleague', 'community', 'relationship', 'partner']],
  ['Profession', ['work', 'job', 'office', 'boss', 'career', 'deadline', 'salary', 'business', 'study', 'exam', 'college', 'school']],
  ['Lifestyle', ['sleep', 'routine', 'phone', 'screen', 'exercise', 'gym', 'walk', 'smoke', 'drink', 'alcohol', 'late', 'morning', 'night']],
  ['Diet', ['eat', 'food', 'diet', 'meal', 'appetite', 'sugar', 'weight', 'hungry', 'coffee', 'tea']],
  ['Physical Nature', ['pain', 'head', 'stomach', 'back', 'body', 'tired', 'fatigue', 'energy', 'breath', 'heart', 'ache', 'dizzy']],
  ['Medical & Therapeutic Background', ['doctor', 'medicine', 'medication', 'therapy', 'diagnos', 'hospital', 'treatment', 'surgery', 'tablet']],
  ['Music Therapy Profile', ['music', 'song', 'raag', 'raga', 'sing', 'listen', 'instrument', 'sound']],
  ['Personal Interests', ['hobby', 'interest', 'enjoy', 'passion', 'read', 'paint', 'travel', 'play', 'art']],
  ['Nature', ['angry', 'anger', 'calm', 'shy', 'introvert', 'extrovert', 'temper', 'patient', 'personality', 'mood']],
];

// The therapy workflow uses one fixed question set; the KB exposes the
// canonical opening questions under opening_questions.questions.
export function openingSetsFromKb(base) {
  const opening = (() => { try { return JSON.parse(fs.readFileSync(path.join(KB_ROOT, 'opening_questions.json'), 'utf8')); } catch { return null; } })();
  const fixed = opening?.opening_questions?.questions || [];
  return (base || []).map((s) => ({
    ...s,
    questionCount: fixed.length,
    unavailable: false,
    kbNote: null,
    kbPath: 'knowledge_base/ANAHAT_KnowledgeBase_v3/structured/opening_questions.json → opening_questions.questions',
  }));
}

export function suggestFromKb(messages, alreadyAsked = []) {
  const kb = loadKb();
  const patientText = messages.filter((m) => m.from === 'patient').slice(-3).map((m) => String(m.text || '').toLowerCase()).join(' ');
  const asked = new Set(alreadyAsked);
  const scores = ROUTES.map(([q, kws]) => [q, kws.reduce((n, k) => n + (patientText.includes(k) ? 1 : 0), 0)]).sort((a, b) => b[1] - a[1]);
  const [bestQ, hits] = scores[0] || [null, 0];

  // No patient words yet → the first unasked fixed opening question.
  if (!patientText.trim() || hits === 0) {
    const q = kb.openingQuestions.find((x) => !asked.has(x.id)) || kb.openingQuestions[0];
    return q ? { ...q, quadrant: null, reason: patientText.trim() ? 'No specific area detected yet — continue with the fixed opening questions.' : 'Session just started — begin with the fixed opening questions.' } : null;
  }
  const quad = kb.quadrants.find((x) => x.name === bestQ);
  const q = quad?.questions.find((x) => !asked.has(x.id)) || quad?.questions[0];
  if (!q) return null;
  return { ...q, quadrant: bestQ, reason: `The patient's last replies touch on ${bestQ.toLowerCase()} (${hits} cue${hits === 1 ? '' : 's'}).` };
}

async function loadOwnedSession(user, sessionId) {
  if (!mongoose.isValidObjectId(sessionId)) throw new AppError('Session not found.', 404);
  const s = await LiveSession.findById(sessionId);
  if (!s) throw new AppError('Session not found.', 404);
  if (user.role !== 'admin' && s.therapistId !== user.id) throw new AppError('Only the session therapist can use Nadika.AI here.', 403);
  return s;
}

export async function suggestNext(user, sessionId) {
  const s = await loadOwnedSession(user, sessionId);
  const asked = (s.aiMessages || []).map((m) => m.questionId).filter(Boolean);
  const suggestion = suggestFromKb(s.messages || [], asked);
  if (!suggestion) throw new AppError('The ANAHAT question bank could not be read. Set ANAHAT_KB_PATH on the backend.', 503);
  const answer = `${suggestion.text}`;
  await LiveSession.findByIdAndUpdate(sessionId, { $push: { aiMessages: { question: suggestion.reason, answer, questionId: suggestion.id, quadrant: suggestion.quadrant, source: suggestion.source, at: new Date() } } });
  return suggestion;
}

// ---- post-session chakra scan (therapist-only) ------------------------------

const scanSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  patientId: { type: String, index: true },
  therapistId: { type: String, index: true },
  engineSessionId: String,
  status: { type: String, default: 'pending' },      // pending | done | escalated | failed
  messagesScanned: { type: Number, default: 0 },
  candidates: { type: [mongoose.Schema.Types.Mixed], default: [] },
  evidence: { type: [mongoose.Schema.Types.Mixed], default: [] },
  safetyEvents: { type: [mongoose.Schema.Types.Mixed], default: [] },
  report: mongoose.Schema.Types.Mixed,
  error: String,
}, { timestamps: true });
export const AnahatSessionScan = mongoose.model('AnahatSessionScan', scanSchema);

export async function getScan(user, sessionId) {
  await loadOwnedSession(user, sessionId);
  const row = await AnahatSessionScan.findOne({ sessionId }).sort({ createdAt: -1 });
  return row ? { id: row._id, ...row.toObject(), _id: undefined, __v: undefined } : null;
}

export async function chakraScan(user, sessionId, { force = false } = {}) {
  const s = await loadOwnedSession(user, sessionId);
  if (s.active) throw new AppError('End the session before running the chakra scan.', 409);
  const existing = await AnahatSessionScan.findOne({ sessionId, status: 'done' });
  if (existing && !force) return { id: existing._id, ...existing.toObject(), _id: undefined, __v: undefined, cached: true };

  const patientMsgs = (s.messages || []).filter((m) => m.from === 'patient' && String(m.text || '').trim());
  if (!patientMsgs.length) throw new AppError('The patient did not say anything in this session, so there is nothing to scan.', 409);

  const scan = await AnahatSessionScan.create({ sessionId, patientId: s.patientId, therapistId: s.therapistId, messagesScanned: patientMsgs.length });
  try {
    const es = await engine.createSession({ patient_id: s.patientId, language: 'en', communication_preferences: { source: 'live_session_scan', sessionId } });
    scan.engineSessionId = es.session_id;
    // Use the patient's own recorded baseline when there is one; otherwise
    // the engine is scored without a baseline (it does not require one for
    // response processing).
    const b = await AnahatBaseline.findOne({ patientId: s.patientId }).sort({ createdAt: -1 });
    if (b) { try { await engine.baseline(es.session_id, { stress: b.stress, anxiety: b.anxiety, mood: b.mood, sleep_quality: b.sleep_quality, energy: b.energy }); } catch { /* optional */ } }

    let escalated = false;
    for (const m of patientMsgs) {
      const r = await engine.respond(es.session_id, { text: m.text });
      if (r.status === 'SAFETY_ESCALATION') { scan.safetyEvents.push({ text: m.text, safety: r.safety }); escalated = true; continue; }
      for (const c of r.candidates || []) {
        scan.candidates.push({ ...c, sourceText: m.text });
        try {
          const conf = await engine.confirm(es.session_id, c.candidate_id, { response_id: r.response_id, confirmed: true, evidence_status: 'PROVISIONAL', confirmation_actor: 'therapist', therapist_note: 'auto-recorded from live session transcript (provisional; not therapist-confirmed)' });
          if (conf.evidence) scan.evidence.push(conf.evidence);
        } catch { /* candidate not canonical → skipped by engine */ }
      }
    }
    scan.report = scan.evidence.length ? await engine.chakraReport(es.session_id) : { results: [], supported_chakras: [], note: 'No canonical indicators were found in the transcript.' };
    scan.status = escalated ? 'escalated' : 'done';
    await scan.save();
    await AuditLog.create({ action: 'anahat.session.chakra_scan', actor: user.id, detail: { sessionId, evidence: scan.evidence.length, escalated } });
    return { id: scan._id, ...scan.toObject(), _id: undefined, __v: undefined, cached: false };
  } catch (err) {
    scan.status = 'failed'; scan.error = err.message; await scan.save();
    if (err instanceof EngineError) throw err;
    throw new AppError(`Chakra scan failed: ${err.message}`, 502);
  }
}

// ---- send a therapist-written report to the patient (existing models) -------

export async function sendReport(user, { patientId, sessionId, report }) {
  if (!patientId || !report?.title) throw new AppError('patientId and a report title are required.');
  if (sessionId) await loadOwnedSession(user, sessionId);
  const row = await ReportHistory.create({
    patientId,
    report: { ...report, type: report.type || 'session_report', sessionId: sessionId || null, therapistId: user.id, status: 'approved', approvedAt: new Date() },
  });
  await PatientNotification.create({ patientId, message: `Your therapist has shared a report: "${report.title}". Open Reports to read it.`, detail: { kind: 'report', reportId: String(row._id) } });
  await AuditLog.create({ action: 'anahat.report.sent', actor: user.id, detail: { patientId, reportId: row._id, sessionId } });
  return { id: row._id, ...row.report, createdAt: row.createdAt };
}
