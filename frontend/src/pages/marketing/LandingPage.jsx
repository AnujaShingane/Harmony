import { useState, useEffect, useRef } from 'react';  
import { Link, useLocation } from 'react-router-dom';  
import PublicNav from '../../components/public/PublicNav';  
import PublicFooter from '../../components/public/PublicFooter';  
import { ANAHAT_SERVICES } from '../../constants/services';  
import { RELAXATION_CONCERNS } from '../../constants/relaxationArtwork';  
import { useAuth } from '../../context/AuthContext';  
  
export default function LandingPage() {  
  const [scrollY, setScrollY] = useState(0);  
  const location = useLocation();  
  const { isAuthenticated } = useAuth();  
  
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
              <h1 className="home-title text-6xl sm:text-7xl lg:text-8xl xl:text-9xl font-bold leading-[0.95] tracking-tight text-[#303b42]">  
                TUNE<br />  
                <span className="tune-gradient">YOURSELF</span>  
              </h1>  
              <p className="mt-6 max-w-lg text-sm sm:text-base leading-relaxed text-[#778087]">  
                Personalized music and AI-powered guidance for your mental, emotional and spiritual well-being.  
              </p>  
              <div className="mt-8 flex flex-wrap gap-3">  
                <button onClick={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })} className="inline-flex items-center gap-3 rounded-full bg-[#e85d35] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#d84d2c]">  
                  Explore Our Services <ArrowRightIcon className="w-4 h-4" />  
                </button>  
                <Link to={isAuthenticated ? '/dashboard/find-therapist' : '/login'} className="inline-flex items-center gap-3 rounded-full border-2 border-[#e85d35] bg-transparent px-5 py-[10px] text-sm font-semibold text-[#d84d2c] transition hover:bg-[#e85d35] hover:text-white">  
                  Book a Consultation <ArrowRightIcon className="w-4 h-4" />  
                </Link>  
              </div>  
            </div>  
            <div className="relative h-64 sm:h-80 md:h-[min(70vh,620px)] overflow-hidden">  
              <img src="/assets/meditation-glow.jpg" alt="A quiet mountain landscape at dusk" className="hero-landscape h-full w-full object-cover object-center" />
            </div>  
          </div>  
        </section>  
  
        <section id="relaxation" className="scroll-mt-24 max-w-7xl mx-auto px-6 py-16 md:py-20">  
          <div className="flex items-end justify-between gap-4 mb-8">  
            <div>  
              <h2 className="section-title text-2xl sm:text-3xl font-semibold text-[#303b42]">Relaxation</h2>  
              <p className="mt-2 text-sm text-[#858d91] max-w-md">Choose a concern to explore recommended music, at a pace that feels unhurried.</p>  
            </div>  
          </div>  
          <ArrowCardCarousel items={RELAXATION_CONCERNS.map((concern) => ({  
            ...concern,  
            to: `/dashboard/relaxation?concern=${concern.key}`,  
          }))} section="relaxation" />  
        </section>  
  
        <section id="services" className="scroll-mt-24 max-w-7xl mx-auto px-6 py-16 md:py-20">  
          <div className="flex items-end justify-between gap-4 mb-8">  
            <div>  
              <h2 className="section-title text-2xl sm:text-3xl font-semibold text-[#303b42]">Services</h2>  
              <p className="mt-2 text-sm text-[#858d91] max-w-md">Holistic support for your mind, body and energy, all in one place.</p>  
            </div>  
            <Link to="/register?journey=consultation" className="text-xs font-semibold text-[#d65b38] hover:underline shrink-0">Get started <span aria-hidden="true">→</span></Link>  
          </div>  
          <ArrowCardCarousel items={ANAHAT_SERVICES.map((service) => ({  
            key: service.key,  
            label: service.name,  
            image: service.image,  
            description: service.focus,  
            to: '/register?journey=consultation',  
          }))} section="services" />  
        </section>  
      </main>  
  
      <PublicFooter />  
      <style>{`  
        .home-title, .section-title { font-family: 'Playfair Display', Georgia, serif; }  
        .home-page { font-family: 'DM Sans', sans-serif; }  
        html { scroll-behavior: smooth; }  
        .hero-landscape {
          -webkit-mask-image: radial-gradient(ellipse 72% 78% at 56% 50%, #000 48%, transparent 100%);
          mask-image: radial-gradient(ellipse 72% 78% at 56% 50%, #000 48%, transparent 100%);
        }
  
        /* Premium, editorial gradient reserved for the "YOURSELF" word only —  
           plum / mauve / dusty-rose / beige / neutral, never orange or red.  
           The shift is slow and subtle: a mood, not an animation. */  
        .tune-gradient {  
          background-image: linear-gradient(100deg, #7d5a6b 0%, #b98a95 20%, #d9b8ab 38%, #e8d7c3 55%, #c69aa0 72%, #8c6478 88%, #b98a95 100%);  
          background-size: 300% 100%;  
          -webkit-background-clip: text;  
          background-clip: text;  
          color: transparent;  
          -webkit-text-fill-color: transparent;  
          animation: tune-gradient-shift 14s ease-in-out infinite;  
        }  
        @keyframes tune-gradient-shift {  
          0% { background-position: 0% 50%; }  
          50% { background-position: 100% 50%; }  
          100% { background-position: 0% 50%; }  
        }  
        @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } .service-tile, .relaxation-track { transition: none; } .tune-gradient { animation: none; } }  
      `}</style>  
    </div>  
  );  
}  
  
