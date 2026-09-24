import { useState } from 'react';
import AppointmentCard from '../../../../components/admin/AppointmentCard';
import { EmptyState } from '../../../../components/ui/Kit';

const FILTERS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

// Operational monitoring + intervention over the same real Postgres
// appointments table the therapist Appointments tab and patient booking
// flow already write to. Admin can step in and cancel a stuck booking
// (updateAppointmentStatus) if needed.
export default function AppointmentsTab({ appointments, onUpdate }) {
  const [filter, setFilter] = useState('upcoming');

  const upcoming = appointments.filter((a) => a.status === 'confirmed');
  const completed = appointments.filter((a) => a.status === 'completed');
  const cancelled = appointments.filter((a) => a.status === 'cancelled');
  const list = { upcoming, completed, cancelled }[filter];

  return (
    <div className="pt-8 space-y-6">
      <div>
        <h1 className="font-serif font-bold text-2xl text-slate-900">Appointments</h1>
        <p className="text-slate-500 text-sm mt-1">Monitor bookings across every therapist and patient.</p>
      </div>

      <div className="flex gap-1 bg-black/[0.04] rounded-2xl p-1 w-fit">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${filter === f.key ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-3xl border border-black/5 p-6">
        {list.length === 0 ? (
          <EmptyState title={`No ${filter} appointments`} subtitle="Bookings will show up here as patients and therapists schedule." />
        ) : (
          <div>
            {list.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0"><AppointmentCard appointment={a} /></div>
                {a.status === 'confirmed' && (
                  <button onClick={() => onUpdate(a.id, { status: 'cancelled' })} className="text-xs font-bold text-red-500 shrink-0">Cancel</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
