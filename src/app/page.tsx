import Link from "next/link";
import { getUpcomingCard, type UpcomingBout, type BestPrice } from "@/lib/upcoming-card";
import { FighterAvatar } from "@/components/FighterAvatar";
import { BoutDetails } from "@/components/BoutDetails";
import { StatTile } from "@/components/StatTile";
import { SiteHeader } from "@/components/SiteHeader";
import type { FighterStyle } from "@/lib/fighter-style";
import modelArtifact from "@/lib/model-weights/feature-v1.json";

function pct(p: number) {
  return `${Math.round(p * 100)}%`;
}

function formatMoneyline(m: number) {
  return m > 0 ? `+${m}` : `${m}`;
}

export default async function Home() {
  const card = await getUpcomingCard();

  return (
    <>
      <SiteHeader current="home" />
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <section className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">This Week&apos;s Card</h2>
            <p className="mt-1 max-w-md text-sm text-muted">
              Model-driven win probabilities, live sportsbook odds, and value picks for every UFC card.
            </p>
          </div>
          <Link
            href="/methodology"
            className="group flex shrink-0 items-center gap-3 rounded-xl border border-accent/40 bg-surface px-4 py-3 transition-colors hover:border-accent"
          >
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted">Model Accuracy</div>
              <div className="text-2xl font-bold text-accent [text-shadow:0_0_14px_rgba(220,38,38,0.5)]">
                {pct(modelArtifact.backtest.blended.accuracy)}
              </div>
            </div>
            <span className="text-muted transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </section>

      {!card ? (
        <p className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-muted">
          No upcoming event in the database yet.
        </p>
      ) : card.bouts.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-muted">
          {card.event.name} ({card.event.date}) has no scheduled bouts yet.
        </p>
      ) : (
        <section className="overflow-hidden rounded-xl border border-accent/70 bg-surface shadow-[0_0_8px_-4px_rgba(220,38,38,0.35)]">
          <div className="border-b border-border px-5 py-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide">{card.event.name}</h3>
            <p className="text-xs text-muted">
              {card.event.date}
              {card.event.location ? ` · ${card.event.location}` : ""}
            </p>
          </div>

          <div className="divide-y divide-border">
            {card.bouts.map((bout) => (
              <BoutRow key={bout.id} bout={bout} />
            ))}
          </div>
        </section>
      )}
      </div>
    </>
  );
}

function BoutRow({ bout }: { bout: UpcomingBout }) {
  const modelProbB = 1 - bout.modelProbA;
  const marketProbB = bout.marketProbA === null ? null : 1 - bout.marketProbA;

  return (
    <div className="px-5 py-5 transition-colors hover:bg-surface-2/40">
      <div className="mb-3 flex items-center justify-center gap-2 text-xs uppercase tracking-wide text-muted">
        <span>{bout.weight_class ? `${bout.weight_class} Bout` : "Bout"}</span>
        {bout.is_title_fight && (
          <span className="rounded-full border border-gold bg-gold/10 px-2 py-0.5 text-gold shadow-[0_0_12px_-2px_rgba(212,167,44,0.6)]">
            Title
          </span>
        )}
        {bout.isValueBet && (
          <span className="rounded-full border border-good bg-good/10 px-2 py-0.5 text-good shadow-[0_0_12px_-2px_rgba(25,158,112,0.6)]">
            Value
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <Fighter
          id={bout.fighterA.id}
          name={bout.fighterA.full_name}
          style={bout.fighterA.style}
          p4pRank={bout.fighterA.p4pRank}
          divisionRank={bout.fighterA.divisionRank}
          align="left"
          isValue={bout.valueSide === "a"}
        />
        <VsMark />
        <Fighter
          id={bout.fighterB.id}
          name={bout.fighterB.full_name}
          style={bout.fighterB.style}
          p4pRank={bout.fighterB.p4pRank}
          divisionRank={bout.fighterB.divisionRank}
          align="right"
          isValue={bout.valueSide === "b"}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Model" value={pct(bout.modelProbA)} tone={bout.valueSide === "a" ? "good" : "default"} />
          <StatTile label="Market" value={bout.marketProbA === null ? "—" : pct(bout.marketProbA)} sub={bout.bookmakerCount > 0 ? `${bout.bookmakerCount} books` : undefined} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Model" value={pct(modelProbB)} tone={bout.valueSide === "b" ? "good" : "default"} />
          <StatTile label="Market" value={marketProbB === null ? "—" : pct(marketProbB)} sub={bout.bookmakerCount > 0 ? `${bout.bookmakerCount} books` : undefined} />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-4 text-xs">
        <BestPriceLine best={bout.bestPriceA} isValue={bout.valueSide === "a"} />
        <BestPriceLine best={bout.bestPriceB} isValue={bout.valueSide === "b"} />
      </div>

      <BoutDetails
        explanation={bout.explanation}
        oddsHistory={bout.oddsHistory}
        fighterAName={bout.fighterA.full_name}
        fighterBName={bout.fighterB.full_name}
        probA={bout.modelProbA}
        fighterASimInputs={bout.fighterA.simInputs}
        fighterBSimInputs={bout.fighterB.simInputs}
        maxRounds={bout.scheduled_rounds}
      />
    </div>
  );
}

function BestPriceLine({ best, isValue }: { best: BestPrice; isValue: boolean }) {
  if (!best) return <div className="text-muted">No odds yet</div>;
  return (
    <div>
      <span className="text-muted">Best </span>
      <span
        className={`font-mono font-semibold ${isValue ? "text-good [text-shadow:0_0_10px_rgba(25,158,112,0.65)]" : "text-foreground"}`}
      >
        {formatMoneyline(best.moneyline)}
      </span>
      <span className="text-muted"> · {best.sportsbook}</span>
    </div>
  );
}

function VsMark() {
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center">
      <svg viewBox="0 0 24 24" className="absolute inset-0 h-full w-full text-border" aria-hidden="true">
        <polygon points="8,2 16,2 22,8 22,16 16,22 8,22 2,16 2,8" fill="var(--surface-2)" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="relative text-[10px] font-bold tracking-wide text-muted">VS</span>
    </div>
  );
}

function Fighter({
  id,
  name,
  style,
  p4pRank,
  divisionRank,
  align,
  isValue,
}: {
  id: string;
  name: string;
  style: FighterStyle | null;
  p4pRank: number | null;
  divisionRank: number | null;
  align: "left" | "right";
  isValue: boolean;
}) {
  const isLeft = align === "left";
  return (
    <Link
      href={`/fighters/${id}`}
      className={`group flex min-w-0 items-center gap-2 sm:gap-3 ${isLeft ? "" : "flex-row-reverse text-right"}`}
    >
      <div className="shrink-0 transition-transform group-hover:scale-105">
        <FighterAvatar size={56} isValue={isValue} />
      </div>
      <div className="min-w-0">
        <div
          className={`text-sm font-semibold leading-tight break-words group-hover:underline sm:text-base ${isValue ? "text-good" : "text-foreground"}`}
        >
          {divisionRank && <span className="text-muted">#{divisionRank} </span>}
          {name}
        </div>
        {(style || p4pRank) && (
          <div
            className={`mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] uppercase tracking-wide ${isLeft ? "" : "justify-end"}`}
          >
            {style && <span className="text-muted">{style}</span>}
            {p4pRank && <span className="font-semibold text-gold">P4P #{p4pRank}</span>}
          </div>
        )}
      </div>
    </Link>
  );
}
