// De-vig math — spec Section 2, "Value bet detection".
// Sportsbook moneylines always imply >100% combined probability (the vig);
// this strips that out so the two sides' implied probabilities sum to 1,
// making them comparable to the model's own win probability.

export function americanToImpliedProbability(americanOdds: number): number {
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  return -americanOdds / (-americanOdds + 100);
}

export function devig(
  americanOddsA: number,
  americanOddsB: number
): { probA: number; probB: number } {
  const rawA = americanToImpliedProbability(americanOddsA);
  const rawB = americanToImpliedProbability(americanOddsB);
  const total = rawA + rawB;
  return { probA: rawA / total, probB: rawB / total };
}

// Spec Section 2: flag fights where model probability exceeds de-vigged
// market probability by more than this threshold as "value" — the model
// thinks a fighter is more likely to win than the market is pricing.
export const VALUE_BET_THRESHOLD = 0.05;
