// Wordmark for the site header — the "O" in OCTAGON is a real octagon
// outline (an actual 8-sided shape, not a stylized letter), styled to evoke
// the fight cage. The letter is kept in the DOM as visually-hidden text so
// the accessible name still reads "Octagon Analytics", not "Ctagon Analytics".
export function LogoWordmark() {
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="inline-flex items-center gap-[0.15em]">
        <span className="sr-only">O</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[0.85em] w-[0.85em] shrink-0 text-accent drop-shadow-[0_0_6px_rgba(220,38,38,0.6)]">
          <polygon points="8,2 16,2 22,8 22,16 16,22 8,22 2,16 2,8" fill="none" stroke="currentColor" strokeWidth="2.5" />
        </svg>
        <span>CTAGON</span>
      </span>
      <span className="text-accent">ANALYTICS</span>
    </span>
  );
}
