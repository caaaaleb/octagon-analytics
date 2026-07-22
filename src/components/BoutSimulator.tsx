"use client";

import { useState } from "react";
import { runSimulation, type SimulatorFighterInputs, type SimulationSummary } from "@/lib/simulator";

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export function BoutSimulator({
  fighterAName,
  fighterBName,
  probA,
  fighterA,
  fighterB,
  maxRounds,
}: {
  fighterAName: string;
  fighterBName: string;
  probA: number;
  fighterA: SimulatorFighterInputs;
  fighterB: SimulatorFighterInputs;
  maxRounds: number;
}) {
  const [summary, setSummary] = useState<SimulationSummary | null>(null);

  function handleRunBulk() {
    setSummary(runSimulation(probA, fighterA, fighterB, maxRounds, 10000));
  }

  const maxRoundCount = summary ? Math.max(...summary.roundCounts, summary.decisionCount, 1) : 1;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        onClick={handleRunBulk}
        className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wide hover:border-accent hover:shadow-[0_0_14px_-4px_rgba(220,38,38,0.6)]"
      >
        Run 10,000 Simulations
      </button>

      {summary && (
        <div className="mt-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-muted">Win Probability ({summary.trials.toLocaleString()} trials)</div>
          <div className="flex h-8 overflow-hidden rounded-lg border border-border">
            <div
              className="flex items-center justify-center bg-red-600/80 text-xs font-semibold text-white shadow-[0_0_16px_-4px_rgba(220,38,38,0.7)]"
              style={{ width: `${(summary.winCountA / summary.trials) * 100}%` }}
            >
              {fighterAName.split(" ").pop()} {pct(summary.winCountA / summary.trials)}
            </div>
            <div
              className="flex items-center justify-center bg-blue-600/80 text-xs font-semibold text-white shadow-[0_0_16px_-4px_rgba(59,130,246,0.7)]"
              style={{ width: `${(summary.winCountB / summary.trials) * 100}%` }}
            >
              {fighterBName.split(" ").pop()} {pct(summary.winCountB / summary.trials)}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
            <MethodBreakdown name={fighterAName} counts={summary.methodCountA} trials={summary.trials} color="red" />
            <MethodBreakdown name={fighterBName} counts={summary.methodCountB} trials={summary.trials} color="blue" />
          </div>

          <div className="mt-4">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted">Fight Ends In...</div>
            <div className="flex items-end gap-2" style={{ height: 70 }}>
              {summary.roundCounts.map((count, i) => (
                <RoundBar key={i} label={`R${i + 1}`} count={count} trials={summary.trials} max={maxRoundCount} />
              ))}
              <RoundBar label="Dec." count={summary.decisionCount} trials={summary.trials} max={maxRoundCount} muted />
            </div>
          </div>

          <Verdict summary={summary} fighterAName={fighterAName} fighterBName={fighterBName} />
        </div>
      )}
    </div>
  );
}

function MethodBreakdown({
  name,
  counts,
  trials,
  color,
}: {
  name: string;
  counts: { finish: number; decision: number };
  trials: number;
  color: "red" | "blue";
}) {
  const barColor = color === "red" ? "bg-red-600" : "bg-blue-600";
  return (
    <div>
      <div className={`mb-2 font-semibold ${color === "red" ? "text-red-500" : "text-blue-500"}`}>{name}</div>
      {(["finish", "decision"] as const).map((key) => (
        <div key={key} className="mb-1.5 flex items-center gap-2">
          <div className="w-16 shrink-0 capitalize text-muted">{key}</div>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${(counts[key] / trials) * 100}%` }} />
          </div>
          <div className="w-9 shrink-0 text-right font-mono">{pct(counts[key] / trials)}</div>
        </div>
      ))}
    </div>
  );
}

function RoundBar({ label, count, trials, max, muted }: { label: string; count: number; trials: number; max: number; muted?: boolean }) {
  const height = max ? Math.max(2, (count / max) * 60) : 2;
  return (
    <div className="flex flex-1 flex-col items-center justify-end" style={{ height: "100%" }}>
      <div className="mb-1 font-mono text-[10px] text-muted">{pct(count / trials)}</div>
      <div
        className={`w-full max-w-8 rounded-t-md ${muted ? "bg-muted" : "bg-accent shadow-[0_0_12px_-3px_rgba(220,38,38,0.6)]"}`}
        style={{ height }}
      />
      <div className="mt-1 text-[10px] uppercase text-muted">{label}</div>
    </div>
  );
}

function Verdict({
  summary,
  fighterAName,
  fighterBName,
}: {
  summary: SimulationSummary;
  fighterAName: string;
  fighterBName: string;
}) {
  const favoredIsA = summary.winCountA >= summary.winCountB;
  const favName = favoredIsA ? fighterAName : fighterBName;
  const favPct = (favoredIsA ? summary.winCountA : summary.winCountB) / summary.trials;
  const favMethods = favoredIsA ? summary.methodCountA : summary.methodCountB;
  const topMethod = favMethods.finish >= favMethods.decision ? "finish" : "decision";

  return (
    <p className="mt-3 rounded-lg border-l-2 border-accent bg-surface px-3 py-2 text-xs text-muted">
      Across {summary.trials.toLocaleString()} simulated trials, <span className="font-semibold text-foreground">{favName}</span> wins{" "}
      <span className="font-semibold text-foreground">{pct(favPct)}</span> of the time, most often by{" "}
      <span className="font-semibold text-foreground">{topMethod}</span>. The fight goes the distance in{" "}
      <span className="font-semibold text-foreground">{pct(summary.decisionCount / summary.trials)}</span> of simulations.
    </p>
  );
}
