import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePatientSession } from '../../hooks/usePatientSession';
import PatientDashboardLayout from '../../components/layout/PatientDashboardLayout';
import { PortalLoading, PortalError } from '../../components/layout/PortalStatus';
import {
  Card, PrimaryButton, EmptyState, CardSkeleton, SelectField, TextAreaField,
  TEAL, TEAL_DARK, TEAL_LIGHT, LIME, CREAM, initials,
} from '../../components/ui/PatientKit';
import {
  getTherapists, getFreeSlots, bookRealAppointment, payForAppointment,
} from '../../services/api';
import { CONCERN_OPTIONS } from '../../constants/options';
import { formatISTDate, formatISTTime, formatISTTimeShort } from '../../utils/time';

// Platform-wide service fee applied on top of whatever the therapist sets as
// their own session fee — a business policy constant, not per-therapist
// data (the therapist's own fee is read live from their profile).
const PLATFORM_FEE = 49;
const SLOT_LOOKAHEAD_DAYS = 14;

const STEPS = [
  { key: 'therapist', label: 'Select Therapist' },
  { key: 'datetime', label: 'Select Date & Time' },
  { key: 'details', label: 'Appointment Details' },
  { key: 'payment', label: 'Payment' },
];

const MODES = [
  { key: 'online', label: 'Online (video/audio)' },
  { key: 'offline', label: 'In-person (offline)' },
];

const PAYMENT_METHODS = [
  { key: 'upi', label: 'UPI', sub: 'Pay using any UPI app' },
  { key: 'card', label: 'Credit / Debit Card', sub: 'Visa, MasterCard, Rupay' },
  { key: 'netbanking', label: 'Net Banking', sub: 'All major banks supported' },
  { key: 'wallet', label: 'Wallets', sub: 'Paytm, PhonePe, Amazon Pay' },
];

const UPI_APPS = ['Google Pay', 'PhonePe', 'Paytm', 'BHIM'];

// Loose sanity check for the Google Meet/Zoom link the patient pastes in —
// not full URL validation, just enough to catch an empty or clearly-wrong
// value before booking.
function isLikelyUrl(value) {
  const v = (value || '').trim();
  if (!v) return false;
  try { const u = new URL(v.startsWith('http') ? v : `https://${v}`); return !!u.hostname.includes('.'); } catch { return false; }
}

