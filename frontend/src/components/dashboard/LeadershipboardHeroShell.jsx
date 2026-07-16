/**
 * Shared Leadershipboard hero shell — navy → indigo gradient + floating bubbles.
 * Used by Superadmin/Superfinance spotlight and Admin standing hero.
 */
const BUBBLES = [
  { className: 'lb-hero-bubble lb-hero-bubble--a' },
  { className: 'lb-hero-bubble lb-hero-bubble--b' },
  { className: 'lb-hero-bubble lb-hero-bubble--c' },
  { className: 'lb-hero-bubble lb-hero-bubble--d' },
  { className: 'lb-hero-bubble lb-hero-bubble--e' },
];

const LeadershipboardHeroShell = ({ children, className = '', contentClassName = '' }) => (
  <div
    className={`relative overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6 lg:p-7 ${className}`}
    style={{
      background: 'linear-gradient(105deg, #101236 0%, #1a1760 45%, #4630B5 100%)',
    }}
  >
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {BUBBLES.map((bubble) => (
        <span key={bubble.className} className={bubble.className} />
      ))}
    </div>
    <div className={`relative z-10 ${contentClassName}`}>{children}</div>
  </div>
);

export default LeadershipboardHeroShell;
