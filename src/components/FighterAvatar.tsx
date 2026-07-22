// Placeholder avatar — no real fighter photos (copyright/licensing reasons,
// see project notes). A simple silhouette reads as an intentional design
// choice rather than an unfinished text-initials stand-in.
export function FighterAvatar({
  size = 56,
  isValue = false,
}: {
  size?: number;
  isValue?: boolean;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full border ${
        isValue ? "border-good bg-good/10 shadow-[0_0_16px_-2px_rgba(25,158,112,0.55)]" : "border-border bg-surface"
      }`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.55}
        height={size * 0.55}
        fill="none"
        stroke={isValue ? "var(--good)" : "var(--muted)"}
        strokeWidth={1.5}
      >
        <circle cx="12" cy="8" r="3.75" />
        <path d="M4.5 20c0-3.5 3.5-6 7.5-6s7.5 2.5 7.5 6" strokeLinecap="round" />
      </svg>
    </div>
  );
}