// This is the ONLY place therapists are shown to a patient — reached from
// the dashboard's "Book a Session" action, never during registration or
// onboarding. The patient picks a therapist and a real open slot directly;
// there is no assignment step anywhere in this flow.
export default function BookSession() {
  const { user, loading, error, reload, logout } = usePatientSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState(() => searchParams.get('therapistId') ? 1 : 0);
  const [therapists, setTherapists] = useState(null);
  const [locationFilter, setLocationFilter] = useState('');
  const [selectedTherapistId, setSelectedTherapistId] = useState(() => searchParams.get('therapistId'));
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [occurrences, setOccurrences] = useState([]);
  const [selectedOccurrence, setSelectedOccurrence] = useState(null);
  const [mode, setMode] = useState('online');
  const [meetLink, setMeetLink] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [upiId, setUpiId] = useState('');
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    getTherapists()
      // GET /api/therapists already only returns approved + profile-complete
      // therapists (see backend controllers/therapistController.js) — no
      // client-side filter needed here. (An earlier version of this file
      // re-filtered on t.isApproved, a field the public directory endpoint
      // deliberately doesn't return, which silently hid every therapist.)
      .then((list) => setTherapists(list))
      .catch((err) => console.error('Failed to load therapists:', err));
  }, [user?.id]);

  const selectedTherapist = therapists?.find((t) => t.id === selectedTherapistId) || null;

  // Real, live free-slot computation for the chosen therapist over the next
  // two weeks — considers recurring weekly availability, blocked dates, and
  // already-booked slots (see backend services/bookingService.js#freeSlotsOn).
  // Prevents double-booking because the same check re-runs server-side at
  // the moment of booking.
  useEffect(() => {
    if (!selectedTherapistId) { setOccurrences([]); return; }
    setSlotsLoading(true);
    setSelectedOccurrence(null);
    const today = new Date();
    const dateStrs = Array.from({ length: SLOT_LOOKAHEAD_DAYS }, (_, i) => {
      const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
      return d.toISOString().slice(0, 10);
    });
    Promise.all(dateStrs.map((dateStr) => getFreeSlots(selectedTherapistId, dateStr).then((slots) => (slots || []).map((s) => ({ dateStr, ...s }))).catch(() => [])))
      .then((results) => {
        const flat = results.flat().map((s) => ({
          dateStr: s.dateStr,
          startTime: s.startTime,
          endTime: s.endTime,
          date: new Date(`${s.dateStr}T${s.startTime}:00+05:30`),
        })).sort((a, b) => a.date - b.date);
        setOccurrences(flat);
      })
      .finally(() => setSlotsLoading(false));
  }, [selectedTherapistId]);

  if (loading) return <PortalLoading />;
  if (error) return <PortalError message={error} onRetry={reload} onLogout={logout} />;

  const locations = therapists ? [...new Set(therapists.map((t) => t.location).filter(Boolean))].sort() : [];
  const visibleTherapists = therapists
    ? (locationFilter ? therapists.filter((t) => t.location === locationFilter) : therapists)
    : [];

  const goTo = (i) => setStep(Math.max(0, Math.min(STEPS.length - 1, i)));

  // Clicking a therapist card opens their full profile (with live slots);
  // the patient confirms from there before moving to date & time.
  const chooseTherapist = (id) => {
    setSelectedTherapistId(id);
    setDetailOpen(true);
  };

  const canContinueFromStep = [
    !!selectedTherapistId,
    !!selectedOccurrence,
    !!reason && (mode !== 'online' || isLikelyUrl(meetLink)),
    false,
  ];

  const submitPayment = async () => {
    if (!selectedTherapist || !selectedOccurrence) return;
    setBooking(true);
    setBookingError(null);
    try {
      // Real booking: server re-validates the slot is still free (prevents
      // double-booking even under concurrent requests) and opens a mock
      // payment order.
      const { appointment, payment } = await bookRealAppointment(
        selectedTherapist.id, selectedOccurrence.dateStr, selectedOccurrence.startTime, mode,
        mode === 'online' ? meetLink.trim() : undefined,
      );
      // ---------------------------------------------------------------
      // NOTE for a real payment gateway integration (Razorpay, per the
      // product's UPI-first design): this is where its Checkout SDK would
      // collect payment client-side and return a signed reference, verified
      // server-side in payForAppointment before the appointment is
      // confirmed. Today the mock gateway accepts any reference.
      // ---------------------------------------------------------------
      await payForAppointment(payment.id, `mock-${Date.now()}`);
      setConfirmed(appointment);
    } catch (err) {
      setBookingError(err.message || 'Payment failed. Please try again.');
    } finally {
      setBooking(false);
    }
  };

  if (confirmed) {
    return (
      <PatientDashboardLayout active="book-session" user={user} onLogout={logout} search={{ placeholder: 'Search therapists by name or specialization', value: query, onChange: setQuery }}>
        <Card className="p-12 text-center max-w-xl mx-auto">
          <div className="w-16 h-16 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: LIME }}>
            <svg className="w-8 h-8" style={{ color: TEAL }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Session booked</h2>
          <p className="text-slate-500 text-sm mb-6">
            Your session with {selectedTherapist?.name} is confirmed for{' '}
            {formatISTDate(selectedOccurrence.date)} at {formatISTTime(selectedOccurrence.date)}.
          </p>
          <PrimaryButton onClick={() => navigate('/dashboard/appointments')} className="mx-auto">View Appointments</PrimaryButton>
        </Card>
      </PatientDashboardLayout>
    );
  }

  return (
    <PatientDashboardLayout active="book-session" user={user} onLogout={logout} search={{ placeholder: 'Search therapists by name or specialization', value: query, onChange: setQuery }}>
      <div className="flex items-center gap-3 mb-1">
        {step > 0 && (
          <button onClick={() => goTo(step - 1)} aria-label="Back" className="text-slate-400 hover:text-slate-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
        <h1 className="text-2xl font-bold text-slate-900">Book an Appointment</h1>
      </div>
      <p className="text-slate-500 text-sm mt-1 mb-6">
        {step === 0 ? "Book a session with the right therapist for you." : "You're almost there! Just a few more steps."}
      </p>

      <Stepper steps={STEPS} current={step} />

      {therapists === null ? (
        <CardSkeleton className="p-8 mt-6" />
      ) : (
        <div className={`mt-8 ${step === 3 ? 'grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start' : ''}`}>
          <div>
            {step === 0 && (
              <TherapistStep therapists={visibleTherapists.filter((t) => { const q = query.trim().toLowerCase(); return !q || [t.name, ...(t.expertise || []), t.profile?.profession].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)); })}
                locations={locations}
                locationFilter={locationFilter}
                onLocationFilter={setLocationFilter}
                selectedId={selectedTherapistId}
                onChoose={chooseTherapist}
              />
            )}
            {step === 1 && selectedTherapist && (
              <DateTimeStep
                loading={slotsLoading}
                occurrences={occurrences}
                selected={selectedOccurrence}
                onSelect={setSelectedOccurrence}
              />
            )}
            {step === 2 && (
              <DetailsStep
                mode={mode} setMode={setMode}
                meetLink={meetLink} setMeetLink={setMeetLink}
                reason={reason} setReason={setReason}
                notes={notes} setNotes={setNotes}
              />
            )}
            {step === 3 && selectedTherapist && selectedOccurrence && (
              <PaymentStep
                paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
                upiId={upiId} setUpiId={setUpiId}
              />
            )}
          </div>

          {step === 3 && selectedTherapist && selectedOccurrence && (
            <AppointmentSummary
              therapist={selectedTherapist}
              occurrence={selectedOccurrence}
              mode={mode}
              reason={reason}
              booking={booking}
              error={bookingError}
              onPay={submitPayment}
            />
          )}

          {detailOpen && selectedTherapist && (
            <TherapistDetail
              therapist={selectedTherapist}
              occurrences={occurrences}
              loading={slotsLoading}
              onClose={() => setDetailOpen(false)}
              onBook={() => { setDetailOpen(false); goTo(1); }}
            />
          )}

          {step < 3 && (
            <div className="flex justify-end mt-8">
              <PrimaryButton disabled={!canContinueFromStep[step]} onClick={() => goTo(step + 1)}>
                Continue
              </PrimaryButton>
            </div>
          )}
        </div>
      )}
    </PatientDashboardLayout>
  );
}

