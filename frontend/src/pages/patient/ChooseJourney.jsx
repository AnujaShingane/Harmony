import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { setJourney } from '../../services/api';
import { PageShell, Card } from '../../components/ui/Kit';

const JOURNEYS = [
  {
    key: 'self_therapy',
    title: 'Self Therapy',
    desc: 'AI-guided therapy, independently. The avatar leads you through a complete assessment, then generates your report, chakra analysis, raga and meditation recommendations.',
    route: '/chat',
    icon: (<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />),
  },
  {
    key: 'relaxation',
    title: 'Relaxation Session',
    desc: 'For mild concerns like stress, focus or sleep. A short conversational session — no clinical report, just guided breathing, meditation, and music.',
    route: '/relaxation/intake',
    icon: (<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21C7.5 17.5 3 13.5 3 9a5 5 0 019-3 5 5 0 019 3c0 4.5-4.5 8.5-9 12z" />),
  },
  {
    key: 'professional',
    title: 'Professional Consultation',
    desc: 'The complete clinical workflow: fill in your demographic details, then go straight to your dashboard to book a therapist.',
    route: '/onboarding',
    icon: (<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />),
  },
];

export default function ChooseJourney() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(null);

  const choose = (j) => {
    setJourney(user.id, j.key).catch((err) => console.error('Failed to save journey choice:', err));
    // No auto-assignment — the patient picks their therapist directly when
    // they book a session (see BookSession.jsx).
    navigate(j.route);
  };

  return (
    <PageShell>
      <div className="min-h-screen flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-5xl">
          <div className="text-center mb-12">
            <span className="text-[11px] font-bold uppercase tracking-widest text-sunset">Not an assessment — just a starting point</span>
            <h1 className="text-4xl md:text-5xl font-serif font-bold text-slate-900 mt-2">Choose Your Journey</h1>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {JOURNEYS.map((j) => (
              <Card
                key={j.key}
                className={`text-left cursor-pointer transition-all duration-500 ${hovered === j.key ? 'border-sunset shadow-2xl scale-[1.02]' : ''}`}
              >
                <button
                  onMouseEnter={() => setHovered(j.key)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => choose(j)}
                  className="text-left w-full"
                >
                  <div className="w-14 h-14 rounded-2xl bg-sunset-soft border border-sunset flex items-center justify-center mb-6">
                    <svg className="w-7 h-7 text-sunset" fill="none" viewBox="0 0 24 24" stroke="currentColor">{j.icon}</svg>
                  </div>
                  <h2 className="text-xl font-serif font-bold text-slate-900 mb-2">{j.title}</h2>
                  <p className="text-sm text-slate-600 leading-relaxed">{j.desc}</p>
                  <div className="mt-6 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sunset">
                    Begin <span aria-hidden="true">→</span>
                  </div>
                </button>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
