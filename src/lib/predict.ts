import type { SupabaseClient } from "@supabase/supabase-js";
import { winProbability } from "@/lib/elo";
import {
  FEATURE_NAMES,
  standardize,
  predictProb,
  blendWeight,
  blendProbability,
  type FeatureVector,
  type LogisticModel,
  type Normalization,
} from "@/lib/feature-model";
import modelArtifact from "@/lib/model-weights/feature-v1.json";

const model: LogisticModel = { weights: modelArtifact.weights, intercept: modelArtifact.intercept };
const normalization: Normalization = modelArtifact.normalization;
const DEFAULTS = modelArtifact.defaults;

export type FighterForPrediction = {
  id: string;
  elo_rating: number;
  height_cm: number | null;
  reach_cm: number | null;
  dob: string | null;
  stance: string | null;
  slpm: number | null;
  sapm: number | null;
  td_avg: number | null;
  td_def: number | null;
};

function ageAt(dob: string | null, asOfDate: string): number | null {
  if (!dob) return null;
  const ms = new Date(asOfDate).getTime() - new Date(dob).getTime();
  return ms / (1000 * 60 * 60 * 24 * 365.25);
}

function stanceMatchup(stanceA: string | null, stanceB: string | null): number {
  const a = (stanceA ?? "").toLowerCase();
  const b = (stanceB ?? "").toLowerCase();
  if (a === "southpaw" && b === "orthodox") return 1;
  if (a === "orthodox" && b === "southpaw") return -1;
  return 0;
}

// A fighter's "recent form" (win/loss streak, days since last fight, recent
// opponent quality) isn't stored anywhere — it's derived from their
// completed-fight history, walked chronologically the same way training
// did. Uses opponents' CURRENT Elo rather than their Elo at the time of
// that past fight (unlike training, which had the exact point-in-time
// value) — a reasonable simplification for live inference, since Elo
// doesn't swing drastically fight-to-fight.
async function getFormStats(supabase: SupabaseClient, fighterId: string) {
  const { data, error } = await supabase
    .from("fights")
    .select(
      `
      result_winner_id, result_method, fighter_a_id, fighter_b_id,
      event:event_id(date),
      fighter_a:fighter_a_id(elo_rating), fighter_b:fighter_b_id(elo_rating)
    `
    )
    .or(`fighter_a_id.eq.${fighterId},fighter_b_id.eq.${fighterId}`)
    .eq("status", "completed");

  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{
    result_winner_id: string | null;
    result_method: string | null;
    fighter_a_id: string;
    fighter_b_id: string;
    event: { date: string } | null;
    fighter_a: { elo_rating: number } | null;
    fighter_b: { elo_rating: number } | null;
  }>;

  rows.sort((a, b) => (a.event?.date ?? "").localeCompare(b.event?.date ?? ""));

  let streak = 0;
  let lastFightDate: string | null = null;
  const recentOpponentElos: number[] = [];

  for (const row of rows) {
    const isA = row.fighter_a_id === fighterId;
    const won = row.result_winner_id === fighterId;
    const lost = row.result_winner_id !== null && row.result_winner_id !== fighterId;
    const isDraw = row.result_winner_id === null && row.result_method === "Draw";
    const opponentElo = isA ? row.fighter_b?.elo_rating : row.fighter_a?.elo_rating;

    if (row.result_winner_id === null && !isDraw) continue; // no contest, doesn't count

    if (won) streak = streak >= 0 ? streak + 1 : 1;
    else if (lost) streak = streak <= 0 ? streak - 1 : -1;
    else if (isDraw) streak = 0;

    if (opponentElo !== undefined && opponentElo !== null) {
      recentOpponentElos.push(opponentElo);
      if (recentOpponentElos.length > 3) recentOpponentElos.shift();
    }
    lastFightDate = row.event?.date ?? lastFightDate;
  }

  return {
    fightCount: rows.length,
    streak,
    lastFightDate,
    recentOpponentQuality: recentOpponentElos.length
      ? recentOpponentElos.reduce((s, e) => s + e, 0) / recentOpponentElos.length
      : 1500,
  };
}

export type FeatureContribution = { name: (typeof FEATURE_NAMES)[number]; diff: number; contribution: number };

