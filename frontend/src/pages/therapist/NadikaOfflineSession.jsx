import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { anahat, getPatientOnboarding, updateAppointmentStatus } from '../../services/api';
import { PageShell } from '../../components/ui/Kit';
import { initialsOf } from '../../utils/initials';

const TEAL = '#0d5239';
const TEAL_SOFT = '#E6F0EA';
const CREAM = '#F6F4EC';
const SLEEP = ['Poor', 'Fair', 'Good', 'Excellent'];
const FIXED_OPENING_SET_ID = 'A';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const ts = (d) => new Date(d || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------------------
// Offline (in-person) session: ONE chat with Nadika.ai that carries the whole
// ANAHAT assessment. Therapist reads the suggested question aloud, types the
// patient's answer, Nadika analyses (via the backend → AI engine) and moves
// the flow on. Every step maps to the existing /api/anahat endpoints — no
// clinical logic lives here.
// ---------------------------------------------------------------------------

function demographicSummary(ob = {}, pp = {}) {
  const bits = [];
  if (pp.age || ob.dob) bits.push(`${pp.age ? `${pp.age} yrs` : ''}${ob.gender ? `, ${ob.gender}` : ''}`.replace(/^, /, ''));
  if (ob.occupation) bits.push(ob.occupation === 'Other' ? ob.otherOccupation : ob.occupation);
  if (ob.maritalStatus) bits.push(ob.maritalStatus.toLowerCase());
  if (ob.city) bits.push(`from ${ob.city}`);
  const concerns = [...(ob.concerns || []).filter((c) => c !== 'Other'), ob.otherConcern].filter(Boolean);
  const lines = [bits.filter(Boolean).join(' · ')];
  if (concerns.length) lines.push(`Main concerns: ${concerns.join(', ')}.`);
  if (ob.sleepPattern) lines.push(`Sleep: ${ob.sleepPattern}.`);
  if (ob.additionalInfo) lines.push(`Notes from the form: "${ob.additionalInfo}"`);
  if (ob.formFor === 'care') lines.push(`Form filled by ${ob.caregiverName || 'a caregiver'} (${ob.relationship || 'caregiver'}).`);
  return lines.filter(Boolean).join('\n');
}

export default function NadikaOfflineSession({ patientId, patientName, appointmentId }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [doc, setDoc] = useState(null);
  const [ref, setRef] = useState(null);
  const [engineUp, setEngineUp] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [chat, setChat] = useState([]);              // {id, role: 'nadika'|'therapist', text?, card?, at}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [baseline, setBaseline] = useState({ stress: 5, anxiety: 5, mood: 5, energy: 5, sleep_quality: '' });
  const [pickedQ, setPickedQ] = useState([]);
  const [phase, setPhase] = useState('loading');   // loading | baseline | context | opening | question | review | scope | decision | deep | ended | done
  const [current, setCurrent] = useState(null);     // question being asked {id,text,quadrant}
  const [quadrantCursor, setQuadrantCursor] = useState(0);
  const [lastResponse, setLastResponse] = useState(null);
  const [results, setResults] = useState(null);     // {chakra, ragas, activities}
  const [contextText, setContextText] = useState('');
  const [openingQuestions, setOpeningQuestions] = useState([]);
  const [openingSummary, setOpeningSummary] = useState('');
  const [rx, setRx] = useState(null);              // prescription draft working copy {ragas, activities, note}
  const [rxSuggest, setRxSuggest] = useState(null);
  const bottomRef = useRef(null);
  const booted = useRef(false);

  const resetSessionState = () => {
    setDoc(null);
    setRef(null);
    setEngineUp(null);
    setOnboarding(null);
    setChat([]);
    setInput('');
    setBusy('');
    setError('');
    setBaseline({ stress: 5, anxiety: 5, mood: 5, energy: 5, sleep_quality: '' });
    setPickedQ([]);
    setPhase('loading');
    setCurrent(null);
    setQuadrantCursor(0);
    setLastResponse(null);
    setResults(null);
    setContextText('');
    setOpeningQuestions([]);
    setOpeningSummary('');
    setRx(null);
    setRxSuggest(null);
  };

  const say = (role, text, card, extra = {}) => {
    const entry = { id: uid(), role, text, card, at: new Date().toISOString(), ...extra };
    setChat((c) => [...c, entry]);
    return entry;
  };
  const persist = (entries) => doc && anahat.appendChat(doc.id, entries).catch(() => {});
  const nadika = (text, card) => { const e = say('nadika', text, card); persist(e); return e; };
  const me = (text) => { const e = say('therapist', text); persist(e); return e; };

  const run = async (label, fn) => { setBusy(label); setError(''); try { return await fn(); } catch (e) { setError(e.message || 'Something went wrong'); return null; } finally { setBusy(''); } };

  // ---- boot: create/resume assessment, load reference + demographics ------
  useEffect(() => {
    booted.current = false;
    resetSessionState();

    anahat.health().then((h) => setEngineUp(!!h.ok)).catch(() => setEngineUp(false));
    anahat.reference().then(setRef).catch(() => {});
    (async () => {
      const ob = await getPatientOnboarding(patientId).catch(() => null);
      setOnboarding(ob);
      const r = await run('Opening your session', () => anahat.create({ patientId, appointmentId, force: true }));
      if (!r) { setPhase('error'); return; }
      const d = r.assessment; setDoc(d);
      if (d.chatLog?.length) { setChat(d.chatLog.map((e) => ({ ...e, id: e.id || uid() }))); resumePhase(d); return; }
      const hour = new Date().getHours();
      const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      const first = (user?.name || 'there').split(' ')[0];
      const summary = demographicSummary(ob?.fields, d.baseline ? {} : {});
      say('nadika', `${greet}, ${first}. Here is what ${patientName} shared on the demographic form.\n${summary || 'The demographic form is empty.'}`);
      if (d.baseline) { setBaseline(d.baseline); resumePhase(d); }
      else { setPhase('baseline'); say('nadika', 'Before we begin, let\u2019s record the baseline. Ask the patient to rate each of these right now and fill them in.', { type: 'baseline' }); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, appointmentId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.length, phase]);

  // Work out where a resumed assessment left off.
  const resumePhase = (d) => {
    if (d.status === 'completed') { setPhase('done'); return; }
    if (d.prescriptionDraft) { setRx({ ragas: d.prescriptionDraft.raga_candidates || [], activities: d.prescriptionDraft.activities || [], note: '' }); setPhase('prescription'); return; }
    if (d.recommendations) { setPhase('ended'); return; }
    if (!d.baseline) { setPhase('baseline'); return; }
    if (!d.therapistContext) { setPhase('context'); return; }
    if (!d.openingSetId) { setPhase('opening'); return; }
    if (!d.openingSetId) {
  setPhase('opening');
  return;
}

if (
  d.openingQuestions?.length &&
  !(d.openingSummary || d.openingCompleted)
) {
  setOpeningQuestions(
    d.openingQuestions.map((q) => ({
      id: q.id,
      text: q.text,
    }))
  );

  setOpeningSummary(d.openingSummary || '');
  setPhase('opening');
  return;
}
    if (!d.scope?.length) { setPhase('scope'); return; }
    for (let i = 0; i < d.scope.length; i += 1) {
      const q = (d.quadrantQuestions?.[d.scope[i]] || []).slice(0, 3).find((x) => !asked.has(x.id));
      if (q) { setQuadrantCursor(i); setCurrent({ id: q.id, text: q.question, quadrant: d.scope[i] }); setPhase('question'); return; }
    }
    setQuadrantCursor(Math.max(0, d.scope.length - 1)); setPhase('decision');
  };

  // ---- step handlers ------------------------------------------------------
  const submitBaseline = () => run('Recording baseline', async () => {
    if (!baseline.sleep_quality) throw new Error('Pick the patient\u2019s sleep quality.');
    const d = await anahat.setBaseline(doc.id, baseline); setDoc(d);
    me(`Baseline — stress ${baseline.stress}/10, anxiety ${baseline.anxiety}/10, mood ${baseline.mood}/10, energy ${baseline.energy}/10, sleep ${baseline.sleep_quality}.`);
    nadika('Thank you. Now add your own context for this session — how the patient presents, anything you already know — and save it.', { type: 'context' });
    setPhase('context');
  });

  const submitContext = (text) => run('Saving context', async () => {
    if (!text.trim()) throw new Error('Write a line of context first.');
    const d = await anahat.setContext(doc.id, text); setDoc(d);
    me(text);

    const r = await anahat.selectOpening(doc.id, FIXED_OPENING_SET_ID);
    const assessment = r.assessment;
    const qs = (r.opening?.questions || []).map((q) => ({ id: q.id, text: q.text }));

    if (qs.length !== 4) {
      throw new Error('The fixed opening questions must contain exactly 4 questions.');
    }

    setDoc(assessment);
    setOpeningQuestions(qs);
    setOpeningSummary('');

    nadika('Opening Questions', { type: 'opening', items: qs });
    setPhase('opening');
  });

const submitOpeningSummary = () => run(
  'Analysing the opening conversation',
  async () => {
    const summary = openingSummary.trim();

    if (!summary) {
      throw new Error(
        'Enter one combined summary of the patient’s responses.'
      );
    }

    if (openingQuestions.length !== 4) {
      throw new Error(
        'The selected opening set must contain exactly 4 questions.'
      );
    }

    // NOTE: this used to call anahat.submitOpeningSummary(), which does not
    // exist anywhere in the stack (not in the frontend client, not as a
    // Node route, not in the AI engine) — that is why the flow silently
    // stopped here. The opening summary is just a patient response with no
    // linked question/quadrant, so it goes through the exact same, already
    // working submitResponse pathway every other answer in this file uses
    // (Node -> POST /api/anahat/assessments/:id/responses -> engine POST
    // /assessment/sessions/:id/responses), unchanged.
    let r;
    try {
      r = await anahat.submitResponse(doc.id, { text: summary, questionId: null, question: null, quadrant: null, requestId: uid() });
    } catch (e) {
      if (['ENGINE_NOT_CONFIGURED', 'ENGINE_ERROR'].includes(e.code) || /not reachable|not fully configured/i.test(e.message)) {
        r = await anahat.recordOffline(doc.id, { text: summary, questionId: null, question: null, quadrant: null, requestId: uid() });
        nadika('Recorded. The AI engine is not available right now, so this answer was saved without analysis — it stays in the transcript.');
      } else throw e;
    }

    const d = r.assessment;

    setDoc(d);

    me(`Opening summary:\n${summary}`);

    setOpeningSummary('');
    setOpeningQuestions([]);

    if (r.status === 'SAFETY_ESCALATION') {
      setPhase('safety');
      nadika('Safety flag. What the patient said matched an immediate-risk signal. Please follow the Anahat safety protocol now; I will not analyse this further. Tell me when you have done so.', { type: 'safety', safety: r.safety });
      return;
    }

    if (r.status && r.status !== 'RECORDED_WITHOUT_ENGINE') {
      const concepts = (r.extraction?.concepts || []).map((c) => c.concept).filter(Boolean);
      if ((r.candidates || []).length) {
        // Same pattern as a normal answer: let the therapist confirm/reject
        // candidates first. finishReview() already falls through to
        // suggestQuadrants() once opening is done and scope is still empty.
        setLastResponse(r);
        nadika(`I heard: ${concepts.join(', ')}. These indicators may apply — confirm the ones that fit, reject the rest.`, { type: 'candidates', responseId: r.response_id, items: r.candidates });
        setPhase('review');
        return;
      }
      if (r.status === 'NO_VALID_INDICATOR') nadika(`I understood: ${concepts.join(', ') || 'no clear concept'}. No canonical indicator matched — that is expected for warm-up questions.`);
      else nadika(`Understood: ${concepts.join(', ') || 'noted'}.`);
    }

    /*
     * The opening conversation is now complete.
     * Only after the single combined response has been analysed
     * do we ask Nadika to suggest assessment areas.
     */
    await suggestQuadrants(d);
  }
);

  // Put the next unasked question on screen (or move the flow on).
  // 2–3 focused questions per quadrant, taken from the KB question bank the
  // engine returned for that quadrant (never generated).
  const FOCUSED = 3;
  const quadrantQs = (d, q, all = false) => (d.quadrantQuestions?.[q] || []).slice(0, all ? undefined : FOCUSED).map((x) => ({ id: x.id, text: x.question, quadrant: q, hint: x.attribute }));

  const askNext = (d, list) => {
    const asked = new Set(d.askedQuestionIds || []);
    const unaskedList = list.filter((q) => !asked.has(q.id));
    if (!unaskedList.length) {
      if (!d.scope?.length) { suggestQuadrants(d); return; }
      afterQuadrant(d);
      return;
    }
    setCurrent(null);
    setPhase('question');
    nadika(null, { type: 'suggested', items: unaskedList, quadrant: unaskedList[0].quadrant });
  };

  // Exactly three actions, plus an AI-suggested new quadrant the therapist
  // can accept or decline.
  const afterQuadrant = (d) => run('Reviewing evidence', async () => {
    const cur = d.scope[quadrantCursor];
    const text = (d.transcript || []).slice(-6).map((t) => t.text).join(' ').slice(0, 300);
    const r = await anahat.analyseQuadrants(d.id, text).catch(() => ({ recommended: [] }));
    const suggestion = (r.recommended || []).map((x) => x.quadrant).find((q) => !(d.scope || []).includes(q)) || null;
    setPhase('decision');
    nadika(`That covers ${cur}.${suggestion ? ` From what I heard, ${suggestion} may also be relevant — accept it below if you agree.` : ''}`, { type: 'decision', suggestion });
  });

  const [inlineAnswer, setInlineAnswer] = useState('');
  const selectSuggested = (q) => { setCurrent(q); setInlineAnswer(''); };
  const submitInlineAnswer = () => {
    const text = inlineAnswer.trim();
    if (!text) return;
    setInlineAnswer('');
    submitAnswer(text);
  };

  // Free-form chat with the AI engine — used by the always-on composer for
  // any phase that doesn't have a dedicated structured input (baseline card,
  // opening-set picker, scope picker, decision buttons, etc). This calls the
  // EXACT SAME engine endpoint as a structured answer (submitResponse, with
  // no linked questionId — the same pathway already used for deep-dive
  // follow-ups), so the AI engine/RAG logic is untouched; only how the
  // therapist can reach it changes. The reply is shown as a chat message and
  // the current phase/step is left exactly as it was.
  const chatFreeform = (text) => run('Asking Nadika', async () => {
    me(text);
    const quadrant = current?.quadrant || doc?.scope?.[quadrantCursor] || null;
    let r;
    try {
      r = await anahat.submitResponse(doc.id, { text, questionId: null, question: null, quadrant, requestId: uid() });
    } catch (e) {
      if (['ENGINE_NOT_CONFIGURED', 'ENGINE_ERROR'].includes(e.code) || /not reachable|not fully configured/i.test(e.message)) {
        nadika('The AI engine is not reachable right now, so I can only record this note without analysis.');
        return;
      }
      throw e;
    }
    const d = r.assessment; setDoc(d);
    if (r.status === 'SAFETY_ESCALATION') {
      setPhase('safety');
      nadika('Safety flag. What was said matched an immediate-risk signal. Please follow the Anahat safety protocol now; I will not analyse this further. Tell me when you have done so.', { type: 'safety', safety: r.safety });
      return;
    }
    const concepts = (r.extraction?.concepts || []).map((c) => c.concept).filter(Boolean);
    if ((r.candidates || []).length) {
      setLastResponse(r);
      nadika(`I heard: ${concepts.join(', ')}. These indicators may apply — confirm the ones that fit, reject the rest.`, { type: 'candidates', responseId: r.response_id, items: r.candidates });
    } else if (concepts.length) {
      nadika(`Understood: ${concepts.join(', ')}.`);
    } else {
      nadika('Noted — I did not find a specific indicator in that, but it is saved in the transcript.');
    }
  });

  const submitAnswer = (text) => run('Analysing the response', async () => {
    const q = current;
    me(text);
    let r = null;
    try {
      r = await anahat.submitResponse(doc.id, { text, questionId: q?.id || null, question: q?.text || null, quadrant: q?.quadrant || null, requestId: uid() });
    } catch (e) {
      if (['ENGINE_NOT_CONFIGURED', 'ENGINE_ERROR'].includes(e.code) || /not reachable|not fully configured/i.test(e.message)) {
        r = await anahat.recordOffline(doc.id, { text, questionId: q?.id || null, question: q?.text || null, quadrant: q?.quadrant || null, requestId: uid() });
        nadika('Recorded. The AI engine is not available right now, so this answer was saved without analysis — it stays in the transcript.');
      } else throw e;
    }
    let d = r.assessment;
    if (q?.id) { const asked = await anahat.markAsked(doc.id, q.id).catch(() => d.askedQuestionIds); d = { ...d, askedQuestionIds: asked }; }
    setDoc(d);
    if (r.status === 'SAFETY_ESCALATION') {
      setLastResponse(null); setPhase('safety');
      nadika('Safety flag. What the patient said matched an immediate-risk signal. Please follow the Anahat safety protocol now; I will not analyse this further. Tell me when you have done so.', { type: 'safety', safety: r.safety });
      return;
    }
    if (r.status && r.status !== 'RECORDED_WITHOUT_ENGINE') {
      setLastResponse(r);
      const concepts = (r.extraction?.concepts || []).map((c) => c.concept).filter(Boolean);
      if (r.status === 'NO_VALID_INDICATOR') nadika(`I understood: ${concepts.join(', ') || 'no clear concept'}. No canonical indicator matched — if it matters, ask a clarifying question in your own words; otherwise let\u2019s continue.`);
      else if ((r.candidates || []).length) { nadika(`I heard: ${concepts.join(', ')}. These indicators may apply — confirm the ones that fit, reject the rest.`, { type: 'candidates', responseId: r.response_id, items: r.candidates }); setPhase('review'); return; }
      else nadika(`Understood: ${concepts.join(', ') || 'noted'}.`);
    }
    continueAfter(d);
  });

  const continueAfter = (d) => {
  if (
    phase === 'deep' ||
    (current?.quadrant && current?.deep)
  ) {
    deepDiveNext(d, current.quadrant);
    return;
  }

  if (d.scope?.length && current?.quadrant) {
    askNext(
      d,
      quadrantQs(d, current.quadrant)
    );
    return;
  }

  /*
   * Opening questions are handled as one combined summary.
   * They must never return to askNext().
   */
  if (!d.openingSetId) {
    setPhase('opening');
    return;
  }

  suggestQuadrants(d);
};

  // Deep dive: stay in the quadrant; pick the remaining KB questions ranked by
  // overlap with what the patient has said (acquired evidence). When the bank
  // is exhausted, the therapist asks a follow-up in their own words.
  const deepDiveNext = (d, quadrant) => {
    const asked = new Set(d.askedQuestionIds || []);
    const said = (d.transcript || []).map((t) => String(t.text).toLowerCase()).join(' ');
    const remaining = quadrantQs(d, quadrant, true).filter((q) => !asked.has(q.id))
      .map((q) => ({ q, score: String(q.hint || q.text).toLowerCase().split(/\W+/).filter((w) => w.length > 3 && said.includes(w)).length }))
      .sort((a, b) => b.score - a.score);
    if (remaining.length) {
      const items = remaining.slice(0, 3).map((r) => ({ ...r.q, deep: true }));
      setCurrent(null);
      setPhase('question');
      nadika(null, { type: 'suggested', items, quadrant, deep: true });
      return;
    }
    setCurrent({ id: null, text: null, quadrant, deep: true }); setPhase('deep');
    nadika(`No more bank questions for ${quadrant}. Ask a follow-up in your own words (what changed, how often, impact), type the answer — or say "done".`);
  };

  const decideCandidate = (c, confirmed) => run('Recording evidence', async () => {
    await anahat.confirmCandidate(doc.id, c.candidate_id, { response_id: lastResponse.response_id, confirmed, evidence_status: confirmed ? 'CONFIRMED' : 'NEGATIVE' });
    const d = await anahat.get(doc.id); setDoc(d);
    setChat((ch) => ch.map((m) => (m.card?.type === 'candidates' && m.card.responseId === lastResponse.response_id ? { ...m, card: { ...m.card, items: m.card.items.map((x) => (x.candidate_id === c.candidate_id ? { ...x, decision: confirmed ? 'CONFIRMED' : 'REJECTED' } : x)) } } : m)));
  });
  const finishReview = () => { const d = doc; setLastResponse(null); continueAfter(d); };

  const suggestQuadrants = (d) => run('Suggesting assessment areas', async () => {
    const summary = (d.transcript || []).map((t) => t.text).join(' ');
    const r = await anahat.analyseQuadrants(d.id, summary.slice(0, 300)).catch(() => ({ recommended: [], all: ref?.quadrants || [] }));
    const rec = (r.recommended || []).map((x) => x.quadrant);
    setPickedQ(rec.slice(0, 2));
    setPhase('scope');
    nadika(rec.length ? `Based on the responses so far, I suggest exploring: ${rec.join(', ')}. Select the assessment area(s) to continue — you can add more later.` : 'Select the assessment area(s) to explore next.', { type: 'scope', recommended: rec });
  });

  const applyScope = () => run('Loading questions', async () => {
    const add = pickedQ.filter((q) => !(doc.scope || []).includes(q));
    if (!add.length) throw new Error('Select at least one new area.');
    const r = await anahat.selectQuadrants(doc.id, add); const d = r.assessment; setDoc(d);
    me(`Assessment areas: ${add.join(', ')}`);
    const idx = d.scope.indexOf(add[0]); setQuadrantCursor(idx);
    const qs = quadrantQs(d, add[0]);
    nadika(`${add[0]} — ${qs.length} focused questions from the ANAHAT question bank.`);
    askNext(d, qs);
  });

  const decision = (choice, suggestion) => run('One moment', async () => {
    const d = doc; const cur = d.scope[quadrantCursor];
    if (choice === 'deep') { me(`Deep dive in ${cur}`); deepDiveNext(d, cur); return; }
    if (choice === 'next') {
      me('Move to next selected quadrant');
      const nextIdx = d.scope.findIndex((q, i) => i > quadrantCursor && quadrantQs(d, q).some((x) => !(d.askedQuestionIds || []).includes(x.id)));
      if (nextIdx < 0) { nadika('All selected quadrants are covered. Deep dive, accept a suggested quadrant, or end the assessment.', { type: 'decision', noNext: true, suggestion }); return; }
      setQuadrantCursor(nextIdx);
      nadika(`${d.scope[nextIdx]} — ${quadrantQs(d, d.scope[nextIdx]).length} focused questions.`);
      askNext(d, quadrantQs(d, d.scope[nextIdx])); return;
    }
    if (choice === 'accept' && suggestion) {
      me(`Add ${suggestion}`);
      const r = await anahat.selectQuadrants(d.id, [suggestion]); const nd = r.assessment; setDoc(nd);
      const idx = nd.scope.indexOf(suggestion); setQuadrantCursor(idx);
      nadika(`${suggestion} — ${quadrantQs(nd, suggestion).length} focused questions.`);
      askNext(nd, quadrantQs(nd, suggestion)); return;
    }
    if (choice === 'reject') { me('Not now'); nadika('Okay — choose one of the actions.', { type: 'decision' }); return; }
    if (choice === 'end') { me('End assessment'); await endAssessment(); }
  });

  const endAssessment = async (skipSufficiency = false) => {
    setPhase('ended');
    const d = doc;
    if (!(d.evidence || []).length) {
      nadika('There is no confirmed evidence from the AI engine in this assessment, so I cannot score chakras or suggest raags — the engine only scores confirmed indicators. You can still write the report from your notes.', { type: 'results', chakra: [], ragas: [], activities: [], empty: true });
      setResults({ chakra: [], ragas: [], activities: [] }); return;
    }
    try {
      await anahat.score(d.id);
      if (!skipSufficiency) {
        const suff = await anahat.decide(d.id, false);
        if (suff.action && /deep|insufficient|continue/i.test(suff.action)) {
          setPhase('sufficiency');
          nadika(`Sufficiency check: ${suff.reason || 'the engine would like more evidence'}${suff.unresolved_chakras?.length ? ` (unresolved: ${suff.unresolved_chakras.join(', ')})` : ''}. Continue the assessment, or stop and score what we have?`, { type: 'sufficiency' });
          return;
        }
      }
      await anahat.decide(d.id, true);
      const rec = await anahat.recommendations(d.id);
      const chakra = (rec.chakra_report?.results || []).filter((r) => r.status);
      const ragas = rec.raga?.candidates || [];
      const activities = rec.activities || [];
      setResults({ chakra, ragas, activities });
      const imb = chakra.filter((r) => /IMBALANCED/i.test(r.status));
      nadika(imb.length ? `Assessment complete. ${imb.length} chakra${imb.length === 1 ? '' : 's'} show${imb.length === 1 ? 's' : ''} an imbalance. These findings and raag suggestions are for you only.` : 'Assessment complete. No chakra passed the imbalance gate from the confirmed evidence.', { type: 'results', chakra, ragas, activities });
    } catch (e) { setError(e.message); }
  };

  const sufficiency = (choice) => run('One moment', async () => {
    if (choice === 'continue') { me('Continue the assessment'); setPhase('decision'); nadika('Choose where to continue.', { type: 'decision' }); return; }
    me('Stop and score'); await endAssessment(true);
  });

  const draftRx = () => run('Drafting prescription', async () => {
    const p = await anahat.draftPrescription(doc.id);
    const d = await anahat.get(doc.id); setDoc(d);
    setRx({ ragas: p.raga_candidates || [], activities: p.activities || [], note: '' });
    nadika('Prescription draft. Untick anything you do not want prescribed, add a note, then approve.', { type: 'prescription', draft: p });
    setPhase('prescription');
  });
  const approveRx = () => run('Approving', async () => {
    const d = doc.prescriptionDraft ? doc : await anahat.get(doc.id);
    const draft = d.prescriptionDraft || {};
    const edited = rx.ragas.length !== (draft.raga_candidates || []).length || rx.activities.length !== (draft.activities || []).length;
    await anahat.reviewPrescription(d.id, { decision: edited ? 'EDIT' : 'APPROVE', note: rx.note, edits: edited ? { raga_candidates: rx.ragas, activities: rx.activities } : {} });
    const fin = await anahat.finalize(d.id); setDoc(fin.assessment);
    me('Approved');
    nadika('Prescription approved and saved. The report is in the patient\u2019s Reports, the activities in their Daily Activities, and they have been notified.', { type: 'final', report: fin.assessment.finalReport, prescriptionId: fin.assessment.prescriptionId });
    setPhase('done');
  });
  const rejectRx = () => run('Recording', async () => { await anahat.reviewPrescription(doc.id, { decision: 'REJECT', note: rx?.note || '' }); me('Rejected'); nadika('Prescription rejected. You can still write the report from your own notes.', { type: 'results', chakra: results?.chakra || [], ragas: [], activities: [], rejected: true }); setPhase('ended'); });

  const goReport = () => navigate(`/therapist/report/${patientId}?assessment=${doc.id}${appointmentId ? `&appointment=${appointmentId}` : ''}`);
  const endSession = () => run('Closing session', async () => {
    if (appointmentId) await updateAppointmentStatus(appointmentId, { status: 'completed' }).catch(() => {});
    nadika('Session marked as attended. You can generate the report now or later from the patient record.');
    setPhase('done');
  });

  const onSend = () => {
    const text = input.trim(); if (!text || busy) return; setInput('');
    if (phase === 'context') return submitContext(text);
    if (phase === 'deep') {
      if (/^done\.?$/i.test(text)) { me('done'); afterQuadrant(doc); return; }
      return submitAnswer(text);
    }
    if (phase === 'question' && current) return submitAnswer(text);
    if (phase === 'safety') {
      me(text);
      nadika('Thank you. Continue only if it is safe to do so. I will now suggest assessment areas.', { type: 'decision' });
      if (doc?.scope?.length) afterQuadrant(doc);
      else suggestQuadrants(doc);
      return;
    }
    if (phase === 'review') { finishReview(); return submitAnswer(text); }
    // No structured input applies right now (no question actively selected,
    // or an administrative step like baseline/opening/scope/decision/
    // sufficiency/prescription) — this is a free chat with the AI engine.
    chatFreeform(text);
  };

  const asked = new Set(doc?.askedQuestionIds || []);
  const placeholder = {
    context: 'Write your context in the card above, or ask Nadika something…',
    question: current ? 'Type the patient\u2019s answer to Nadika.ai…' : 'Pick a suggested question above, or ask Nadika anything…',
    deep: 'Type the patient\u2019s answer, "done", or ask Nadika anything…',
    review: 'Confirm/reject the indicators above, or type the next answer…',
    safety: 'Describe the action you took…',
    ended: 'Ask Nadika anything, or use the options above…',
    done: 'Session closed',
    loading: 'Opening…',
  }[phase] || 'Ask Nadika anything, or use the options above…';
  const inputDisabled = !!busy || ['done', 'loading', 'error'].includes(phase);

  return (
    <PageShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
          <button onClick={() => navigate('/therapist')} className="hover:text-slate-800">← Sessions</button><span>›</span><span className="text-slate-800 font-semibold">Offline session · {patientName}</span>
          <span className={`ml-auto px-2.5 py-1 rounded-full text-[11px] font-bold ${engineUp ? 'bg-emerald-50 text-emerald-700' : engineUp === false ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>AI engine {engineUp ? 'online' : engineUp === false ? 'offline — answers are recorded without analysis' : '…'}</span>
          {!['ended', 'prescription', 'done', 'loading', 'error'].includes(phase) && (
            <button
              onClick={() => { if (window.confirm('End the assessment now and move to scoring? This closes the question flow.')) endAssessment(); }}
              disabled={!!busy}
              className="px-3 py-1 rounded-full text-[11px] font-bold border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              End Session
            </button>
          )}
        </div>

        <div className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 140px)', minHeight: 560 }}>
          {/* Header */}
          <div className="px-6 py-4 flex items-center justify-between text-white shrink-0" style={{ background: 'linear-gradient(90deg, #0d5239 0%, #1f6b52 100%)' }}>
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center"><Sparkle className="w-5 h-5" /></span>
              <div><p className="font-bold leading-tight">Nadika.ai</p><p className="text-xs text-white/70">Your AI therapy assistant · ANAHAT assessment</p></div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {doc && <span className="text-white/70 hidden sm:inline">{(doc.askedQuestionIds || []).length} answered · {(doc.scope || []).length} areas · {(doc.evidence || []).length} evidence</span>}
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-300" />Online</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-5">
            {chat.map((m) => (
              <Message key={m.id} m={m} user={user}>
                {m.card && <CardView card={m.card} asked={asked} phase={phase} current={current} doc={doc} reference={ref} baseline={baseline} setBaseline={setBaseline} submitBaseline={submitBaseline} contextText={contextText} setContextText={setContextText} submitContext={submitContext} openingSummary={openingSummary} setOpeningSummary={setOpeningSummary} submitOpeningSummary={submitOpeningSummary} pickedQ={pickedQ} setPickedQ={setPickedQ} applyScope={applyScope} decision={decision} sufficiency={sufficiency} decideCandidate={decideCandidate} finishReview={finishReview} rx={rx} setRx={setRx} draftRx={draftRx} approveRx={approveRx} rejectRx={rejectRx} goReport={goReport} endSession={endSession} busy={busy} selectSuggested={selectSuggested} inlineAnswer={inlineAnswer} setInlineAnswer={setInlineAnswer} submitInlineAnswer={submitInlineAnswer} suggestQuadrants={() => suggestQuadrants(doc)} />}
              </Message>
            ))}
            {busy && <p className="text-xs text-slate-400 pl-14">Nadika.ai · {busy}…</p>}
            {error && <p className="text-xs text-red-600 pl-14">{error}</p>}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="border-t border-black/5 px-4 sm:px-6 py-4 flex items-center gap-3 shrink-0" style={{ background: '#FBFAF6' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSend()}
              disabled={inputDisabled}
              placeholder={placeholder}
              className="flex-1 px-5 py-3 bg-white border border-black/10 rounded-2xl text-sm outline-none focus:border-[#0d5239]/40 disabled:bg-black/[0.02] disabled:text-slate-400"
            />
            <button onClick={onSend} disabled={inputDisabled || !input.trim()} aria-label="Send" className="w-11 h-11 rounded-2xl flex items-center justify-center text-white disabled:opacity-40" style={{ background: TEAL }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function Message({ m, user, children }) {
  const isMe = m.role === 'therapist';
  return (
    <div className={`flex gap-3 ${isMe ? 'justify-end' : ''}`}>
      {!isMe && <span className="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: TEAL }}><Sparkle className="w-4 h-4" /></span>}
      <div className={`max-w-[78%] ${isMe ? 'items-end' : ''} flex flex-col gap-2`}>
        {m.text && <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line" style={{ background: isMe ? TEAL_SOFT : CREAM, color: '#1e293b' }}>{m.text}</div>}
        {children}
        <span className="text-[10px] text-slate-400 px-1">{ts(m.at)}</span>
      </div>
      {isMe && <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-slate-700 shrink-0 bg-slate-200">{initialsOf(user?.name)}</span>}
    </div>
  );
}

function CardView({ card, asked, phase, current, doc, reference, baseline, setBaseline, submitBaseline, contextText, setContextText, submitContext, openingSummary, setOpeningSummary, submitOpeningSummary, pickedQ, setPickedQ, applyScope, decision, sufficiency, decideCandidate, finishReview, rx, setRx, draftRx, approveRx, rejectRx, goReport, endSession, busy, selectSuggested, inlineAnswer, setInlineAnswer, submitInlineAnswer, suggestQuadrants }) {
  const box = 'rounded-2xl border border-black/5 bg-white p-4 shadow-sm';
  // Suggested questions: the AI offers up to 3 candidate questions for this
  // quadrant/deep-dive. The therapist swipes/selects one, asks it aloud, and
  // records the patient's answer inline — then the same three options
  // (deep dive / new quadrant / end session) are always available.
  if (card.type === 'suggested') {
    const items = card.items || [];
    const selected = current && items.some((q) => q.id === current.id && !asked.has(q.id)) ? current : null;
    return (
      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
          <Sparkle className="w-3.5 h-3.5" style={{ color: TEAL }} />
          {card.deep ? `Deep dive · ${card.quadrant} — suggested next questions` : `${card.quadrant} — suggested questions`}
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {items.map((q) => {
            const done = asked.has(q.id);
            const on = selected?.id === q.id;
            return (
              <button
                key={q.id}
                type="button"
                disabled={done || phase !== 'question'}
                onClick={() => selectSuggested(q)}
                className="shrink-0 w-64 text-left rounded-xl border px-3.5 py-3 text-sm disabled:opacity-50 transition-all"
                style={{ borderColor: on ? TEAL : 'rgba(0,0,0,0.08)', background: on ? TEAL_SOFT : '#fff' }}
              >
                {q.hint && <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: TEAL }}>{q.hint}</p>}
                <p className="font-semibold text-slate-800 leading-snug">{q.text}</p>
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="mt-3 pt-3 border-t border-black/5">
            <p className="text-[11px] text-slate-500 mb-1.5">Ask this aloud, then record the patient's answer:</p>
            <textarea
              rows={2}
              value={inlineAnswer}
              onChange={(e) => setInlineAnswer(e.target.value)}
              placeholder="Patient's answer…"
              className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-sm resize-none"
            />
            <button onClick={submitInlineAnswer} disabled={!!busy || !inlineAnswer.trim()} className="mt-2 px-5 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40" style={{ background: TEAL }}>Record answer</button>
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-black/5 flex flex-wrap gap-2">
          <Opt on={phase === 'question'} onClick={() => decision('deep')}>Deep dive into this quadrant</Opt>
          <Opt on={phase === 'question'} onClick={suggestQuadrants}>Move to / add a new quadrant</Opt>
          <Opt on={phase === 'question'} primary onClick={() => decision('end')}>End session</Opt>
        </div>
      </div>
    );
  }
  if (card.type === 'context') {
    const done = !!doc?.therapistContext;
    return (
      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">Therapist context</p>
        {done ? <p className="text-sm text-emerald-700 font-semibold">✓ Saved</p> : (
          <>
            <textarea rows={3} value={contextText} onChange={(e) => setContextText(e.target.value)} placeholder="How the patient presents, what you already know…" className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-sm resize-none" />
            <button onClick={() => submitContext(contextText)} disabled={!!busy || !contextText.trim()} className="mt-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white disabled:opacity-40" style={{ background: TEAL }}>Save</button>
          </>
        )}
      </div>
    );
  }
  if (card.type === 'sufficiency') {
    const on = phase === 'sufficiency';
    return <div className={`${box} flex flex-wrap gap-2`}><Opt on={on} onClick={() => sufficiency('continue')}>Continue assessment</Opt><Opt on={on} primary onClick={() => sufficiency('stop')}>Stop and score</Opt></div>;
  }
  if (card.type === 'prescription') {
    const d = card.draft || {}; const on = phase === 'prescription' && rx;
    const nameR = (r) => r.raga || r.name || r.raga_name || JSON.stringify(r); const nameA = (a) => a.activity || a.name || a.title || a.text || JSON.stringify(a);
    const toggle = (key, it, name) => setRx((x) => ({ ...x, [key]: x[key].some((p) => name(p) === name(it)) ? x[key].filter((p) => name(p) !== name(it)) : [...x[key], it] }));
    return (
      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">Prescription review</p>
        <p className="text-xs font-bold text-slate-700 mb-1">Raags</p>
        {(d.raga_candidates || []).length === 0 ? <p className="text-xs text-slate-500 mb-2">None proposed.</p> : (d.raga_candidates || []).map((r, i) => <label key={i} className="flex items-center gap-2 text-sm py-0.5"><input type="checkbox" disabled={!on} checked={!!rx?.ragas.some((p) => nameR(p) === nameR(r))} onChange={() => toggle('ragas', r, nameR)} className="accent-[#0d5239]" />{nameR(r)}</label>)}
        <p className="text-xs font-bold text-slate-700 mt-2 mb-1">Activities</p>
        {(d.activities || []).length === 0 ? <p className="text-xs text-slate-500 mb-2">None proposed.</p> : (d.activities || []).map((a, i) => <label key={i} className="flex items-center gap-2 text-sm py-0.5"><input type="checkbox" disabled={!on} checked={!!rx?.activities.some((p) => nameA(p) === nameA(a))} onChange={() => toggle('activities', a, nameA)} className="accent-[#0d5239]" />{nameA(a)}</label>)}
        {on && <textarea rows={2} value={rx.note} onChange={(e) => setRx((x) => ({ ...x, note: e.target.value }))} placeholder="Note for the patient (optional)" className="mt-3 w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-sm resize-none" />}
        <div className="flex gap-2 mt-3"><Opt on={on} primary onClick={approveRx}>Approve &amp; finalise</Opt><Opt on={on} onClick={rejectRx}>Reject</Opt></div>
      </div>
    );
  }
  if (card.type === 'final') {
    const rep = card.report || {};
    return (
      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 mb-2">Final report saved</p>
        <p className="text-sm text-slate-700">Scope: {(rep.coverage?.scope || []).join(', ') || '—'} · {rep.coverage?.responses || 0} responses · {rep.coverage?.evidenceUnits || 0} evidence units · Prescription {card.prescriptionId ? `#${String(card.prescriptionId).slice(-6)}` : ''}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={goReport} className="px-5 py-2.5 rounded-xl text-xs font-bold text-white" style={{ background: TEAL }}>Open report (PDF)</button>
          {phase !== 'done' || true ? <button onClick={endSession} disabled={!!busy} className="px-5 py-2.5 rounded-xl text-xs font-bold border" style={{ borderColor: TEAL, color: TEAL }}>Mark session attended</button> : null}
        </div>
      </div>
    );
  }
  if (card.type === 'baseline') {
    const done = !!doc?.baseline;
    return (
      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">Baseline (1 = lowest, 10 = highest)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
          {['stress', 'anxiety', 'mood', 'energy'].map((k) => {
            const current = done ? doc.baseline[k] : baseline[k];
            return (
              <div key={k}>
                <p className="text-xs font-semibold text-slate-600 capitalize mb-1.5">{k}</p>
                <div className="flex gap-1 flex-wrap">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                    const on = current === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        disabled={done}
                        onClick={() => setBaseline((b) => ({ ...b, [k]: n }))}
                        className={`w-7 h-7 rounded-lg text-[11px] font-bold border flex items-center justify-center disabled:opacity-70 ${on ? 'text-white' : 'border-black/10 text-slate-600'}`}
                        style={on ? { background: TEAL, borderColor: TEAL } : undefined}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">{SLEEP.map((s) => { const on = (done ? doc.baseline.sleep_quality : baseline.sleep_quality) === s; return <button key={s} disabled={done} onClick={() => setBaseline((b) => ({ ...b, sleep_quality: s }))} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${on ? 'text-white' : 'border-black/10 text-slate-600'}`} style={on ? { background: TEAL, borderColor: TEAL } : undefined}>Sleep: {s}</button>; })}</div>
        {!done && <button onClick={submitBaseline} disabled={!!busy} className="px-5 py-2.5 rounded-xl text-xs font-bold text-white" style={{ background: TEAL }}>Submit baseline</button>}
        {done && <p className="text-xs text-emerald-700 font-semibold">✓ Baseline recorded</p>}
      </div>
    );
  }
  if (card.type === 'opening') {
    const questions = card.items || [];
    return (
      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">Opening Questions</p>
        <ol className="space-y-2 list-decimal pl-5 text-sm text-slate-700">
          {questions.map((q, index) => (
            <li key={q.id || index} className="leading-relaxed">{q.text}</li>
          ))}
        </ol>
        <div className="mt-4 pt-3 border-t border-black/5">
          <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">Combined response / session summary</label>
          <textarea
            rows={6}
            value={openingSummary}
            onChange={(e) => setOpeningSummary(e.target.value)}
            placeholder="Discuss all four questions with the patient, then enter one combined summary of the patient’s responses…"
            className="w-full px-3 py-2 bg-black/[0.03] border border-black/10 rounded-xl text-sm resize-none"
          />
          <button onClick={submitOpeningSummary} disabled={!!busy || !openingSummary.trim()} className="mt-3 px-5 py-2.5 rounded-xl text-xs font-bold text-white disabled:opacity-40" style={{ background: TEAL }}>Submit / Analyze</button>
        </div>
      </div>
    );
  }
  if (card.type === 'candidates') {
    return (
      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">Possible indicators</p>
        <div className="space-y-2">
          {card.items.map((c) => { const p = c.payload || {}; return (
            <div key={c.candidate_id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm" style={{ background: '#FBFAF6' }}>
              <span><b>{p.indicator_name || p.name || p.indicator_id}</b> <span className="text-xs text-slate-500">· {(p.chakra || p.chakras || []).toString()} · {Math.round((c.score || 0) * 100)}%</span></span>
              {c.decision ? <span className={`text-[10px] font-bold uppercase ${c.decision === 'CONFIRMED' ? 'text-emerald-700' : 'text-slate-400'}`}>{c.decision}</span> : (
                <span className="flex gap-1.5 shrink-0"><button disabled={!!busy} onClick={() => decideCandidate(c, true)} className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white" style={{ background: TEAL }}>Confirm</button><button disabled={!!busy} onClick={() => decideCandidate(c, false)} className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-black/10 text-slate-600">Reject</button></span>)}
            </div>); })}
        </div>
        {phase === 'review' && card.responseId && <button onClick={finishReview} disabled={!!busy} className="mt-3 px-4 py-2 rounded-xl text-xs font-bold text-white" style={{ background: TEAL }}>Continue to next question</button>}
      </div>
    );
  }
  if (card.type === 'scope') {
    const all = reference?.quadrants || [];
    const inScope = new Set(doc?.scope || []);
    return (
      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2">Select assessment area(s)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {all.map((q) => { const has = inScope.has(q); const on = pickedQ.includes(q); const rec = (card.recommended || []).includes(q); return (
            <label key={q} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer" style={{ borderColor: has ? '#9ED9B4' : on ? TEAL : 'rgba(0,0,0,0.08)', background: has ? '#E6F5EC' : on ? TEAL_SOFT : '#fff' }}>
              <input type="checkbox" disabled={has || phase !== 'scope'} checked={has || on} onChange={() => setPickedQ((p) => (on ? p.filter((x) => x !== q) : [...p, q]))} className="accent-[#0d5239]" />
              <span className={has ? 'text-emerald-800' : 'text-slate-800'}>{q}</span>{rec && !has && <span className="ml-auto text-[10px] font-bold" style={{ color: TEAL }}>suggested</span>}{has && <span className="ml-auto text-[10px] font-bold text-emerald-700">in scope</span>}
            </label>); })}
        </div>
        {phase === 'scope' && <button onClick={applyScope} disabled={!!busy || !pickedQ.some((q) => !inScope.has(q))} className="mt-3 px-5 py-2.5 rounded-xl text-xs font-bold text-white disabled:opacity-40" style={{ background: TEAL }}>Continue with selected area(s)</button>}
      </div>
    );
  }
  if (card.type === 'decision') {
    const active = phase === 'decision';
    return (
      <div className={box}>
        <div className="flex flex-wrap gap-2">
          <Opt on={active && !card.noNext} onClick={() => decision('next')}>Move to next selected quadrant</Opt>
          <Opt on={active} onClick={() => decision('deep')}>Deep dive in this quadrant</Opt>
          <Opt on={active} primary onClick={() => decision('end')}>End assessment</Opt>
        </div>
        {card.suggestion && (
          <div className="mt-3 pt-3 border-t border-black/5 flex items-center justify-between gap-3 flex-wrap text-sm">
            <span><Sparkle className="w-3.5 h-3.5 inline mr-1" style={{ color: TEAL }} />Nadika suggests adding <b>{card.suggestion}</b></span>
            <span className="flex gap-1.5"><Opt on={active} primary onClick={() => decision('accept', card.suggestion)}>Accept</Opt><Opt on={active} onClick={() => decision('reject')}>Not now</Opt></span>
          </div>
        )}
      </div>
    );
  }
  if (card.type === 'safety') {
    return <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-700"><p className="font-bold mb-1">Follow the safety protocol</p><p className="text-xs">Signals: {(card.safety?.matched_signals || []).join(', ') || '—'}. Then describe the action you took in the box below.</p></div>;
  }
  if (card.type === 'results') {
    const imb = (card.chakra || []).filter((r) => /IMBALANCED/i.test(r.status));
    return (
      <div className={box}>
        <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 mb-2">Therapist only · not shown to the patient</p>
        {card.empty ? <p className="text-sm text-slate-600">No engine evidence — nothing to suggest.</p> : (
          <>
            <p className="text-xs font-bold text-slate-700 mb-2">Chakra imbalances</p>
            {imb.length === 0 ? <p className="text-xs text-slate-500 mb-3">None passed the imbalance gate.</p> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                {imb.map((r) => {
                  const severity = Math.round(r.confidence_pct || 0);
                  return (
                    <div key={r.chakra} className="flex items-center gap-3 rounded-xl border border-black/5 px-3 py-2.5" style={{ background: '#FBFAF6' }}>
                      <ChakraIcon name={r.chakra} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-800 truncate">{r.chakra}</p>
                        <p className="text-[11px] text-slate-500 mb-1">{r.status}{r.direction ? ` · ${r.direction}` : ''}</p>
                        <div className="h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, severity)}%`, background: severity >= 70 ? '#DC2626' : severity >= 40 ? '#EA580C' : '#EAB308' }} />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">Severity {severity}%</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs font-bold text-slate-700 mb-1">Raag recommendations</p>
            {(card.ragas || []).length === 0 ? <p className="text-xs text-slate-500 mb-3">No supported chakra → no raag inference.</p> : <div className="flex flex-wrap gap-1.5 mb-3">{card.ragas.map((r, i) => <span key={i} className="px-2.5 py-1 rounded-lg text-xs" style={{ background: CREAM }}>{r.raga || r.name || r.raga_name}{r.chakra ? ` · ${r.chakra}` : ''}</span>)}</div>}
            {(card.activities || []).length > 0 && <><p className="text-xs font-bold text-slate-700 mb-1">Activities</p><div className="flex flex-wrap gap-1.5 mb-3">{card.activities.map((a, i) => <span key={i} className="px-2.5 py-1 rounded-lg text-xs" style={{ background: CREAM }}>{a.activity || a.name || a.title}</span>)}</div></>}
          </>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          {!card.empty && !card.rejected && phase === 'ended' && <button onClick={draftRx} disabled={!!busy} className="px-5 py-2.5 rounded-xl text-xs font-bold text-white" style={{ background: TEAL }}>Review prescription</button>}
          {(card.empty || card.rejected) && <button onClick={goReport} className="px-5 py-2.5 rounded-xl text-xs font-bold text-white" style={{ background: TEAL }}>Write report</button>}
          {phase !== 'done' && <button onClick={endSession} disabled={!!busy} className="px-5 py-2.5 rounded-xl text-xs font-bold border" style={{ borderColor: TEAL, color: TEAL }}>Mark session attended</button>}
        </div>
      </div>
    );
  }
  return null;
}

function Opt({ on, primary, onClick, children }) {
  return <button disabled={!on} onClick={onClick} className={`px-4 py-2 rounded-xl text-xs font-bold border disabled:opacity-40 ${primary ? 'text-white' : 'text-slate-700'}`} style={primary ? { background: TEAL, borderColor: TEAL } : { borderColor: 'rgba(0,0,0,0.1)' }}>{children}</button>;
}

// Traditional chakra colors + petal counts — generic, public-domain facts
// about the 7 chakras (not any specific artist's artwork), used to draw a
// small distinguishing icon per chakra in the results view.
const CHAKRA_INFO = {
  'Root Chakra': { color: '#DC2626', petals: 4 },
  'Sacral Chakra': { color: '#EA580C', petals: 6 },
  'Solar Plexus Chakra': { color: '#EAB308', petals: 10 },
  'Heart Chakra': { color: '#16A34A', petals: 12 },
  'Throat Chakra': { color: '#0284C7', petals: 16 },
  'Third Eye Chakra': { color: '#4F46E5', petals: 2 },
  'Crown Chakra': { color: '#9333EA', petals: 1000 }, // traditionally "1000-petaled" — capped visually below
};

function ChakraIcon({ name, size = 40 }) {
  const info = CHAKRA_INFO[name] || { color: '#94A3B8', petals: 8 };
  const petals = Math.min(info.petals, 16); // cap the visual petal count for legibility
  const cx = 50; const cy = 50; const r = 34;
  const petalEls = Array.from({ length: petals }, (_, i) => {
    const angle = (i / petals) * Math.PI * 2;
    const px = cx + Math.cos(angle) * r; const py = cy + Math.sin(angle) * r;
    return <circle key={i} cx={px} cy={py} r={5.5} fill={info.color} opacity={0.55} />;
  });
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label={name}>
      {petalEls}
      <circle cx={cx} cy={cy} r={20} fill="white" stroke={info.color} strokeWidth={2.5} />
      <circle cx={cx} cy={cy} r={8} fill={info.color} />
    </svg>
  );
}

function Sparkle(props) { return (<svg {...props} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14zM5 15l.7 2 2 .7-2 .7L5 20.5l-.7-2.1-2-.7 2-.7L5 15z" /></svg>); }
