"use client";

import { useState, useTransition } from "react";
import { submitPick } from "@/lib/pick-actions";
import { PICK_METHODS, type PickMethod } from "@/lib/pick-constants";

export type InitialPick = { fighterId: string; method: PickMethod | null; round: number | null };

export function PickButtons({
  fightId,
  fighterA,
  fighterB,
  scheduledRounds,
  initialPick,
  locked,
}: {
  fightId: string;
  fighterA: { id: string; name: string };
  fighterB: { id: string; name: string };
  scheduledRounds: number;
  initialPick: InitialPick | null;
  locked: boolean;
}) {
  const [fighterId, setFighterId] = useState<string | null>(initialPick?.fighterId ?? null);
  const [method, setMethod] = useState<PickMethod | null>(initialPick?.method ?? null);
  const [round, setRound] = useState<number | null>(initialPick?.round ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(nextFighterId: string, nextMethod: PickMethod | null, nextRound: number | null) {
    if (locked || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await submitPick(fightId, nextFighterId, nextMethod, nextRound);
      if (result.error) setError(result.error);
    });
  }

  function chooseFighter(id: string) {
    setFighterId(id);
    save(id, method, round);
  }

  function chooseMethod(m: PickMethod) {
    if (!fighterId) return;
    // Round only means anything for a finish — clear it when switching to
    // Decision instead of leaving a stale round attached.
    const nextRound = m === "Decision" ? null : round;
    setMethod(m);
    setRound(nextRound);
    save(fighterId, m, nextRound);
  }

  function chooseRound(r: number) {
    if (!fighterId || !method) return;
    setRound(r);
    save(fighterId, method, r);
  }

  const needsRound = method === "KO/TKO" || method === "Submission";

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {[fighterA, fighterB].map((f) => {
          const isPicked = fighterId === f.id;
          return (
            <button
              key={f.id}
              type="button"
              disabled={locked || isPending}
              onClick={() => chooseFighter(f.id)}
              className={`rounded-lg border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                isPicked
                  ? "border-good bg-good/10 text-good shadow-[0_0_14px_-3px_rgba(25,158,112,0.5)]"
                  : "border-border bg-surface-2 text-foreground hover:border-accent"
              }`}
            >
              {f.name}
            </button>
          );
        })}
      </div>

      {fighterId && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted">By</span>
          {PICK_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              disabled={locked || isPending}
              onClick={() => chooseMethod(m)}
              className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                method === m
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:border-accent hover:text-accent"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {fighterId && needsRound && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted">Round</span>
          {Array.from({ length: scheduledRounds }, (_, i) => i + 1).map((r) => (
            <button
              key={r}
              type="button"
              disabled={locked || isPending}
              onClick={() => chooseRound(r)}
              className={`rounded-full border px-2.5 py-1 text-xs font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                round === r
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:border-accent hover:text-accent"
              }`}
            >
              R{r}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-center text-xs text-accent">{error}</p>}
    </div>
  );
}
