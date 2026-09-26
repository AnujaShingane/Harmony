import { Link, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import PublicNav from '../../components/public/PublicNav';
import PublicFooter from '../../components/public/PublicFooter';
import { useRaagPlayer } from '../../hooks/useRaagPlayer';

const FAQS = [
  { question: 'What happens in the demo?', answer: 'You can explore a guided conversation with Anahat’s AI wellness assistant and see how music-based support can fit into a personal wellness journey.' },
  { question: 'Do I need an account to try it?', answer: 'The interactive session is available after signing in. Create an account to save your progress and continue later.' },
  { question: 'Is the demo a medical diagnosis?', answer: 'No. The demo is for general wellness exploration and does not replace care from a qualified health professional.' },
  { question: 'Can I speak with a therapist?', answer: 'Yes. Anahat offers therapist-led consultations, subject to therapist availability and appointment booking.' },
  { question: 'What if I only want a relaxation practice?', answer: 'Explore the Relaxation section for music-led practices tailored to common goals such as sleep, focus, and stress relief.' },
];

const PRACTICE_PREVIEWS = {
  frustration: { title: 'Release Frustration', focus: 'Emotional reset', description: 'Let a slow, steady listening practice soften tension and make room for a calmer response.', hue: 25 },
  emotions: { title: 'Balance Your Emotions', focus: 'Emotional balance', description: 'A gentle listening practice to settle emotional intensity and return to a steadier rhythm.', hue: 195 },
  mood: { title: 'Lift Your Mood', focus: 'Mood support', description: 'Take a mindful pause with warm, measured tones designed to make space for a lighter moment.', hue: 150 },
  anxiety: { title: 'Ease Anxiety', focus: 'Calm and grounding', description: 'Follow an unhurried listening practice and bring attention back to the present moment.', hue: 190 },
  sleep: { title: 'Invite Sleep', focus: 'Rest and relaxation', description: 'A quiet evening practice to help the body settle and prepare for rest.', hue: 240 },
  focus: { title: 'Return to Focus', focus: 'Mindful attention', description: 'Use a steady tonal bed to pause distractions and bring your attention gently back.', hue: 210 },
};

export default function DemoPage() {
  const [searchParams] = useSearchParams();
  const requestedPractice = searchParams.get('practice');
  const preview = PRACTICE_PREVIEWS[requestedPractice?.toLowerCase()] || {
    title: 'Swaravkash', focus: 'Mindfulness', description: 'An open, spacious programme built for present-moment awareness practice.', hue: 195,
  };
  const player = useRaagPlayer([{ name: preview.title, length: '20:00', hue: preview.hue }]);

  useEffect(() => {
    player.select(0);
  }, []);

  return (
    <div className="min-h-screen bg-[#fffdfa] text-[#303b42]">
      <PublicNav />
      <main className="pt-20">
        <section className="bg-white">
          <div className="max-w-6xl mx-auto px-6 py-12 md:py-16">
            <p className="text-xs font-bold uppercase text-[#d65b38]">Demo</p>
            <h1 className="mt-3 font-display text-3xl sm:text-4xl font-bold text-[#303b42]">Try Anahat, free</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#727c82]">One full experience, on us. No payment required. Start with a music-led {preview.focus.toLowerCase()} practice.</p>
            {requestedPractice && <p className="mt-2 text-xs text-[#d65b38]">Selected from Relaxation: {requestedPractice}</p>}

            <div className="mt-8 max-w-4xl grid grid-cols-1 md:grid-cols-2 items-stretch">
              <div className="relative min-h-56 overflow-hidden bg-white">
                <img src="/assets/services/swaravkash.jpg" alt="Swaravkash mindfulness programme artwork" className="absolute inset-0 h-full w-full object-contain" />
                <div className="absolute bottom-0 left-0 h-1.5 w-full bg-[#174d91]" />
              </div>
              <div className="flex flex-col justify-center rounded-r-[24px] bg-[#fff5ef] px-7 py-8 md:px-8">
                <p className="text-xs font-bold text-[#4c9da3]">{preview.focus}</p>
                <h2 className="mt-2 text-2xl font-bold text-[#303b42]">{preview.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-[#727c82]">{preview.description}</p>
                <p className="mt-2 text-xs font-semibold text-[#727c82]">20 min · Free preview</p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => (player.playing ? player.toggle() : player.select(0))} className="inline-flex items-center gap-2 rounded-full bg-[#e85d35] px-5 py-3 text-sm font-semibold text-white shadow-md shadow-orange-200 hover:bg-[#d84d2c]">
                    <span aria-hidden="true">{player.playing ? 'Ⅱ' : '▶'}</span>{player.playing ? 'Pause preview' : 'Play free preview'}
                  </button>
                  <Link to="/register" className="text-sm font-semibold text-[#d65b38] hover:underline">Create an account</Link>
                </div>
                <p className="mt-3 text-[11px] text-[#858d91]">A gentle tanpura preview plays here; full recorded tracks can be added by your Anahat team.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="max-w-4xl mx-auto px-6 py-12 md:py-16">
          <p className="text-xs font-bold uppercase text-[#d65b38]">Frequently asked questions</p>
          <h2 className="mt-2 font-serif text-3xl font-semibold text-[#303b42]">Before you begin</h2>
          <div className="mt-7 divide-y divide-[#eadbd2] border-y border-[#eadbd2]">
            {FAQS.map(({ question, answer }) => (
              <details key={question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-[#303b42]">
                  {question}<span className="text-lg font-normal text-[#d65b38] transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="max-w-3xl pt-3 pr-8 text-sm leading-relaxed text-[#727c82]">{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}