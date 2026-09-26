import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

// Shared navigation for public pages and authenticated entry points.
export default function PublicNav({ tone = 'light', scrolled = false }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const dark = tone === 'dark';

  const { user, logout } = useAuth();
  const dashboardPath = user?.role === 'therapist' ? '/therapist' : user?.role === 'admin' ? '/admin' : '/dashboard';
  const doLogout = () => { setOpen(false); logout(); navigate('/login'); };

  const linkCls = dark
    ? 'text-white/90 hover:text-white'
    : 'text-slate-600 hover:text-slate-900';

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-300 ${
        dark
          ? scrolled ? 'bg-[#0B1310]/70 backdrop-blur-xl border-b border-white/10 py-2' : 'bg-black/25 backdrop-blur-md py-3'
          : 'bg-[#FDF6EE]/90 backdrop-blur-md border-b border-black/5 py-2'
      }`}
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 flex items-center justify-between">
        <Link to="/" aria-label="Anahat Transformations — home" className="flex items-center gap-3 shrink-0">
          <img src="/assets/anahat-logo.png" alt="" className="w-14 h-14 sm:w-16 sm:h-16 object-contain" />
          <span className={`font-display leading-tight ${dark ? 'text-white photo-text-shadow' : 'text-[#303b42]'}`}>
            <span className="block text-xl sm:text-2xl font-semibold">Anahat</span>
            <span className={`block text-xs sm:text-sm ${dark ? 'text-white/80' : 'text-slate-500'}`}>Transformations</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-7 text-sm font-semibold">
          <Link to="/demo" className={linkCls}>Demo</Link>
          <Link to="/#relaxation" className={linkCls}>Relaxation</Link>
          <Link to="/register?journey=consultation" className={linkCls}>Consultation</Link>
          {user ? (
            <>
              <button type="button" onClick={doLogout} className={linkCls}>Logout</button>
              <Link
                to={dashboardPath}
                className={`px-5 py-2.5 rounded-full text-sm font-bold transition-all ${
                  dark ? 'bg-white text-[#d65b38] hover:bg-[#fff5ef]' : 'bg-[#e85d35] text-white hover:bg-[#d84d2c]'
                }`}
              >
                My dashboard
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" className={linkCls}>Login</Link>
              <Link to="/register" className="px-5 py-2.5 rounded-full text-sm font-bold text-white transition-colors bg-[#e85d35] hover:bg-[#d84d2c]">
                Sign Up
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          aria-label="Menu"
          onClick={() => setOpen((o) => !o)}
          className={`md:hidden ${dark ? 'text-white' : 'text-slate-800'}`}
        >
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <div className={`md:hidden mt-2 mx-4 rounded-2xl overflow-hidden shadow-2xl border ${dark ? 'bg-[#10201c]/95 border-white/10 text-white' : 'bg-white border-black/5 text-slate-800'}`}>
          <Link to="/demo" onClick={() => setOpen(false)} className="block px-5 py-3.5 text-sm font-semibold">Demo</Link>
          <Link to="/#relaxation" onClick={() => setOpen(false)} className="block px-5 py-3.5 text-sm font-semibold">Relaxation</Link>
          <Link to="/register?journey=consultation" onClick={() => setOpen(false)} className="block px-5 py-3.5 text-sm font-semibold">Consultation</Link>
          {user ? (
            <>
              <Link to={dashboardPath} onClick={() => setOpen(false)} className="block px-5 py-3.5 text-sm font-bold text-teal-400">My dashboard</Link>
              <button type="button" onClick={doLogout} className="w-full text-left px-5 py-3.5 text-sm font-semibold">Logout</button>
            </>
          ) : (
            <>
              <Link to="/login" onClick={() => setOpen(false)} className="block px-5 py-3.5 text-sm font-semibold">Login</Link>
              <Link to="/register" onClick={() => setOpen(false)} className="block px-5 py-3.5 text-sm font-bold text-[#e85d35]">Sign Up</Link>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
