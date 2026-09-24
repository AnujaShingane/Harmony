import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getSession, sendSessionMessage } from '../../services/api';
import { PageShell, Card, Badge } from '../../components/ui/Kit';

export default function PatientLiveSession() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      getSession(sessionId)
        .then((fresh) => { if (!cancelled) { setSession(fresh); setLoading(false); } })
        .catch((err) => { console.error('Failed to load session:', err); if (!cancelled) setLoading(false); });
    };
    poll();
    const interval = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages?.length]);

  const sendChat = () => {
    if (!chatInput.trim() || !session || session.status !== 'active') return;
    sendSessionMessage(session.id, 'patient', chatInput.trim())
      .then(setSession)
      .catch((err) => console.error('Failed to send message:', err));
    setChatInput('');
  };

  if (!session) {
    if (loading) return <PageShell><div className="min-h-screen" /></PageShell>;
    return (
      <PageShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <Card className="max-w-md w-full text-center">
            <h1 className="text-xl font-serif font-bold mb-2">Session not found</h1>
            <p className="text-slate-600 text-sm mb-6">This session link may have expired.</p>
            <button onClick={() => navigate('/dashboard')} className="btn-sunset px-6 py-3 rounded-2xl font-bold text-sm">Back to Dashboard</button>
          </Card>
        </div>
      </PageShell>
    );
  }

  const ended = session.status !== 'active';

  return (
    <PageShell>
      <div className="max-w-3xl mx-auto px-6 py-10 h-screen flex flex-col">
        <div className="flex items-center justify-between mb-6 shrink-0">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-sunset">Live Session</span>
            <h1 className="text-2xl font-serif font-bold text-slate-900 mt-1">With {session.therapistName}</h1>
          </div>
          <Badge tone={ended ? 'slate' : 'emerald'}>{ended ? 'Ended' : 'Active'}</Badge>
        </div>

        <Card className="!p-0 flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {session.messages.length === 0 ? (
              <p className="text-sm text-slate-400 text-center mt-10">
                {ended ? 'This session has ended. Your therapist will share a report under Reports.' : `You're in. Say hello — ${session.therapistName} can see your messages as you send them.`}
              </p>
            ) : (
              session.messages.map((m) => (
                <div key={m.id} className={`flex ${m.from === 'patient' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.from === 'patient' ? 'bg-slate-900 text-white' : 'bg-black/[0.05] text-slate-800'
                  }`}>
                    {m.text}
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="p-4 border-t border-black/5 flex gap-2 shrink-0">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChat()}
              placeholder={ended ? 'This session has ended' : 'Type a message...'}
              disabled={ended}
              className="flex-1 px-4 py-3 bg-black/[0.03] border border-black/10 rounded-xl text-sm outline-none focus:border-sunset disabled:opacity-50"
            />
            <button onClick={sendChat} disabled={ended} className="btn-sunset px-5 py-3 rounded-xl font-bold text-xs uppercase tracking-widest disabled:opacity-50">Send</button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