function Stepper({ steps, current }) {
  return (
    <div className="flex items-center">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 shrink-0"
              style={
                i < current
                  ? { background: TEAL, borderColor: TEAL, color: '#fff' }
                  : i === current
                  ? { borderColor: TEAL, color: TEAL, background: '#fff' }
                  : { borderColor: '#E2E8F0', color: '#94A3B8', background: '#fff' }
              }
            >
              {i < current ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              ) : (i + 1)}
            </div>
            <p className={`mt-2 text-[11px] font-bold uppercase tracking-wide text-center ${i === current ? '' : 'text-slate-400'}`} style={i === current ? { color: TEAL } : undefined}>
              {s.label}
            </p>
          </div>
          {i < steps.length - 1 && (
            <div className="flex-1 h-0.5 mx-2 -mt-5" style={{ background: i < current ? TEAL : '#E2E8F0' }} />
          )}
        </div>
      ))}
    </div>
  );
}

function TherapistStep({ therapists, locations, locationFilter, onLocationFilter, selectedId, onChoose }) {
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Choose a Therapist</p>
        {locations.length > 0 && (
          <div className="w-full sm:w-64">
            <SelectField
              value={locationFilter}
              onChange={(e) => onLocationFilter(e.target.value)}
              options={[{ value: '', label: 'All Locations' }, ...locations.map((l) => ({ value: l, label: l }))]}
            />
          </div>
        )}
      </div>

      {therapists.length === 0 ? (
        <Card>
          <EmptyState title="No therapists available yet" subtitle="Check back soon, or try a different location." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {therapists.map((t) => {
            const active = selectedId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onChoose(t.id)}
                className={`text-left p-5 rounded-2xl border-2 transition-all bg-white ${active ? '' : 'border-black/10 hover:border-black/20'}`}
                style={active ? { borderColor: TEAL, background: '#F6FAF8' } : undefined}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-lg font-bold text-white shrink-0" style={{ background: TEAL_LIGHT }}>
                    {t.avatarUrl ? <img src={t.avatarUrl} alt={t.name} className="w-full h-full object-cover" /> : initials(t.name)}
                  </div>
                  {active && (
                    <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: TEAL }}>
                      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </div>
                <p className="font-bold text-slate-900 text-base">{t.name}</p>
                {t.profile?.profession && <p className="text-xs text-slate-500 mt-0.5">{t.profile.profession}</p>}
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                  {t.experienceYears != null && <span className="px-2.5 py-1 rounded-full bg-[#F6F4EC] text-slate-700">{t.experienceYears} yrs experience</span>}
                  {t.fee != null && <span className="px-2.5 py-1 rounded-full text-white" style={{ background: TEAL }}>₹{t.fee} / session</span>}
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-500">
                  {t.expertise?.length > 0 && <p className="truncate">{t.expertise.join(', ')}</p>}
                  {t.location && (
                    <p className="flex items-center gap-1">
                      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      {t.location}
                    </p>
                  )}
                </div>
                <p className="mt-4 text-xs font-bold" style={{ color: TEAL }}>View profile &amp; available slots →</p>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// Full therapist profile + upcoming free slots, opened from a card.
function TherapistDetail({ therapist: t, occurrences, loading, onClose, onBook }) {
  const byDay = occurrences.reduce((acc, o) => {
    (acc[o.dateStr] = acc[o.dateStr] || []).push(o);
    return acc;
  }, {});
  const days = Object.keys(byDay).slice(0, 7);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 md:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-2xl font-bold text-white shrink-0" style={{ background: TEAL_LIGHT }}>
                {t.avatarUrl ? <img src={t.avatarUrl} alt={t.name} className="w-full h-full object-cover" /> : initials(t.name)}
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">{t.name}</h2>
                {t.profile?.profession && <p className="text-sm text-slate-500">{t.profile.profession}</p>}
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                  {t.experienceYears != null && <span className="px-2.5 py-1 rounded-full bg-[#F6F4EC] text-slate-700">{t.experienceYears} yrs experience</span>}
                  {t.fee != null && <span className="px-2.5 py-1 rounded-full text-white" style={{ background: TEAL }}>₹{t.fee} / session</span>}
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:bg-black/5">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 text-sm">
            {t.expertise?.length > 0 && (
              <div className="sm:col-span-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Specialization</p>
                <div className="flex flex-wrap gap-2">{t.expertise.map((x) => <span key={x} className="px-2.5 py-1 rounded-full bg-[#F6F4EC] text-xs font-semibold text-slate-700">{x}</span>)}</div>
              </div>
            )}
            {t.profile?.experience && <div><p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Qualification</p><p className="text-slate-800">{t.profile.experience}</p></div>}
            {t.location && <div><p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Address</p><p className="text-slate-800">{t.location}</p></div>}
            {t.bio && <div className="sm:col-span-2"><p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">About</p><p className="text-slate-700 leading-relaxed">{t.bio}</p></div>}
          </div>

          <div className="mt-7">
            <p className="font-bold text-slate-900 mb-3">Available slots (next 14 days)</p>
            {loading ? (
              <p className="text-sm text-slate-400">Checking availability…</p>
            ) : days.length === 0 ? (
              <p className="text-sm text-slate-400">No open slots in the next two weeks.</p>
            ) : (
              <div className="space-y-3">
                {days.map((d) => (
                  <div key={d} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-slate-600 w-28 shrink-0">{formatISTDate(byDay[d][0].date)}</span>
                    {byDay[d].slice(0, 6).map((o) => (
                      <span key={o.startTime} className="px-2.5 py-1 rounded-lg border border-black/10 text-xs font-semibold text-slate-700">{formatISTTimeShort(o.date)}</span>
                    ))}
                    {byDay[d].length > 6 && <span className="text-xs text-slate-400">+{byDay[d].length - 6} more</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-8 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-5 py-3 rounded-2xl border border-black/10 text-sm font-bold text-slate-700 hover:bg-black/[0.02]">Close</button>
            <PrimaryButton onClick={onBook}>Book with {t.name.split(' ')[0]}</PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function DateTimeStep({ loading, occurrences, selected, onSelect }) {
  const byDate = useMemo(() => {
    const groups = {};
    occurrences.forEach((occ) => {
      const key = formatISTDate(occ.date);
      if (!groups[key]) groups[key] = [];
      groups[key].push(occ);
    });
    return groups;
  }, [occurrences]);

  const dateKeys = Object.keys(byDate);

  if (loading) return <CardSkeleton className="p-8" />;

  if (dateKeys.length === 0) {
    return (
      <Card>
        <EmptyState title="No open slots right now" subtitle="This therapist has no upcoming availability in the next two weeks. Try another therapist." />
      </Card>
    );
  }

  return (
    <Card className="p-6 md:p-8">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Available Times</p>
      <p className="text-xs text-slate-400 mb-5">All times shown in India Standard Time (IST). Already-booked slots aren't shown.</p>
      <div className="space-y-5">
        {dateKeys.map((dateLabel) => (
          <div key={dateLabel}>
            <p className="text-sm font-bold text-slate-700 mb-2">{dateLabel}</p>
            <div className="flex flex-wrap gap-3">
              {byDate[dateLabel].map((occ) => {
                const active = selected?.date.getTime() === occ.date.getTime();
                return (
                  <button
                    key={occ.date.toISOString()}
                    onClick={() => onSelect(occ)}
                    className={`px-5 py-3 rounded-xl text-sm font-bold border transition-all ${active ? 'text-white border-transparent' : 'border-black/10 text-slate-700 hover:bg-[#F6F4EC]'}`}
                    style={active ? { background: TEAL } : { background: CREAM }}
                  >
                    {formatISTTimeShort(occ.date)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function DetailsStep({ mode, setMode, meetLink, setMeetLink, reason, setReason, notes, setNotes }) {
  return (
    <Card className="p-6 md:p-8 space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Meeting Mode</p>
        <div className="flex gap-3">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold border transition-all ${mode === m.key ? 'text-white border-transparent' : 'border-black/10 text-slate-700 hover:bg-[#F6F4EC]'}`}
              style={mode === m.key ? { background: TEAL } : undefined}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'online' && (
        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-slate-500 block mb-2">Meeting link (Google Meet, Zoom, etc.)</label>
          <input
            type="text"
            value={meetLink}
            onChange={(e) => setMeetLink(e.target.value)}
            placeholder="https://meet.google.com/xxx-xxxx-xxx"
            className="w-full px-4 py-3 bg-[#FBFAF6] border border-black/10 rounded-xl text-sm outline-none focus:border-[#0d5239]/40"
          />
          <p className="text-xs text-slate-400 mt-1.5">Create a meeting link and paste it here — your therapist will join you there at your scheduled time. This app doesn't have a built-in call, so this link is how you'll actually talk.</p>
        </div>
      )}

      <SelectField
        label="Reason for this session"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={[{ value: '', label: 'Select a reason…' }, ...CONCERN_OPTIONS.map((c) => ({ value: c, label: c }))]}
      />

      <TextAreaField
        label="Anything you'd like your therapist to know beforehand? (optional)"
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional notes for your therapist"
      />
    </Card>
  );
}

function PaymentStep({ paymentMethod, setPaymentMethod, upiId, setUpiId }) {
  return (
    <Card className="p-6 md:p-8">
      <h2 className="text-lg font-bold text-slate-900">Payment</h2>
      <p className="text-sm text-slate-500 mt-1 mb-6">Pick a method. You'll confirm on the right.</p>

      <div className="divide-y divide-black/5 rounded-2xl border border-black/10 overflow-hidden mb-5">
        {PAYMENT_METHODS.map((m) => {
          const active = paymentMethod === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setPaymentMethod(m.key)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors"
              style={active ? { background: '#F6FAF8' } : undefined}
            >
              <span className="w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center" style={{ borderColor: active ? TEAL : '#CBD5E1' }}>
                {active && <span className="w-2 h-2 rounded-full" style={{ background: TEAL }} />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-slate-900">{m.label}</span>
                <span className="block text-xs text-slate-500 truncate">{m.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      {paymentMethod === 'upi' && (
        <div>
          <label className="text-[11px] uppercase tracking-widest font-bold text-slate-500 block mb-1.5">UPI ID</label>
          <input
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            placeholder="yourname@upi"
            className="w-full px-4 py-3 bg-black/[0.03] border border-black/10 rounded-xl text-sm focus:border-[#0d5239]/40 focus:bg-white outline-none"
          />
          <p className="text-[11px] text-slate-400 mt-2">Works with {UPI_APPS.join(', ')}.</p>
        </div>
      )}

      <p className="flex items-center gap-2 text-xs text-slate-400 mt-6">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        Secure, encrypted checkout
      </p>
    </Card>
  );
}

function AppointmentSummary({ therapist, occurrence, mode, reason, booking, error, onPay }) {
  const total = (therapist.fee || 0) + PLATFORM_FEE;

  return (
    <Card className="p-6 sticky top-6">
      <h3 className="text-sm font-bold text-slate-900 mb-4">Appointment Summary</h3>

      <div className="flex items-center gap-3 mb-5 pb-5 border-b border-black/5">
        <div className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: TEAL_LIGHT }}>
          {therapist.avatarUrl ? <img src={therapist.avatarUrl} alt={therapist.name} className="w-full h-full object-cover" /> : initials(therapist.name)}
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900">{therapist.name}</p>
          {therapist.location && <p className="text-xs text-slate-400">{therapist.location}</p>}
        </div>
      </div>

      <div className="space-y-3 text-sm mb-5 pb-5 border-b border-black/5">
        <SummaryRow label="Date & Time" value={`${formatISTDate(occurrence.date)}, ${formatISTTime(occurrence.date)}`} />
        <SummaryRow label="Session Type" value="Individual Therapy (50 minutes)" />
        <SummaryRow label="Mode" value={MODES.find((m) => m.key === mode)?.label || mode} />
        {reason && <SummaryRow label="Reason" value={reason} />}
      </div>

      <div className="space-y-2 text-sm mb-5">
        <div className="flex justify-between text-slate-500">
          <span>Session Fee</span>
          <span>{therapist.fee != null ? `₹${therapist.fee}` : 'To be confirmed'}</span>
        </div>
        <div className="flex justify-between text-slate-500">
          <span>Platform Fee</span>
          <span>₹{PLATFORM_FEE}</span>
        </div>
        <div className="flex justify-between font-bold text-slate-900 pt-2 border-t border-black/5">
          <span>Total Amount</span>
          <span>₹{total}</span>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 mb-5" style={{ background: '#ECFDF5' }}>
        <svg className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#059669' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <div>
          <p className="text-xs font-bold" style={{ color: '#059669' }}>100% Secure Booking</p>
          <p className="text-[11px] text-slate-500">Your payment is protected with bank-level security.</p>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <PrimaryButton onClick={onPay} disabled={booking} className="w-full justify-center">
        {booking ? 'Processing…' : `Pay Now Securely · ₹${total}`}
      </PrimaryButton>
    </Card>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="font-bold text-slate-900 text-right">{value}</span>
    </div>
  );
}
