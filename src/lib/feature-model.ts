// Feature-based model — spec Section 2, Layer 2.
// Pure math only: standardization, logistic regression training/prediction,
// and the Elo/feature-model blend. No Supabase or Node fs here — dataset
// construction (which needs to re-derive point-in-time career stats from
// the seed CSV) lives in scripts/train-feature-model.mjs, which imports
// this module for the actual model math.

export const FEATURE_NAMES = [
  "eloDiff",
  "heightDiff",
  "reachDiff",
  "ageDiff",
  "slpmDiff",
  "sapmDiff",
  "tdAvgDiff",
  "tdDefDiff",
  "streakDiff",
  "daysSinceLastFightDiff",
  "recentOpponentQualityDiff",
  "stanceMatchup",
] as const;

export type FeatureVector = Record<(typeof FEATURE_NAMES)[number], number>;

export function toFeatureArray(f: FeatureVector): number[] {
  return FEATURE_NAMES.map((name) => f[name]);
}

export type Normalization = { mean: number[]; std: number[] };

export function fitNormalization(rows: number[][]): Normalization {
  const n = rows.length;
  const dims = rows[0].length;
  const mean = new Array(dims).fill(0);
  for (const row of rows) for (let i = 0; i < dims; i++) mean[i] += row[i] / n;

  const std = new Array(dims).fill(0);
  for (const row of rows) for (let i = 0; i < dims; i++) std[i] += (row[i] - mean[i]) ** 2 / n;
  for (let i = 0; i < dims; i++) std[i] = Math.sqrt(std[i]) || 1;

  return { mean, std };
}

export function standardize(row: number[], norm: Normalization): number[] {
  return row.map((v, i) => (v - norm.mean[i]) / norm.std[i]);
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export type LogisticModel = { weights: number[]; intercept: number };

export function predictProb(standardizedRow: number[], model: LogisticModel): number {
  const z = model.intercept + standardizedRow.reduce((sum, v, i) => sum + v * model.weights[i], 0);
  return sigmoid(z);
}

// Batch gradient descent with L2 regularization on the weights (not the
// intercept). Features are assumed pre-standardized — plain gradient
// descent converges quickly on z-scored inputs without needing a fancier
// optimizer at this data scale (thousands of rows, a dozen features).
export function trainLogisticRegression(
  X: number[][],
  y: number[],
  { learningRate = 0.1, iterations = 2000, l2 = 0.01 }: { learningRate?: number; iterations?: number; l2?: number } = {}
): LogisticModel {
  const n = X.length;
  const dims = X[0].length;
  let weights = new Array(dims).fill(0);
  let intercept = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const gradW = new Array(dims).fill(0);
    let gradB = 0;

    for (let i = 0; i < n; i++) {
      const pred = predictProb(X[i], { weights, intercept });
      const error = pred - y[i];
      for (let j = 0; j < dims; j++) gradW[j] += (error * X[i][j]) / n;
      gradB += error / n;
    }

    for (let j = 0; j < dims; j++) {
      weights[j] -= learningRate * (gradW[j] + l2 * weights[j]);
    }
    intercept -= learningRate * gradB;
  }

  return { weights, intercept };
}

export function brierScore(predictions: number[], outcomes: number[]): number {
  const n = predictions.length;
  return predictions.reduce((sum, p, i) => sum + (p - outcomes[i]) ** 2, 0) / n;
}

export function accuracy(predictions: number[], outcomes: number[]): number {
  const n = predictions.length;
  const correct = predictions.filter((p, i) => (p >= 0.5 ? 1 : 0) === outcomes[i]).length;
  return correct / n;
}

// Spec Section 2, Layer 2: for fighters with fewer than ~5 UFC fights,
// weight the blend toward Elo since the feature model's inputs won't be
// reliable yet. Uses the LESS-experienced of the two fighters, since the
// feature model is only as trustworthy as its shakiest input.
export function blendWeight(fightCountA: number, fightCountB: number): number {
  return Math.min(1, Math.min(fightCountA, fightCountB) / 5);
}

export function blendProbability(featureProb: number, eloProb: number, weight: number): number {
  return weight * featureProb + (1 - weight) * eloProb;
}
