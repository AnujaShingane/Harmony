import { useEffect, useState } from 'react';
import { initialsOf } from '../../../utils/initials';
import { SAGE_DARK, SAGE, SAGE_SOFT } from '../../../components/layout/TherapistDashboardLayout';
import WhatsAppChat from '../../../components/chat/WhatsAppChat';
import { getConversationsForTherapist, getOrCreateConversation } from '../../../services/api';

// Therapist side of the patient <-> therapist chat: a WhatsApp-style
// contact list on the left (one thread per patient), the conversation on
// the right. Polls the thread list every 4s for unread counts.
export default function MessagesTab({ therapist, patients }) {
  const [threads, setThreads] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState('');

  const refresh = () => {
    getConversationsForTherapist(therapist.id)
      .then((list) => setThreads(list.map((c) => ({ ...c, id: c.id || c._id }))))
      .catch((err) => console.error('Failed to load conversations:', err));
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [therapist.id]);

  // Contacts = every patient of this therapist, merged with existing threads.
  const contacts = patients.map((p) => {
    const thread = threads.find((t) => t.patientId === p.id);
    const msgs = thread?.messages || [];
    const last = msgs[msgs.length - 1];
    const unread = msgs.filter((m) => m.from === 'patient' && !m.read).length;
    return { patient: p, thread, last, unread };
  }).sort((a, b) => new Date(b.last?.at || 0) - new Date(a.last?.at || 0));

  const q = query.trim().toLowerCase();
  const visible = q ? contacts.filter((c) => c.patient.name.toLowerCase().includes(q)) : contacts;
  const active = contacts.find((c) => c.patient.id === openId) || null;

  const open = async (c) => {
    setOpenId(c.patient.id);
    if (!c.thread) {
      const convo = await getOrCreateConversation(c.patient.id, c.patient.name, therapist.id, therapist.name).catch(() => null);
      if (convo) setThreads((ts) => [...ts, { ...convo, id: convo.id || convo._id }]);
    }
  };

  return (
    <div className="pt-8 space-y-6">
      <div className="td-animate-in">
        <h1 className="font-serif font-bold text-2xl text-slate-900">Messages</h1>
        <p className="text-slate-500 text-sm mt-1">Chat with your patients in real time.</p>
      </div>

      <div className="td-surface bg-white rounded-3xl border border-black/5 grid grid-cols-1 md:grid-cols-[300px_1fr] overflow-hidden" style={{ height: '72vh' }}>
        <div className="border-b md:border-b-0 md:border-r border-black/5 flex flex-col min-h-0">
          <div className="p-3 border-b border-black/5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patients"
              className="w-full px-4 py-2 rounded-full bg-[#F6F4EC] text-sm outline-none"
            />
          </div>
          <div className="flex-1 overflow-y-auto thin-scroll">
            {visible.length === 0 ? (
              <p className="text-sm text-slate-400 text-center px-4 py-10">{patients.length === 0 ? 'Patients appear here once they book a session with you.' : 'No patient matches that search.'}</p>
            ) : visible.map((c) => (
              <button
                key={c.patient.id}
                onClick={() => open(c)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left border-b border-black/[0.03] transition-colors ${openId === c.patient.id ? '' : 'hover:bg-black/[0.02]'}`}
                style={openId === c.patient.id ? { background: SAGE_SOFT } : undefined}
              >
                <div className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: SAGE }}>
                  {c.patient.avatarUrl ? <img src={c.patient.avatarUrl} alt={c.patient.name} className="w-full h-full object-cover" /> : initialsOf(c.patient.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-sm text-slate-800 truncate">{c.patient.name}</p>
                    {c.last && <span className="text-[10px] text-slate-400 shrink-0">{new Date(c.last.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500 truncate mt-0.5">{c.last ? `${c.last.from === 'therapist' ? 'You: ' : ''}${c.last.text}` : 'Tap to start chatting'}</p>
                    {c.unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center shrink-0" style={{ background: '#25D366' }}>{c.unread}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0">
          {!active || !active.thread ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6" style={{ background: '#F7F5EF' }}>
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: SAGE_SOFT, color: SAGE_DARK }}>
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-6l-4 4v-4z" /></svg>
              </div>
              <p className="font-bold text-slate-800">{active ? 'Opening chat…' : 'Select a patient to start chatting'}</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">Messages are delivered instantly and kept for the whole course of therapy.</p>
            </div>
          ) : (
            <WhatsAppChat
              conversation={active.thread}
              me="therapist"
              title={active.patient.name}
              subtitle={`Patient ${active.patient.patientId}`}
              avatarUrl={active.patient.avatarUrl}
              height="100%"
              className="!rounded-none !border-0 !shadow-none"
            />
          )}
        </div>
      </div>
    </div>
  );
}