export type ModelPrediction = {
  probability: number; // blended, fighter A's win probability
  featureProbA: number; // feature-model-only probability, for the explanation generator
  contributions: FeatureContribution[]; // weight x standardized-diff, per feature
};

export async function getModelPrediction(
  supabase: SupabaseClient,
  fighterA: FighterForPrediction,
  fighterB: FighterForPrediction,
  asOfDate: string
): Promise<ModelPrediction> {
  const [formA, formB] = await Promise.all([
    getFormStats(supabase, fighterA.id),
    getFormStats(supabase, fighterB.id),
  ]);

  const daysSinceA = formA.lastFightDate
    ? (new Date(asOfDate).getTime() - new Date(formA.lastFightDate).getTime()) / (1000 * 60 * 60 * 24)
    : DEFAULTS.DAYS_SINCE_DEFAULT;
  const daysSinceB = formB.lastFightDate
    ? (new Date(asOfDate).getTime() - new Date(formB.lastFightDate).getTime()) / (1000 * 60 * 60 * 24)
    : DEFAULTS.DAYS_SINCE_DEFAULT;

  const ageA = ageAt(fighterA.dob, asOfDate);
  const ageB = ageAt(fighterB.dob, asOfDate);

  const slpmA = formA.fightCount > 0 ? fighterA.slpm ?? DEFAULTS.SLPM_DEFAULT : DEFAULTS.SLPM_DEFAULT;
  const slpmB = formB.fightCount > 0 ? fighterB.slpm ?? DEFAULTS.SLPM_DEFAULT : DEFAULTS.SLPM_DEFAULT;
  const sapmA = formA.fightCount > 0 ? fighterA.sapm ?? DEFAULTS.SAPM_DEFAULT : DEFAULTS.SAPM_DEFAULT;
  const sapmB = formB.fightCount > 0 ? fighterB.sapm ?? DEFAULTS.SAPM_DEFAULT : DEFAULTS.SAPM_DEFAULT;
  const tdAvgA = formA.fightCount > 0 ? fighterA.td_avg ?? DEFAULTS.TD_AVG_DEFAULT : DEFAULTS.TD_AVG_DEFAULT;
  const tdAvgB = formB.fightCount > 0 ? fighterB.td_avg ?? DEFAULTS.TD_AVG_DEFAULT : DEFAULTS.TD_AVG_DEFAULT;
  const tdDefA = formA.fightCount > 0 ? fighterA.td_def ?? DEFAULTS.TD_DEF_DEFAULT : DEFAULTS.TD_DEF_DEFAULT;
  const tdDefB = formB.fightCount > 0 ? fighterB.td_def ?? DEFAULTS.TD_DEF_DEFAULT : DEFAULTS.TD_DEF_DEFAULT;

  const diff: FeatureVector = {
    eloDiff: fighterA.elo_rating - fighterB.elo_rating,
    heightDiff: fighterA.height_cm && fighterB.height_cm ? fighterA.height_cm - fighterB.height_cm : 0,
    reachDiff: fighterA.reach_cm && fighterB.reach_cm ? fighterA.reach_cm - fighterB.reach_cm : 0,
    ageDiff: ageA !== null && ageB !== null ? ageA - ageB : 0,
    slpmDiff: slpmA - slpmB,
    sapmDiff: sapmA - sapmB,
    tdAvgDiff: tdAvgA - tdAvgB,
    tdDefDiff: tdDefA - tdDefB,
    streakDiff: formA.streak - formB.streak,
    daysSinceLastFightDiff: daysSinceA - daysSinceB,
    recentOpponentQualityDiff: formA.recentOpponentQuality - formB.recentOpponentQuality,
    stanceMatchup: stanceMatchup(fighterA.stance, fighterB.stance),
  };

  const row = FEATURE_NAMES.map((name) => diff[name]);
  const standardized = standardize(row, normalization);
  const featureProb = predictProb(standardized, model);
  const eloProb = winProbability(fighterA.elo_rating, fighterB.elo_rating);
  const weight = blendWeight(formA.fightCount, formB.fightCount);

  const contributions: FeatureContribution[] = FEATURE_NAMES.map((name, i) => ({
    name,
    diff: diff[name],
    contribution: model.weights[i] * standardized[i],
  }));

  return {
    probability: blendProbability(featureProb, eloProb, weight),
    featureProbA: featureProb,
    contributions,
  };
}
