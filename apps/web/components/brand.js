export default function Brand({ compact = false }) {
  return <a href="/" className="brand" aria-label="Groundwork home"><svg viewBox="0 0 84 90" aria-hidden="true"><g stroke="#f4f1fe" strokeWidth="3.5" strokeLinejoin="round"><path fill="#6d2cf0" d="M42 44 80 65 42 86 4 65Z"/><path fill="#a186f3" d="M42 24 80 45 42 66 4 45Z"/><path fill="#d4c5fa" d="M42 4 80 25 42 46 4 25Z"/></g></svg>{!compact && <span>Groundwork<span className="brand-dot">.</span></span>}</a>;
}
