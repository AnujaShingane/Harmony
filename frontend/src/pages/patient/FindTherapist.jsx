import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePatientSession } from '../../hooks/usePatientSession';
import PatientDashboardLayout from '../../components/layout/PatientDashboardLayout';
import { PortalError, PortalLoading } from '../../components/layout/PortalStatus';
import { getFreeSlots, getTherapists } from '../../services/api';

const today = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

export default function FindTherapist() {
  const { user, loading, error, reload, logout } = usePatientSession();
  const navigate = useNavigate();
  const [therapists, setTherapists] = useState(null);
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(today);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [availability, setAvailability] = useState({});
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  useEffect(() => {
    getTherapists().then(setTherapists).catch(() => setTherapists([]));
  }, []);

  useEffect(() => {
    if (!availableOnly || !therapists?.length) return undefined;
    let active = true;
    setCheckingAvailability(true);
    Promise.all(therapists.map((therapist) => getFreeSlots(therapist.id, date)
      .then((slots) => [therapist.id, (slots || []).length > 0])
      .catch(() => [therapist.id, false])))
      .then((entries) => { if (active) setAvailability(Object.fromEntries(entries)); })
      .finally(() => { if (active) setCheckingAvailability(false); });
    return () => { active = false; };
  }, [availableOnly, date, therapists]);

  const locations = useMemo(() => [...new Set((therapists || []).map((t) => t.location?.split(',').slice(-2).join(',').trim()).filter(Boolean))].sort(), [therapists]);
  const visible = useMemo(() => (therapists || []).filter((therapist) => {
    const normalizedQuery = query.trim().toLowerCase();
    const textMatches = !normalizedQuery || [therapist.name, therapist.profile?.profession, therapist.bio, ...(therapist.expertise || [])]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedQuery));
    const locationMatches = !location || (therapist.location || '').toLowerCase().includes(location.toLowerCase());
    const availabilityMatches = !availableOnly || availability[therapist.id];
    return textMatches && locationMatches && availabilityMatches;
  }), [availability, availableOnly, location, query, therapists]);

  if (loading) return <PortalLoading />;
  if (error) return <PortalError message={error} onRetry={reload} onLogout={logout} />;

  return (
    <PatientDashboardLayout active="find-therapist" user={user} onLogout={logout}>
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest text-[#d65b38]">Consultation</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Find your therapist</h1>
        <p className="mt-1 text-sm text-slate-500">Browse therapists who have completed their profile and are available to book.</p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-[#eee3dc] bg-white p-4 md:grid-cols-[minmax(220px,1fr)_200px_auto_auto] md:items-end">
        <label className="block text-xs font-semibold text-slate-600">
          Concern or therapist
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sleep, anxiety, music therapy..." className="mt-1.5 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-[#e85d35]" />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Location
          <select value={location} onChange={(event) => setLocation(event.target.value)} className="mt-1.5 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm">
            <option value="">All locations</option>
            {locations.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Available on
          <input type="date" value={date} min={today()} onChange={(event) => setDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} className="h-4 w-4 accent-[#e85d35]" />
          Has open slots
        </label>
      </div>

      {checkingAvailability && <p className="mb-4 text-xs text-slate-500">Checking live appointment availability…</p>}
      {therapists === null ? <p className="py-12 text-center text-sm text-slate-500">Loading therapists…</p> : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#e7d6cb] bg-[#fff8f3] px-6 py-12 text-center">
          <h2 className="font-semibold text-slate-800">No matching therapists</h2>
          <p className="mt-2 text-sm text-slate-500">Try a broader concern, another location, or a different date.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((therapist) => (
            <article key={therapist.id} className="overflow-hidden rounded-lg border border-[#e9e2dd] bg-white">
              <div className="flex gap-4 p-5">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-[#fff3ed]">
                  {therapist.avatarUrl ? <img src={therapist.avatarUrl} alt={therapist.name} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-lg font-bold text-[#d65b38]">{therapist.name?.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span>}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold text-slate-900">{therapist.name}</h2>
                  <p className="mt-1 text-xs text-slate-500">{therapist.profile?.profession || 'Therapist'}</p>
                  {therapist.experienceYears != null && <p className="mt-2 text-xs font-semibold text-slate-700">Experience · {therapist.experienceYears}+ years</p>}
                  {therapist.location && <p className="mt-1 truncate text-xs text-slate-500">{therapist.location}</p>}
                </div>
              </div>
              <div className="px-5 pb-4">
                <p className="min-h-10 text-xs leading-relaxed text-slate-600">{therapist.expertise?.join(', ') || therapist.bio || 'Music therapy and wellbeing support'}</p>
                {therapist.fee != null && <p className="mt-2 text-sm font-semibold text-slate-800">₹{therapist.fee} <span className="text-xs font-normal text-slate-500">per session</span></p>}
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => navigate(`/dashboard/therapists/${therapist.id}`)} className="flex-1 rounded-md border border-[#e85d35] px-3 py-2.5 text-xs font-semibold text-[#d65b38] hover:bg-[#fff5ef]">View profile</button>
                  <button type="button" onClick={() => navigate(`/dashboard/book-session?therapistId=${encodeURIComponent(therapist.id)}`)} className="flex-1 rounded-md bg-[#e85d35] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#d84d2c]">Book appointment</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </PatientDashboardLayout>
  );
}
