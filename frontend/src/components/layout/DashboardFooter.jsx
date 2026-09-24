import { Link } from 'react-router-dom';
import { CONTACT } from '../../constants/services';

// Thin, single-row footer at the bottom of every dashboard.
export default function DashboardFooter() {
  return (
    <footer className="mt-10 rounded-2xl border border-black/5 bg-white px-6 py-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-slate-500">
      <div className="flex items-center gap-2">
        <img src="/assets/anahat-logo.png" alt="" className="w-6 h-6 object-contain" />
        <span className="font-semibold text-slate-700">Anahat Transformations</span>
        <span className="hidden sm:inline text-slate-300">·</span>
        <span className="hidden sm:inline">Tune. Heal. Transform.</span>
      </div>
      <div className="flex items-center gap-4">
        <a href={`mailto:${CONTACT.email}`} className="hover:text-slate-800">{CONTACT.email}</a>
        <a href={`tel:${CONTACT.phone.replace(/\s/g, '')}`} className="hover:text-slate-800">{CONTACT.phone}</a>
        <a href={CONTACT.instagram} target="_blank" rel="noreferrer" className="hover:text-slate-800">Instagram</a>
        <a href={CONTACT.facebook} target="_blank" rel="noreferrer" className="hover:text-slate-800">Facebook</a>
        <Link to="/about" className="hover:text-slate-800">About</Link>
      </div>
    </footer>
  );
}
