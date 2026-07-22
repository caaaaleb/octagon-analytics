// Win Simulator — spec Section 3. Core math ported from the user's existing
// Monte Carlo widget, adapted to run off real per-fighter history instead
// of hand-curated scouting inputs:
//   - Winner is sampled from the blended MODEL probability (not market
//     odds, per spec — the pasted widget used de-vigged market odds here).
//   - Method (finish vs. decision — two buckets, not three: our data has
//     no reliable KO/TKO-vs-Submission signal, so that split isn't
//     modeled) is sampled from a blend of the winner's own historical
//     finish rate and the loser's historical "gets finished" rate, per
//     spec's "conditioned on both fighters' historical finish rates and
//     the opponent's historical durability."
//   - Round of finish uses the same geometric-decay round-weighting
//     formula as the original widget, driven by the winner's own
//     historical finish speed.
export type SimulatorFighterInputs = {
  finishRate: number | null; // fraction of career wins that were finishes
  finishSpeed: number | null; // 0-1, how early they finish (1 = fast)
  getsFinishedRate: number | null; // fraction of career losses that were finishes
};

// Neutral 50/50-ish priors for fighters with no historical record to draw
// from (e.g. a debut) — disclosed default, not a silent zero.
const DEFAULT_FINISH_RATE = 0.5;
const DEFAULT_FINISH_SPEED = 0.5;
const DEFAULT_GETS_FINISHED_RATE = 0.5;

export function computeRoundWeights(finishSpeed: number, maxRounds: number): number[] {
  const decay = 1 - finishSpeed * 0.65;
  const weights: number[] = [];
  for (let r = 0; r < maxRounds; r++) weights.push(Math.pow(decay, r));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

function weightedRoundPick(weights: number[]): number {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r <= acc) return i + 1;
  }
  return weights.length;
}

export type SimulationResult = { winner: "a" | "b"; method: "finish" | "decision"; round: number };

export function simulateOnce(
  probA: number,
  fighterA: SimulatorFighterInputs,
  fighterB: SimulatorFighterInputs,
  maxRounds: number
): SimulationResult {
  const winner: "a" | "b" = Math.random() < probA ? "a" : "b";
  const winnerStats = winner === "a" ? fighterA : fighterB;
  const loserStats = winner === "a" ? fighterB : fighterA;

  const winnerFinishRate = winnerStats.finishRate ?? DEFAULT_FINISH_RATE;
  const loserGetsFinishedRate = loserStats.getsFinishedRate ?? DEFAULT_GETS_FINISHED_RATE;
  const finishProb = Math.min(0.95, Math.max(0.05, 0.5 * winnerFinishRate + 0.5 * loserGetsFinishedRate));

  const method: "finish" | "decision" = Math.random() < finishProb ? "finish" : "decision";
  let round = maxRounds;
  if (method === "finish") {
    const finishSpeed = winnerStats.finishSpeed ?? DEFAULT_FINISH_SPEED;
    round = weightedRoundPick(computeRoundWeights(finishSpeed, maxRounds));
  }

  return { winner, method, round };
}

export type SimulationSummary = {
  trials: number;
  winCountA: number;
  winCountB: number;
  methodCountA: { finish: number; decision: number };
  methodCountB: { finish: number; decision: number };
  roundCounts: number[]; // index 0 = round 1, etc.
  decisionCount: number;
};

export function runSimulation(
  probA: number,
  fighterA: SimulatorFighterInputs,
  fighterB: SimulatorFighterInputs,
  maxRounds: number,
  trials = 10000
): SimulationSummary {
  const summary: SimulationSummary = {
    trials,
    winCountA: 0,
    winCountB: 0,
    methodCountA: { finish: 0, decision: 0 },
    methodCountB: { finish: 0, decision: 0 },
    roundCounts: new Array(maxRounds).fill(0),
    decisionCount: 0,
  };

  for (let i = 0; i < trials; i++) {
    const result = simulateOnce(probA, fighterA, fighterB, maxRounds);
    if (result.winner === "a") {
      summary.winCountA++;
      summary.methodCountA[result.method]++;
    } else {
      summary.winCountB++;
      summary.methodCountB[result.method]++;
    }
    if (result.method === "decision") summary.decisionCount++;
    else summary.roundCounts[result.round - 1]++;
  }

  return summary;
}
