import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import PublicNav from '../../components/public/PublicNav';
import PublicFooter from '../../components/public/PublicFooter';
import { ANAHAT_SERVICES } from '../../constants/services';

export default function LandingPage() {
  const [scrollY, setScrollY] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  // Nav turns solid once the visitor scrolls the window.
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Support /#services links coming from other pages.
  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 80);
    }
  }, [location.hash]);

  return (
    <div className="min-h-screen bg-[#0B1310] text-slate-900 font-sans relative selection:bg-teal-400/30">
      {/* One fixed photo behind the whole page; hero, about, services and
          footer scroll over it. */}
      <div className="fixed inset-0 z-0">
        <img src="/assets/hero-instruments-dark.png" alt="" className="w-full h-full object-cover object-[70%_center]" />
        <div className="absolute inset-0 bg-[#F8F3E7]/20"></div>
      </div>

      <PublicNav tone="dark" scrolled={scrollY > 40} />

      {/* --- HERO --- */}
      <section className="relative min-h-screen flex items-end overflow-hidden z-10">
        <div className="relative z-10 max-w-7xl mx-auto w-full px-6 pt-36 pb-24 sm:pb-20">
          <div className="max-w-2xl space-y-7">
            <h1 className="font-display text-6xl sm:text-7xl md:text-8xl leading-[0.9] text-[#341539] tracking-tighter">
              TUNE <br />
              <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-[#341539] via-[#8A5A6F] to-[#C9A15A] animate-shimmer bg-[length:200%_auto]">YOURSELF.</span>
            </h1>

            <div className="flex items-center gap-3 py-1">
              <span className="h-px w-8 bg-teal-700/30"></span>
              <LotusIcon className="w-4 h-4 text-teal-700" />
              <span className="h-px w-8 bg-teal-700/30"></span>
            </div>

            <p className="text-base sm:text-xl text-[#3B2A38]/90 max-w-lg font-light leading-relaxed">
              Where the ancient mathematics of the <strong className="text-teal-700 font-semibold">Vedas</strong> meets modern <strong className="text-teal-800 font-semibold">Sound Diagnostics</strong>.
            </p>

            <div className="pt-2">
              <button onClick={() => navigate('/register')} className="hero-gold-btn inline-flex items-center gap-3 px-8 py-4 rounded-full text-xs font-bold uppercase tracking-widest">
                <LotusIcon className="w-4 h-4 shrink-0" />
                Start Your Healing Journey
                <ArrowRightIcon className="w-4 h-4 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* --- ANAHAT SERVICES (sliding) --- */}
      <section id="services" className="relative z-10 pb-28 pt-4">
        <div className="max-w-7xl mx-auto px-6 mb-10 text-center">
          <h2 className="photo-text-shadow font-display text-5xl text-white font-semibold">Anahat services</h2>
          <p className="photo-text-shadow text-white/80 mt-3 text-sm md:text-base">Music-therapy programmes, each designed around one need.</p>
        </div>
        <ServicesSlider />
      </section>

      <PublicFooter tone="dark" />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&display=swap');
        .font-display { font-family: 'Fraunces', ui-serif, Georgia, serif; }
        @keyframes shimmer { 0% { background-position: 200% center; } 100% { background-position: -200% center; } }
        .animate-shimmer { animation: shimmer 6s linear infinite; }

        .hero-gold-btn {
          background: rgba(13, 82, 57, 0.6);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(94, 234, 212, 0.35);
          color: #ffffff;
          box-shadow: 0 8px 24px -8px rgba(13, 82, 57, 0.4);
          transition: transform 0.3s ease, box-shadow 0.3s ease, background 0.3s ease;
        }
        .hero-gold-btn:hover { transform: translateY(-2px) scale(1.02); background: rgba(13, 82, 57, 0.78); }

        /* Services marquee — one continuous slide, pauses on hover. */
        @keyframes services-slide { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .services-track { animation: services-slide 45s linear infinite; width: max-content; }
        .services-track:hover, .services-track.paused { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) { .services-track { animation: none; } }
      `}</style>
    </div>
  );
}

// Infinite horizontal slider of service artwork. The list is rendered twice
// so the CSS translate of -50% loops seamlessly; arrows nudge the strip
// manually and pause the auto-slide while the visitor is interacting.
function ServicesSlider() {
  const [paused, setPaused] = useState(false);
  const [offset, setOffset] = useState(0);
  const items = [...ANAHAT_SERVICES, ...ANAHAT_SERVICES];
  const step = 300;

  const nudge = (dir) => {
    setPaused(true);
    setOffset((o) => o + dir * step);
  };

  return (
    <div className="relative">
      <div className="overflow-hidden">
        <div
          className={`services-track flex gap-6 px-6 ${paused ? 'paused' : ''}`}
          style={{ marginLeft: offset ? `${-offset}px` : undefined, transition: 'margin-left 0.5s ease' }}
        >
          {items.map((s, i) => (
            <figure
              key={`${s.key}-${i}`}
              className="w-[260px] sm:w-[280px] shrink-0 rounded-3xl overflow-hidden bg-white shadow-xl border border-white/30"
            >
              <img src={s.image} alt={`${s.name} — music therapy for ${s.focus.toLowerCase()}`} className="w-full aspect-square object-cover" loading="lazy" />
            </figure>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 mt-8">
        <button type="button" onClick={() => nudge(-1)} aria-label="Previous" className="w-11 h-11 rounded-full bg-white/90 hover:bg-white text-[#0d5239] shadow-lg flex items-center justify-center">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
        </button>
        <button type="button" onClick={() => nudge(1)} aria-label="Next" className="w-11 h-11 rounded-full bg-white/90 hover:bg-white text-[#0d5239] shadow-lg flex items-center justify-center">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  );
}

function LotusIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2c1.2 2.4 1.8 4.6 1.8 6.6 0 1.9-.8 3.4-1.8 4.4-1-1-1.8-2.5-1.8-4.4C10.2 6.6 10.8 4.4 12 2z" />
      <path d="M4.5 8c2.4.5 4.3 1.6 5.6 3.1 1.2 1.5 1.6 3.1 1.4 4.5-1.4.3-3-.2-4.3-1.6C5.9 12.4 5 10.4 4.5 8z" />
      <path d="M19.5 8c-.5 2.4-1.4 4.4-2.7 5.9-1.3 1.5-2.9 2-4.3 1.7-.2-1.4.2-3 1.4-4.5C15.2 9.6 17.1 8.5 19.5 8z" />
      <path d="M2 15.5c2.2-.6 4.3-.5 6 .3 1.7.8 2.8 2.1 3.2 3.5-1.2.9-2.9 1-4.6.2C4.9 18.6 3.2 17.2 2 15.5z" />
      <path d="M22 15.5c-1.2 1.7-2.9 3.1-4.6 4-1.7.8-3.4.7-4.6-.2.4-1.4 1.5-2.7 3.2-3.5 1.7-.8 3.8-.9 6-.3z" />
      <path d="M12 22c-2.8 0-5.2-.8-6.9-2.1 1.5-1.3 3.9-2.1 6.9-2.1s5.4.8 6.9 2.1C17.2 21.2 14.8 22 12 22z" />
    </svg>
  );
}

function ArrowRightIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
