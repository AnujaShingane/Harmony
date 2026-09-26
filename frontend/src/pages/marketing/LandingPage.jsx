import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PublicNav from '../../components/public/PublicNav';
import PublicFooter from '../../components/public/PublicFooter';
import { ANAHAT_SERVICES } from '../../constants/services';

export default function LandingPage() {
  const [scrollY, setScrollY] = useState(0);
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
    <div className="home-page min-h-screen bg-[#fffdfa] text-[#303b42] font-sans selection:bg-[#f6c9b5]">
      <PublicNav tone="light" scrolled={scrollY > 40} />

      <main>
        <section className="min-h-screen bg-[#fff8f3] pt-20">
          <div className="max-w-7xl mx-auto min-h-[calc(100vh-5rem)] grid grid-cols-1 md:grid-cols-2 items-center gap-8 px-6 py-10 md:py-12">
            <div className="py-4 md:py-8">
              <h1 className="home-title text-4xl sm:text-5xl lg:text-6xl font-semibold leading-tight text-[#303b42]">
                TUNE <span className="text-[#e85d35]">YOURSELF</span>
              </h1>
              <p className="mt-4 max-w-lg text-sm sm:text-base leading-relaxed text-[#778087]">
                Personalized music and AI-powered guidance for your mental, emotional and spiritual well-being.
              </p>
              <button onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })} className="mt-6 inline-flex items-center gap-3 rounded-full bg-[#e85d35] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#d84d2c]">
                Explore Our Services <ArrowRightIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="relative h-56 sm:h-72 md:h-[320px] overflow-hidden">
              <img src="/assets/meditation-glow.jpg" alt="A quiet mountain landscape at dusk" className="h-full w-full object-cover object-center" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#fff8f3]/45 via-transparent to-transparent" />
            </div>
          </div>
        </section>

        <section id="relaxation" className="scroll-mt-20 min-h-[85vh] max-w-7xl mx-auto px-6 py-10 md:py-12">
          <div className="flex items-end justify-between gap-4 mb-5">
            <div>
              <h2 className="section-title text-xl font-semibold uppercase text-[#303b42]">Relaxation</h2>
              <p className="mt-1 text-sm text-[#858d91]">Choose a practice for how you feel today.</p>
            </div>
            <Link to="/demo" className="text-xs font-semibold text-[#d65b38] hover:underline">See all <span aria-hidden="true">→</span></Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {[
              { title: 'Frustration', image: '/assets/services/raagini.jpg', focus: 'Find calm in the chaos' },
              { title: 'Emotions', image: '/assets/services/niramay.jpg', focus: 'Release. Reset. Restore.' },
              { title: 'Mood', image: '/assets/services/swaravkash.jpg', focus: 'Bring balance to your day' },
              { title: 'Anxiety', image: '/assets/services/arambh.jpg', focus: 'Calm your mind' },
              { title: 'Sleep', image: '/assets/meditation-glow.jpg', focus: 'Rest. Rejuvenate.' },
              { title: 'Focus', image: '/assets/services/swardhyan.jpg', focus: 'Return to the present' },
            ].map((item) => (
              <Link key={item.title} to={`/demo?practice=${encodeURIComponent(item.title.toLowerCase())}`} className="relax-card group relative h-44 w-52 shrink-0 overflow-hidden rounded-lg bg-[#f4e6dd] text-white">
                <img src={item.image} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-black/20" />
                <span className="absolute left-4 top-3 text-xs font-semibold uppercase">{item.title}</span>
                <span className="absolute bottom-4 left-4 right-3">
                  <span className="block text-base font-semibold">{item.title}</span>
                  <span className="mt-1 block text-xs text-white/85">{item.focus}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="bg-[#fff5ef] py-8 md:py-10">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-[280px_1fr_230px] gap-6 md:gap-8 items-center px-6">
            <div className="relative h-56 md:h-64 overflow-hidden rounded-lg">
              <img src="/assets/meditation-glow.jpg" alt="A peaceful landscape for a guided sleep practice" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#d65b38]">SLEEP</span>
              <Link to="/demo" aria-label="Preview the featured sleep practice" className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#e85d35] shadow">▶</span>
              </Link>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-[#dd704e]">Featured relaxation</p>
              <h2 className="mt-2 text-2xl font-semibold text-[#303b42]">Invite Sleep</h2>
              <p className="mt-3 text-sm leading-relaxed text-[#727c82]">A simple guided practice to prepare your mind and body for restful sleep. Observe and gently soften your breath, weaving a sense of calm with each inhale and exhale.</p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs text-[#657078]">
                <span className="rounded-full bg-white px-3 py-1.5">Yoga Nidra</span>
                <span className="rounded-full bg-white px-3 py-1.5">Level 1</span>
                <span className="rounded-full bg-white px-3 py-1.5">20 min</span>
              </div>
              <Link to="/register" className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#e85d35] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#d84d2c]">Play now <ArrowRightIcon className="w-4 h-4" /></Link>
            </div>
            <div className="border-t border-[#eadbd2] pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
              <h3 className="text-sm font-semibold text-[#303b42]">More relaxation</h3>
              <ul className="mt-3 divide-y divide-[#eadbd2] text-sm text-[#69747a]">
                {['Deep Rest & Relaxation', 'Morning Presence', 'Meditation with So Ham'].map((name) => <li key={name}><Link to="/relaxation" className="flex justify-between py-3 hover:text-[#d65b38]">{name}<span aria-hidden="true">›</span></Link></li>)}
              </ul>
              <Link to="/relaxation" className="mt-4 inline-block text-xs font-semibold text-[#d65b38] hover:underline">See all practices →</Link>
            </div>
          </div>
        </section>

        <section id="services" className="scroll-mt-24 max-w-7xl mx-auto px-6 py-10 md:py-12">
          <div className="flex items-end justify-between gap-4 mb-5">
            <div>
              <h2 className="section-title text-xl font-semibold uppercase text-[#303b42]">Services</h2>
              <p className="mt-1 text-sm text-[#858d91]">Holistic support for your mind, body and energy, all in one place.</p>
            </div>
            <Link to="/register?journey=consultation" className="text-xs font-semibold text-[#d65b38] hover:underline">Get started <span aria-hidden="true">→</span></Link>
          </div>
          <ServicesSlider />
        </section>
      </main>

      <PublicFooter />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@500;600;700&display=swap');
        .home-title, .section-title { font-family: 'Manrope', sans-serif; }
        .home-page { font-family: 'DM Sans', sans-serif; }
        @media (prefers-reduced-motion: reduce) { .relax-card img, .service-tile { transition: none; } }
      `}</style>
    </div>
  );
}

// Infinite horizontal slider of service artwork. The list is rendered twice
// so the CSS translate of -50% loops seamlessly; arrows nudge the strip
// manually and pause the auto-slide while the visitor is interacting.
function ServicesSlider() {
  const trackRef = useRef(null);
  const nudge = (dir) => trackRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });

  return (
    <div className="relative">
      <div ref={trackRef} className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3">
        {ANAHAT_SERVICES.map((service) => (
          <Link key={service.key} to="/register?journey=consultation" className="service-tile group w-56 shrink-0 snap-start overflow-hidden rounded-lg border border-[#f0e2da] bg-[#fff7f2] transition hover:-translate-y-1 sm:w-64">
            <img src={service.image} alt={`${service.name}: ${service.focus}`} className="h-40 w-full object-cover transition duration-500 group-hover:scale-[1.03]" loading="lazy" />
            <div className="px-4 py-3">
              <h3 className="text-sm font-semibold text-[#303b42]">{service.name}</h3>
              <p className="mt-1 text-xs text-[#81898d]">{service.focus}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="flex justify-end gap-2 mt-3">
        <button type="button" onClick={() => nudge(-1)} aria-label="Previous services" className="w-10 h-10 rounded-full border border-[#eadbd2] bg-white text-[#d65b38] flex items-center justify-center">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
        </button>
        <button type="button" onClick={() => nudge(1)} aria-label="Next services" className="w-10 h-10 rounded-full border border-[#eadbd2] bg-white text-[#d65b38] flex items-center justify-center">
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
