export function StatTile({
  label,
  value,
  sub,
  tone = "default",
  align = "left",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "accent";
  align?: "left" | "center" | "right";
}) {
  const valueColor = tone === "good" ? "text-good" : tone === "accent" ? "text-accent" : "text-foreground";
  const alignClass = align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center";
  const glow =
    tone === "good"
      ? "border-good/40 shadow-[0_0_14px_-3px_rgba(25,158,112,0.5)]"
      : tone === "accent"
        ? "border-accent/40 shadow-[0_0_14px_-3px_rgba(220,38,38,0.5)]"
        : "border-border";

  return (
    <div className={`rounded-lg border bg-surface-2 px-3 py-2 ${glow} ${alignClass}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-lg font-semibold ${valueColor}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}