function ArrowCardCarousel({ items, section }) {  
  const firstCardRef = useRef(null);  
  const [index, setIndex] = useState(0);  
  const [visibleCount, setVisibleCount] = useState(1);  
  const [step, setStep] = useState(0);  
  const lastIndex = Math.max(0, items.length - visibleCount);  
  
  useEffect(() => {  
    const measure = () => {  
      const width = window.innerWidth;  
      const count = width >= 1024 ? 3 : width >= 640 ? 2 : 1;  
      setVisibleCount(count);  
      const cardWidth = firstCardRef.current?.getBoundingClientRect().width || 0;  
      const gap = width >= 640 ? 20 : 12;  
      setStep(cardWidth + gap);  
      setIndex((current) => Math.min(current, Math.max(0, items.length - count)));  
    };  
    measure();  
    window.addEventListener('resize', measure);  
    return () => window.removeEventListener('resize', measure);  
  }, [items.length, visibleCount]);  
  
const move = (direction) => setIndex((current) => Math.max(0, Math.min(lastIndex, current + direction)));  
  return (  
    <div className="w-full">  
      <div className="mb-5 flex justify-end gap-2">  
        <button type="button" onClick={() => move(-1)} disabled={index === 0} aria-label={`Previous ${section}`} className="flex h-11 w-11 items-center justify-center rounded-full border border-[#d8e2e3] bg-white text-[#292d32] transition hover:bg-[#0F8594] hover:text-white hover:border-[#0F8594] disabled:cursor-not-allowed disabled:opacity-35">  
          <ArrowLeftIcon className="h-5 w-5" />  
        </button>  
        <button type="button" onClick={() => move(1)} disabled={index >= lastIndex} aria-label={`Next ${section}`} className="flex h-11 w-11 items-center justify-center rounded-full border border-[#d8e2e3] bg-white text-[#292d32] transition hover:bg-[#0F8594] hover:text-white hover:border-[#0F8594] disabled:cursor-not-allowed disabled:opacity-35">  
          <ArrowRightIcon className="h-5 w-5" />  
        </button>  
      </div>  
      <div className="overflow-hidden">  
        <div className="relaxation-track flex gap-5 transition-transform duration-500 ease-out sm:gap-7" style={{ transform: `translateX(-${index * step}px)` }}>  
          {items.map((item, cardIndex) => (  
            <Link  
              key={item.key}  
              ref={cardIndex === 0 ? firstCardRef : undefined}  
              to={item.to}  
              className="service-tile group min-w-0 basis-full shrink-0 overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-24px_rgba(15,23,42,0.16)] transition hover:-translate-y-1.5 hover:shadow-[0_24px_50px_-24px_rgba(15,23,42,0.22)] sm:basis-[calc((100%-1.75rem)/2)] lg:basis-[calc((100%-3.5rem)/3)]"  
            >  
              <div className={section === 'services' ? 'h-64 overflow-hidden bg-[#f4f8f8] sm:h-72 lg:h-80' : 'h-64 overflow-hidden bg-[#e7f1f2] sm:h-72 lg:h-80'}>  
                <img  
                  src={item.image.startsWith('/assets/') ? item.image : `/assets/relaxation/${encodeURIComponent(item.image)}`}  
                  alt={`${item.label} ${section === 'relaxation' ? 'relaxation scenery' : 'service'}`}  
                  className={`h-full w-full transition duration-500 group-hover:scale-[1.04] ${section === 'services' ? 'object-contain' : 'object-cover'}`}  
                  loading="lazy"  
                />  
              </div>  
              <div className="px-6 py-5">  
                <h3 className="font-display text-base font-semibold text-[#303b42]">{item.label}</h3>  
                <p className="mt-1.5 text-xs leading-relaxed text-[#68777b]">{item.description}</p>  
              </div>  
            </Link>  
          ))}  
        </div>  
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
  
function ArrowLeftIcon({ className }) {  
  return (  
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">  
      <path d="M19 12H5m7 7-7-7 7-7" />  
    </svg>  
  );  
}