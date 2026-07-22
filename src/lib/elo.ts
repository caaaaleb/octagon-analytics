// Elo baseline — spec Section 2, Layer 1.
// Every fighter starts at ELO_DEFAULT. This module only computes
// ratings/probabilities from numbers you pass in — it doesn't know about
// Supabase or fighter rows.

export const ELO_DEFAULT = 1500;
export const K_FACTOR = 36;

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function winProbability(ratingA: number, ratingB: number): number {
  return expectedScore(ratingA, ratingB);
}

export type EloOutcome = "a_win" | "b_win" | "draw";

// Method-of-victory weighting: a finish moves the winner's rating more than
// a decision would. This is deliberately asymmetric — getting finished does
// NOT cost the loser extra beyond the normal expectation-based loss, since
// that's the fighter on the receiving end, not the one making it happen.
// Among decisions (which stay symmetric), a more lopsided one (by strikes
// landed + cage control) moves rating more than a close one, for both
// sides. Draws/no-contests are untouched.
export const FINISH_MULTIPLIER = 1.3;
const DECISION_MULTIPLIER_MIN = 0.85;
const DECISION_MULTIPLIER_MAX = 1.15;

// Winner-side-only bonuses, stacked multiplicatively with the method
// multiplier above: winning a title fight is a bigger deal than a normal
// win, and winning while already a two-division champion is bigger still.
// Neither applies to the loser's side — this rewards championship-level
// success without extra-punishing whoever fell short of it.
export const TITLE_FIGHT_MULTIPLIER = 1.2;
export const DOUBLE_CHAMP_MULTIPLIER = 1.2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function decisionMultiplier({
  winnerSigStrikes,
  loserSigStrikes,
  winnerControlSeconds,
  loserControlSeconds,
  totalFightSeconds,
}: {
  winnerSigStrikes: number;
  loserSigStrikes: number;
  winnerControlSeconds: number;
  loserControlSeconds: number;
  totalFightSeconds: number;
}): number {
  const strikeDominance =
    (winnerSigStrikes - loserSigStrikes) / Math.max(winnerSigStrikes + loserSigStrikes, 1);
  const controlDominance =
    (winnerControlSeconds - loserControlSeconds) / Math.max(totalFightSeconds, 1);
  const dominance = 0.7 * strikeDominance + 0.3 * controlDominance;
  return clamp(1 + dominance * 0.3, DECISION_MULTIPLIER_MIN, DECISION_MULTIPLIER_MAX);
}

export function updateElo(
  ratingA: number,
  ratingB: number,
  outcome: EloOutcome,
  k: number = K_FACTOR,
  {
    winnerMultiplier = 1,
    loserMultiplier = 1,
  }: { winnerMultiplier?: number; loserMultiplier?: number } = {}
): { ratingA: number; ratingB: number } {
  const scoreA = outcome === "a_win" ? 1 : outcome === "b_win" ? 0 : 0.5;
  const scoreB = 1 - scoreA;
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;

  const multiplierA = outcome === "draw" ? 1 : outcome === "a_win" ? winnerMultiplier : loserMultiplier;
  const multiplierB = outcome === "draw" ? 1 : outcome === "b_win" ? winnerMultiplier : loserMultiplier;

  return {
    ratingA: ratingA + k * multiplierA * (scoreA - expectedA),
    ratingB: ratingB + k * multiplierB * (scoreB - expectedB),
  };
}
