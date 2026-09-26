import { Link } from 'react-router-dom';
import { CONTACT } from '../../constants/services';

// Shared warm public-site footer with contact, navigation, and social links.
export default function PublicFooter({ tone = 'light' }) {
  const dark = tone === 'dark';
  const text = 'text-[#5f6a70]';
  const muted = 'text-[#879096]';
  const ring = 'border-[#d8d4d0] hover:bg-[#f7e8df] text-[#677178]';

  return (
    <footer className="relative z-10 text-[#303b42]" style={{ background: dark ? '#fff5ef' : '#fff5ef' }}>
      <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 items-start">
        {/* Brand */}
        <div className="flex items-start gap-3">
          <img src="/assets/anahat-logo.png" alt="" className="w-12 h-12 object-contain" />
          <div>
            <p className="font-display text-lg font-semibold text-[#303b42]">Anahat</p>
            <p className={`text-sm mt-1 max-w-xs ${muted}`}>Music therapy rooted in Indian classical raags — for stress, focus, sleep and everything in between.</p>
          </div>
        </div>

        {/* Contact — centred column */}
        <div className="text-center">
          <p className="font-display text-sm font-semibold mb-4 text-[#303b42]">Support</p>
          <a href={`mailto:${CONTACT.email}`} className={`block text-sm ${text} hover:underline`}>{CONTACT.email}</a>
          <a href={`tel:${CONTACT.phone.replace(/\s/g, '')}`} className={`block text-sm mt-1 ${text} hover:underline`}>{CONTACT.phone}</a>
          <p className={`text-sm mt-1 ${muted}`}>{CONTACT.address}</p>

        </div>

        {/* Links */}
        <div>
          <p className="font-display text-sm font-semibold mb-4 text-[#303b42]">Quick links</p>
          <ul className={`space-y-2 text-sm ${text}`}>
            <li><Link to="/demo" className="hover:underline">Demo</Link></li>
            <li><Link to="/#relaxation" className="hover:underline">Relaxation</Link></li>
            <li><Link to="/register?journey=consultation" className="hover:underline">Consultation</Link></li>
            <li><Link to="/login" className="hover:underline">Login</Link></li>
            <li><Link to="/register" className="hover:underline">Sign up</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-display text-sm font-semibold mb-4 text-[#303b42]">Follow us</p>
          <div className="flex items-center gap-3">
            <a href={CONTACT.instagram} target="_blank" rel="noreferrer" aria-label="Instagram" className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${ring}`}>
              <span className="text-xs font-bold">IG</span>
            </a>
            <a href={CONTACT.facebook} target="_blank" rel="noreferrer" aria-label="Facebook" className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${ring}`}>
              <span className="text-xs font-bold">f</span>
            </a>
          </div>
        </div>
      </div>
      <div className="border-t border-[#e8ddd6]">
        <div className={`max-w-7xl mx-auto px-6 py-4 flex flex-wrap gap-4 justify-center text-xs ${muted}`}>
          <span>© {new Date().getFullYear()} Anahat. All rights reserved.</span>
          <a href="#" className="hover:underline">Privacy policy</a>
          <a href="#" className="hover:underline">Terms of service</a>
        </div>
      </div>
    </footer>
  );
}
