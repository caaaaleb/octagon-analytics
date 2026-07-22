import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFighterProfile, getFighterFightHistory, type FighterFightHistoryRow } from "@/lib/fighter-profile";
import { FighterAvatar } from "@/components/FighterAvatar";
import { StatTile } from "@/components/StatTile";
import { SiteHeader } from "@/components/SiteHeader";

function cmToFeetInches(cm: number): string {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return `${feet}'${inches}"`;
}

function ageFromDob(dob: string): number {
  const ms = Date.now() - new Date(dob).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function stat(v: number | null, digits = 1): string {
  return v === null ? "—" : v.toFixed(digits);
}

function resultFor(fight: FighterFightHistoryRow, fighterId: string): "W" | "L" | "D" | "NC" {
  if (fight.winner_id === fighterId) return "W";
  if (fight.winner_id !== null) return "L";
  return fight.result_method === "Draw" ? "D" : "NC";
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const fighter = await getFighterProfile(id);
  if (!fighter) return { title: "Fighter Not Found — Octagon Analytics" };
  return {
    title: `${fighter.full_name} — Octagon Analytics`,
    description: `${fighter.full_name} fight record, stats, and Elo rating on Octagon Analytics.`,
  };
}

export default async function FighterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fighter = await getFighterProfile(id);
  if (!fighter) notFound();

  const history = await getFighterFightHistory(id);
  const last5 = history.slice(0, 5);

  return (
    <>
      <SiteHeader current="fighter" />
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <section className="mb-6 rounded-xl border border-border bg-surface px-5 py-5">
        <div className="flex flex-wrap items-center gap-4">
          <FighterAvatar size={72} />
          <div>
            <h1 className="text-xl font-semibold">{fighter.full_name}</h1>
            <p className="text-sm text-muted">
              {fighter.weight_class ?? "Weight class unknown"} · {fighter.wins}-{fighter.losses}
              {fighter.draws ? `-${fighter.draws}` : ""}
              {fighter.no_contests ? ` (${fighter.no_contests} NC)` : ""}
              {fighter.stance ? ` · ${fighter.stance}` : ""}
            </p>
          </div>
          {last5.length > 0 && (
            <div className="flex items-center gap-2 sm:ml-auto">
              <span className="text-[10px] uppercase tracking-wide text-muted">Last {last5.length}</span>
              <div className="flex gap-1">
                {last5.map((fight) => (
                  <ResultBadge key={fight.id} result={resultFor(fight, id)} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-4 sm:grid-cols-4">
          <StatTile label="Height" value={fighter.height_cm ? cmToFeetInches(fighter.height_cm) : "—"} sub={fighter.height_cm ? `${fighter.height_cm} cm` : undefined} />
          <StatTile label="Reach" value={fighter.reach_cm ? cmToFeetInches(fighter.reach_cm) : "—"} sub={fighter.reach_cm ? `${fighter.reach_cm} cm` : undefined} />
          <StatTile label="Age" value={fighter.dob ? `${ageFromDob(fighter.dob)}` : "—"} />
          <StatTile label="Elo Rating" value={fighter.elo_rating.toFixed(1)} tone="accent" />
        </div>
      </section>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface px-5 py-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <StrikingIcon /> Striking
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="SLpM" value={stat(fighter.slpm)} />
            <StatTile label="SApM" value={stat(fighter.sapm)} />
            <StatTile label="Str. Acc" value={pct(fighter.str_acc)} />
            <StatTile label="Str. Def" value={pct(fighter.str_def)} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface px-5 py-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <GrapplingIcon /> Grappling
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="TD Avg" value={stat(fighter.td_avg)} />
            <StatTile label="TD Acc" value={pct(fighter.td_acc)} />
            <StatTile label="TD Def" value={pct(fighter.td_def)} />
            <StatTile label="Sub Avg" value={stat(fighter.sub_avg)} />
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Fight History</h2>
        </div>
        {history.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">No completed fights on record.</p>
        ) : (
          <div className="divide-y divide-border">
            {history.map((fight) => {
              const result = resultFor(fight, id);

              return (
                <div
                  key={fight.id}
                  className="flex flex-col gap-2 px-5 py-3 text-sm transition-colors hover:bg-surface-2/40 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="flex min-w-0 items-center">
                    <ResultBadge result={result} shape="square" className="mr-3 shrink-0" />
                    {fight.opponent ? (
                      <Link href={`/fighters/${fight.opponent.id}`} className="truncate font-medium hover:underline">
                        {fight.opponent.full_name}
                      </Link>
                    ) : (
                      <span className="text-muted">Unknown opponent</span>
                    )}
                    {fight.is_title_fight && (
                      <span className="ml-2 shrink-0 rounded-full border border-gold bg-gold/10 px-2 py-0.5 text-xs text-gold shadow-[0_0_10px_-2px_rgba(212,167,44,0.6)]">
                        Title
                      </span>
                    )}
                  </div>
                  <div className="pl-8 text-xs text-muted sm:pl-0 sm:text-right">
                    <div>{fight.event?.name}</div>
                    <div>
                      {fight.event?.date}
                      {fight.result_method && !["Draw", "No Contest"].includes(fight.result_method)
                        ? ` · ${fight.result_method}${fight.result_round ? `, R${fight.result_round}` : ""}${fight.result_time ? ` ${fight.result_time}` : ""}`
                        : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      </div>
    </>
  );
}

function StrikingIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

function GrapplingIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </svg>
  );
}

function ResultBadge({
  result,
  shape = "circle",
  className = "",
}: {
  result: "W" | "L" | "D" | "NC";
  shape?: "circle" | "square";
  className?: string;
}) {
  const colorClass =
    result === "W"
      ? "bg-good shadow-[0_0_10px_-1px_rgba(25,158,112,0.7)]"
      : result === "L"
        ? "bg-accent shadow-[0_0_10px_-1px_rgba(220,38,38,0.7)]"
        : "bg-muted";
  const shapeClass = shape === "square" ? "rounded-md" : "rounded-full";
  return (
    <span
      title={result}
      className={`inline-flex h-5 w-5 items-center justify-center ${shapeClass} text-[9px] font-bold text-background ${colorClass} ${className}`}
    >
      {result}
    </span>
  );
}
