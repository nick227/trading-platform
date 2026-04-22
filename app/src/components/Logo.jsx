export default function Logo() {
  return (
    <div className="logo">
      <div className="logo-mark">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2" />
          <path d="M11 16L14 19L21 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="logo-text">Lunastic</span>
    </div>
  )
}
