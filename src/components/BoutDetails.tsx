"use client";

import { useState } from "react";
import { BoutSimulator } from "@/components/BoutSimulator";
import { LineMovementChart } from "@/components/LineMovementChart";
import type { MatchupExplanation } from "@/lib/matchup-explanation";
import type { OddsHistoryPoint } from "@/lib/upcoming-card";
import type { SimulatorFighterInputs } from "@/lib/simulator";

export function BoutDetails({
  explanation,
  oddsHistory,
  fighterAName,
  fighterBName,
  probA,
  fighterASimInputs,
  fighterBSimInputs,
  maxRounds,
}: {
  explanation: MatchupExplanation;
  oddsHistory: OddsHistoryPoint[];
  fighterAName: string;
  fighterBName: string;
  probA: number;
  fighterASimInputs: SimulatorFighterInputs;
  fighterBSimInputs: SimulatorFighterInputs;
  maxRounds: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted transition-colors hover:bg-surface-2 hover:text-accent"
      >
        <span>{open ? "Hide analysis" : "Why, line movement, simulator"}</span>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div>
          <div className="mt-4 text-sm text-muted">
            <p>{explanation.summary}</p>
            {explanation.riskFactors && (
              <p className="mt-1">
                <span className="font-semibold text-foreground">Risk factors: </span>
                {explanation.riskFactors}
              </p>
            )}
          </div>

          <LineMovementChart fighterAName={fighterAName} history={oddsHistory} />

          <BoutSimulator
            fighterAName={fighterAName}
            fighterBName={fighterBName}
            probA={probA}
            fighterA={fighterASimInputs}
            fighterB={fighterBSimInputs}
            maxRounds={maxRounds}
          />
        </div>
      )}
    </div>
  );
}
