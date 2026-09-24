import { Link } from 'react-router-dom';
import { CONTACT } from '../../constants/services';

// Site footer: contact details in the centre, social links, and the pages a
// visitor would expect. This is the ONLY place contact / support details
// live — dashboards deliberately don't repeat them.
export default function PublicFooter({ tone = 'light' }) {
  // Both tones sit on the brand's deep teal so the footer is always clearly
  // visible; "dark" only differs in being translucent over the hero photo.
  const dark = tone === 'dark';
  const text = 'text-white/85';
  const muted = 'text-white/65';
  const ring = 'border-white/25 hover:bg-white/10 text-white';

  return (
    <footer className="relative z-10 text-white" style={{ background: dark ? 'rgba(8, 59, 41, 0.92)' : '#0d5239' }}>
      <div className="max-w-7xl mx-auto px-6 py-14 grid grid-cols-1 md:grid-cols-3 gap-10 items-start">
        {/* Brand */}
        <div className="flex items-start gap-3">
          <img src="/assets/anahat-logo.png" alt="" className="w-12 h-12 object-contain bg-white/90 rounded-full p-1" />
          <div>
            <p className="font-display text-lg font-semibold text-white">Anahat Transformations</p>
            <p className={`text-sm mt-1 max-w-xs ${muted}`}>Music therapy rooted in Indian classical raags — for stress, focus, sleep and everything in between.</p>
          </div>
        </div>

        {/* Contact — centred column */}
        <div className="text-center">
          <p className="font-display text-xl font-semibold mb-4 text-white">Contact us</p>
          <a href={`mailto:${CONTACT.email}`} className={`block text-sm ${text} hover:underline`}>{CONTACT.email}</a>
          <a href={`tel:${CONTACT.phone.replace(/\s/g, '')}`} className={`block text-sm mt-1 ${text} hover:underline`}>{CONTACT.phone}</a>
          <p className={`text-sm mt-1 ${muted}`}>{CONTACT.address}</p>

          <div className="flex items-center justify-center gap-3 mt-5">
            <a href={CONTACT.instagram} target="_blank" rel="noreferrer" aria-label="Instagram" className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${ring}`}>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
              </svg>
            </a>
            <a href={CONTACT.facebook} target="_blank" rel="noreferrer" aria-label="Facebook" className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${ring}`}>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.3c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.4H7.4V14h2.8v8h3.3z" />
              </svg>
            </a>
            <a href={`mailto:${CONTACT.email}`} aria-label="Email" className={`w-11 h-11 rounded-full border flex items-center justify-center transition-colors ${ring}`}>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>
            </a>
          </div>
        </div>

        {/* Links */}
        <div className="md:text-right">
          <p className="font-display text-xl font-semibold mb-4 text-white">Explore</p>
          <ul className={`space-y-2 text-sm ${text}`}>
            <li><Link to="/" className="hover:underline">Home</Link></li>
            <li><Link to="/about" className="hover:underline">About us</Link></li>
            <li><Link to="/#services" className="hover:underline">Our services</Link></li>
            <li><Link to="/login" className="hover:underline">Login</Link></li>
            <li><Link to="/register" className="hover:underline">Get started</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/15">
        <div className={`max-w-7xl mx-auto px-6 py-4 flex flex-wrap gap-4 justify-center text-xs ${muted}`}>
          <a href="#" className="hover:underline">Privacy policy</a>
          <a href="#" className="hover:underline">Terms of service</a>
        </div>
      </div>
    </footer>
  );
}
