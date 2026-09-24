import { useEffect, useMemo, useRef, useState } from 'react';
import { initialsOf } from '../../utils/initials';
import { getConversation, sendConversationMessage, markConversationRead } from '../../services/api';

// WhatsApp-style chat window shared by the patient Messages page and the
// therapist Messages tab. `me` is 'patient' or 'therapist'; the window polls
// the conversation every 1.5s so both sides see new messages as they arrive.
const WA_GREEN = '#128C7E';
const WA_HEADER = '#075E54';
const WA_BUBBLE_OUT = '#DCF8C6';
const WA_BG = '#ECE5DD';

function dayLabel(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function WhatsAppChat({ conversation: initial, me, title, subtitle, avatarUrl, height = '72vh', className = '', highlight = '' }) {
  const [conversation, setConversation] = useState(initial);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef(null);
  const convoId = initial?.id || initial?._id;

  useEffect(() => { setConversation(initial); }, [initial?.id, initial?._id]);

  useEffect(() => {
    if (!convoId) return undefined;
    let cancelled = false;
    const tick = () => {
      getConversation(convoId)
        .then((fresh) => { if (!cancelled && fresh) setConversation(fresh); })
        .catch(() => {});
    };
    tick();
    markConversationRead(convoId, me).catch(() => {});
    const interval = setInterval(tick, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [convoId, me]);

  const count = conversation?.messages?.length || 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (convoId && count) markConversationRead(convoId, me).catch(() => {});
  }, [count, convoId, me]);

  const groups = useMemo(() => {
    const out = [];
    const hq = highlight.trim().toLowerCase();
    const list = (conversation?.messages || []).filter((m) => !hq || m.text.toLowerCase().includes(hq) || (title || '').toLowerCase().includes(hq));
    list.forEach((m) => {
      const label = dayLabel(m.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(m);
      else out.push({ label, items: [m] });
    });
    return out;
  }, [conversation, highlight, title]);

  const send = () => {
    const text = draft.trim();
    if (!text || !convoId) return;
    setDraft('');
    // Optimistic bubble so the sender sees it instantly.
    setConversation((c) => ({ ...c, messages: [...(c?.messages || []), { id: `tmp-${Date.now()}`, from: me, text, at: new Date().toISOString(), read: false }] }));
    sendConversationMessage(convoId, me, text).then(setConversation).catch((err) => console.error('Failed to send message:', err));
  };

  const initial1 = initialsOf(title);

  return (
    <div className={`rounded-3xl overflow-hidden shadow-sm border border-black/5 ${className}`} style={{ height }}>
      <div className="h-full flex flex-col">
        <div className="px-5 py-3 flex items-center gap-3 shrink-0" style={{ background: WA_HEADER }}>
          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center bg-white/15 text-white font-bold shrink-0">
            {avatarUrl ? <img src={avatarUrl} alt={title} className="w-full h-full object-cover" /> : initial1}
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm truncate">{title}</p>
            {subtitle && <p className="text-white/60 text-xs truncate">{subtitle}</p>}
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto px-4 md:px-8 py-5"
          style={{ background: WA_BG, backgroundImage: 'radial-gradient(rgba(0,0,0,0.03) 1px, transparent 1px)', backgroundSize: '16px 16px' }}
        >
          {count === 0 ? (
            <div className="flex justify-center mt-10">
              <span className="text-sm text-slate-500 bg-white/80 px-4 py-2 rounded-full shadow-sm">Say hello to start the conversation</span>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <div className="flex justify-center my-3">
                  <span className="text-[11px] font-semibold text-slate-500 bg-white px-3 py-1 rounded-full shadow-sm">{group.label}</span>
                </div>
                {group.items.map((m, i) => {
                  const mine = m.from === me;
                  return (
                    <div key={m.id || m._id || i} className={`flex mb-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className="max-w-[78%] md:max-w-[62%] px-3 py-2 text-sm shadow-sm relative"
                        style={{ background: mine ? WA_BUBBLE_OUT : '#FFFFFF', borderRadius: mine ? '12px 12px 2px 12px' : '12px 12px 12px 2px' }}
                      >
                        <p className="text-slate-800 pr-12 whitespace-pre-wrap break-words">{m.text}</p>
                        <span className="absolute bottom-1.5 right-2.5 flex items-center gap-1">
                          <span className="text-[10px] text-slate-400">{new Date(m.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                          {mine && (
                            <svg className="w-3.5 h-3.5" viewBox="0 0 16 15" fill="none">
                              <path d="M15.01 3.316l-.478-.372a.365.365 0 00-.51.063L8.666 9.879a.32.32 0 01-.484.033l-.358-.325a.319.319 0 00-.484.032l-.378.483a.418.418 0 00.036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 00-.064-.512zM11.01 3.316l-.478-.372a.365.365 0 00-.51.063L4.666 9.879a.32.32 0 01-.484.033L1.891 7.769a.366.366 0 00-.515.006l-.423.433a.364.364 0 00.006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 00-.064-.512z" fill={m.read ? '#34B7F1' : '#8696A0'} />
                            </svg>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="px-4 py-3 flex items-center gap-2.5 shrink-0" style={{ background: '#F0F0F0' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Type a message"
            className="flex-1 bg-white rounded-full px-5 py-2.5 text-sm outline-none border border-black/5"
          />
          <button
            onClick={send}
            disabled={!draft.trim()}
            className="w-11 h-11 rounded-full flex items-center justify-center text-white disabled:opacity-40 transition-all shrink-0"
            style={{ background: WA_GREEN }}
            aria-label="Send message"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M2.94 2.94a1.5 1.5 0 011.633-.328l12.5 5a1.5 1.5 0 010 2.776l-12.5 5A1.5 1.5 0 012 14.056V11.5a1 1 0 01.883-.993L9 9.5a.5.5 0 000-1l-6.117-1.007A1 1 0 012 6.5V3.944a1.5 1.5 0 01.94-1.004z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
