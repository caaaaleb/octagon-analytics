// Feature-based model training + backtest — spec Section 2, Layer 2 / Week 4.
//
// Replays fight history chronologically (same order, same Elo trajectory as
// backfill-elo.mjs — shares resolveFightOutcome from replay-helpers.mjs) but
// additionally reconstructs each fighter's POINT-IN-TIME career stats
// (SLpM, SApM, TD avg, TD def, win/loss streak, days since last fight,
// recent-opponent quality) as of just before each historical fight, from
// the raw per-fight numbers in data/seed/UFC_full_data_silver_v2.csv. This is
// deliberately NOT the same as the `fighters` table's current/latest
// snapshot stats — using today's career averages to predict a fight from
// 2015 would leak years of future fights into that prediction and produce
// a dishonestly inflated backtest number.
//
// Fighters with zero prior fights (a true UFC debut) have no real
// slpm/sapm/tdAvg/tdDef data at all; rather than treat that as 0 (implying
// "extremely bad"), those four features fall back to fixed, documented
// ballpark MMA averages (see *_DEFAULT below) — a stated modeling choice,
// not fitted from data. Streak (naturally 0) and recent-opponent quality
// (naturally ELO_DEFAULT) don't need this since their "no history" value is
// already a sensible default.
//
// Model: logistic regression trained natively in TypeScript (src/lib/
// feature-model.ts) — see the project decision to avoid introducing Python/
// XGBoost into an otherwise pure TS stack. Training data is symmetrized
// (every fight contributes both (A,B) and the mirrored (B,A) row) so the
// model can't pick up on arbitrary fighter_a/fighter_b ordering bias, and
// normalization is fit on the TRAIN split only to avoid leaking test-set
// statistics into standardization.
//
// Backtest: chronological 85/15 train/test split (train on the older 85%,
// evaluate on the most recent 15%) — simulates "how would this have done
// on fights it hadn't seen yet", which is what actually matters for live
// predictions. Reports accuracy + Brier score for Elo-only, feature-only,
// and the spec's blended model, and states plainly whether the checkpoint
// (blended beats Elo-only) is met.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ELO_DEFAULT, K_FACTOR, updateElo, winProbability } from "../src/lib/elo.ts";
import { buildStatsLookup, fetchAll as fetchAllShared, resolveFightOutcome } from "./lib/replay-helpers.mjs";
import {
  FEATURE_NAMES,
  fitNormalization,
  standardize,
  trainLogisticRegression,
  predictProb,
  brierScore,
  accuracy,
  blendWeight,
  blendProbability,
} from "../src/lib/feature-model.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "data", "seed");

const SLPM_DEFAULT = 3.5;
const SAPM_DEFAULT = 3.5;
const TD_AVG_DEFAULT = 1.5;
const TD_DEF_DEFAULT = 0.6;
const DAYS_SINCE_DEFAULT = 180;
const TRAIN_FRACTION = 0.85;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const fetchAll = (table, columns) => fetchAllShared(supabase, table, columns);

function ageAt(dob, fightDate) {
  if (!dob || !fightDate) return null;
  const ms = new Date(fightDate).getTime() - new Date(dob).getTime();
  return ms / (1000 * 60 * 60 * 24 * 365.25);
}

function newFighterState() {
  return {
    totalSeconds: 0,
    sigStrikesLanded: 0,
    sigStrikesAbsorbed: 0,
    takedownsLanded: 0,
    oppTakedownsLandedAgainst: 0,
    oppTakedownAttsAgainst: 0,
    fightCount: 0,
    streak: 0,
    lastFightDate: null,
    recentOpponentElos: [],
  };
}

function pointInTimeStats(state) {
  const minutes = state.totalSeconds / 60;
  return {
    slpm: minutes > 0 ? state.sigStrikesLanded / minutes : SLPM_DEFAULT,
    sapm: minutes > 0 ? state.sigStrikesAbsorbed / minutes : SAPM_DEFAULT,
    tdAvg: minutes > 0 ? state.takedownsLanded / (minutes / 15) : TD_AVG_DEFAULT,
    tdDef:
      state.oppTakedownAttsAgainst > 0
        ? 1 - state.oppTakedownsLandedAgainst / state.oppTakedownAttsAgainst
        : TD_DEF_DEFAULT,
    fightCount: state.fightCount,
    streak: state.streak,
    // daysSinceLastFight is computed by the caller against the actual fight
    // date, not here — this function has no access to "the current fight's
    // date", only the fighter's running state.
    recentOpponentQuality: state.recentOpponentElos.length
      ? state.recentOpponentElos.reduce((s, e) => s + e, 0) / state.recentOpponentElos.length
      : ELO_DEFAULT,
  };
}

function stanceMatchup(stanceA, stanceB) {
  const a = (stanceA ?? "").toLowerCase();
  const b = (stanceB ?? "").toLowerCase();
  if (a === "southpaw" && b === "orthodox") return 1;
  if (a === "orthodox" && b === "southpaw") return -1;
  return 0;
}

async function main() {
  console.log("Building stats lookup from seed CSV...");
  const statsLookup = buildStatsLookup(SEED_DIR);

  console.log("Fetching fighters and fights...");
  const fighterRows = await fetchAll("fighters", "id, dob, height_cm, reach_cm, stance");
  const fighterInfo = new Map(fighterRows.map((f) => [f.id, f]));

  const fights = await fetchAll(
    "fights",
    `id, fighter_a_id, fighter_b_id, result_winner_id, result_method, result_round, result_time, scheduled_rounds, status,
     is_title_fight, weight_class,
     fighter_a:fighter_a_id(ufcstats_id), fighter_b:fighter_b_id(ufcstats_id), event:event_id(date, name)`
  );

  const completed = fights.filter((f) => f.status === "completed");
  completed.sort((a, b) => {
    const dateCompare = (a.event?.date ?? "").localeCompare(b.event?.date ?? "");
    if (dateCompare !== 0) return dateCompare;
    return a.id.localeCompare(b.id);
  });

  console.log(`${completed.length} completed fights to replay.`);

  const ratings = new Map(fighterRows.map((f) => [f.id, ELO_DEFAULT]));
  const states = new Map(fighterRows.map((f) => [f.id, newFighterState()]));
  const titlesWonByFighter = new Map();

  const records = []; // one per fight: { diff: number[], label, eloA, eloB, fightCountA, fightCountB }
  let skippedDraws = 0;
  let skippedNoContest = 0;

  for (const fight of completed) {
    const { fighter_a_id, fighter_b_id, event } = fight;
    if (!ratings.has(fighter_a_id) || !ratings.has(fighter_b_id)) continue;

    const { outcome, winnerMultiplier, loserMultiplier, rawStats, totalFightSeconds } = resolveFightOutcome(
      fight,
      statsLookup,
      titlesWonByFighter
    );

    if (outcome === "nc") {
      skippedNoContest++;
      continue;
    }

    const eloA = ratings.get(fighter_a_id);
    const eloB = ratings.get(fighter_b_id);
    const stateA = states.get(fighter_a_id);
    const stateB = states.get(fighter_b_id);
    const infoA = fighterInfo.get(fighter_a_id) ?? {};
    const infoB = fighterInfo.get(fighter_b_id) ?? {};
    const fightDate = event?.date;

    const ptA = pointInTimeStats(stateA);
    const ptB = pointInTimeStats(stateB);
    const daysSinceA = stateA.lastFightDate
      ? (new Date(fightDate).getTime() - new Date(stateA.lastFightDate).getTime()) / (1000 * 60 * 60 * 24)
      : DAYS_SINCE_DEFAULT;
    const daysSinceB = stateB.lastFightDate
      ? (new Date(fightDate).getTime() - new Date(stateB.lastFightDate).getTime()) / (1000 * 60 * 60 * 24)
      : DAYS_SINCE_DEFAULT;

    const ageA = ageAt(infoA.dob, fightDate);
    const ageB = ageAt(infoB.dob, fightDate);

    const diff = {
      eloDiff: eloA - eloB,
      heightDiff: infoA.height_cm && infoB.height_cm ? infoA.height_cm - infoB.height_cm : 0,
      reachDiff: infoA.reach_cm && infoB.reach_cm ? infoA.reach_cm - infoB.reach_cm : 0,
      ageDiff: ageA !== null && ageB !== null ? ageA - ageB : 0,
      slpmDiff: ptA.slpm - ptB.slpm,
      sapmDiff: ptA.sapm - ptB.sapm,
      tdAvgDiff: ptA.tdAvg - ptB.tdAvg,
      tdDefDiff: ptA.tdDef - ptB.tdDef,
      streakDiff: ptA.streak - ptB.streak,
      daysSinceLastFightDiff: daysSinceA - daysSinceB,
      recentOpponentQualityDiff: ptA.recentOpponentQuality - ptB.recentOpponentQuality,
      stanceMatchup: stanceMatchup(infoA.stance, infoB.stance),
    };

    if (outcome === "draw") {
      skippedDraws++;
    } else {
      records.push({
        diff: FEATURE_NAMES.map((n) => diff[n]),
        label: outcome === "a_win" ? 1 : 0,
        eloA,
        eloB,
        fightCountA: stateA.fightCount,
        fightCountB: stateB.fightCount,
        date: fightDate,
      });
    }

    // Update Elo (identical to backfill-elo.mjs).
    const updated = updateElo(eloA, eloB, outcome, K_FACTOR, { winnerMultiplier, loserMultiplier });
    ratings.set(fighter_a_id, updated.ratingA);
    ratings.set(fighter_b_id, updated.ratingB);

    // Update rolling stats state (skip granular strike/TD contribution for
    // fights not covered by the dataset — see resolveFightOutcome).
    if (rawStats && totalFightSeconds) {
      stateA.totalSeconds += totalFightSeconds;
      stateB.totalSeconds += totalFightSeconds;
      stateA.sigStrikesLanded += rawStats.sigStrikesA;
      stateB.sigStrikesLanded += rawStats.sigStrikesB;
      stateA.sigStrikesAbsorbed += rawStats.sigStrikesB;
      stateB.sigStrikesAbsorbed += rawStats.sigStrikesA;
      stateA.takedownsLanded += rawStats.takedownsA;
      stateB.takedownsLanded += rawStats.takedownsB;
      stateA.oppTakedownsLandedAgainst += rawStats.takedownsB;
      stateA.oppTakedownAttsAgainst += rawStats.takedownAttsB;
      stateB.oppTakedownsLandedAgainst += rawStats.takedownsA;
      stateB.oppTakedownAttsAgainst += rawStats.takedownAttsA;
    }

    if (outcome === "a_win") {
      stateA.streak = stateA.streak >= 0 ? stateA.streak + 1 : 1;
      stateB.streak = stateB.streak <= 0 ? stateB.streak - 1 : -1;
    } else if (outcome === "b_win") {
      stateB.streak = stateB.streak >= 0 ? stateB.streak + 1 : 1;
      stateA.streak = stateA.streak <= 0 ? stateA.streak - 1 : -1;
    } else {
      stateA.streak = 0;
      stateB.streak = 0;
    }

    stateA.recentOpponentElos.push(eloB);
    stateB.recentOpponentElos.push(eloA);
    if (stateA.recentOpponentElos.length > 3) stateA.recentOpponentElos.shift();
    if (stateB.recentOpponentElos.length > 3) stateB.recentOpponentElos.shift();

    stateA.lastFightDate = fightDate;
    stateB.lastFightDate = fightDate;
    stateA.fightCount += 1;
    stateB.fightCount += 1;
  }

  console.log(`Training records: ${records.length} decisive fights (skipped ${skippedDraws} draws, ${skippedNoContest} no-contests).`);

  // Chronological split — train on the older fights, backtest on the most
  // recent slice, so evaluation simulates predicting fights the model
  // hasn't seen, not fights it trained on.
  const splitIndex = Math.floor(records.length * TRAIN_FRACTION);
  const trainRecords = records.slice(0, splitIndex);
  const testRecords = records.slice(splitIndex);
  console.log(`Train: ${trainRecords.length} fights (up to ${trainRecords.at(-1)?.date}), Test: ${testRecords.length} fights (from ${testRecords[0]?.date} to ${testRecords.at(-1)?.date}).`);

  function symmetrize(recs) {
    const X = [];
    const y = [];
    const meta = [];
    for (const r of recs) {
      X.push(r.diff);
      y.push(r.label);
      meta.push({ eloA: r.eloA, eloB: r.eloB, fightCountA: r.fightCountA, fightCountB: r.fightCountB });

      X.push(r.diff.map((v) => -v));
      y.push(1 - r.label);
      meta.push({ eloA: r.eloB, eloB: r.eloA, fightCountA: r.fightCountB, fightCountB: r.fightCountA });
    }
    return { X, y, meta };
  }

  const train = symmetrize(trainRecords);
  const test = symmetrize(testRecords);

  const norm = fitNormalization(train.X);
  const trainXStd = train.X.map((row) => standardize(row, norm));
  const testXStd = test.X.map((row) => standardize(row, norm));

  console.log("Training logistic regression...");
  const model = trainLogisticRegression(trainXStd, train.y);

  console.log("\nFeature weights (standardized scale):");
  FEATURE_NAMES.forEach((name, i) => console.log(`  ${name}: ${model.weights[i].toFixed(4)}`));
  console.log(`  intercept: ${model.intercept.toFixed(4)}`);

  const featureProbs = testXStd.map((row) => predictProb(row, model));
  const eloProbs = test.meta.map((m) => winProbability(m.eloA, m.eloB));
  const blendedProbs = test.meta.map((m, i) =>
    blendProbability(featureProbs[i], eloProbs[i], blendWeight(m.fightCountA, m.fightCountB))
  );

  console.log("\n=== Backtest (held-out most recent fights) ===");
  for (const [label, probs] of [
    ["Elo-only", eloProbs],
    ["Feature-only", featureProbs],
    ["Blended (spec formula)", blendedProbs],
  ]) {
    console.log(
      `${label.padEnd(24)} accuracy: ${(accuracy(probs, test.y) * 100).toFixed(2)}%  Brier: ${brierScore(probs, test.y).toFixed(4)}`
    );
  }

  const eloAcc = accuracy(eloProbs, test.y);
  const blendedAcc = accuracy(blendedProbs, test.y);
  console.log(
    blendedAcc > eloAcc
      ? `\nCheckpoint MET: blended model (${(blendedAcc * 100).toFixed(2)}%) beats Elo-only baseline (${(eloAcc * 100).toFixed(2)}%).`
      : `\nCheckpoint NOT met: blended model (${(blendedAcc * 100).toFixed(2)}%) does not beat Elo-only baseline (${(eloAcc * 100).toFixed(2)}%). Per spec, iterate before moving on.`
  );

  const outDir = path.join(__dirname, "..", "src", "lib", "model-weights");
  mkdirSync(outDir, { recursive: true });
  const artifact = {
    modelVersion: "feature-v1",
    trainedAt: new Date().toISOString(),
    featureNames: FEATURE_NAMES,
    weights: model.weights,
    intercept: model.intercept,
    normalization: norm,
    defaults: { SLPM_DEFAULT, SAPM_DEFAULT, TD_AVG_DEFAULT, TD_DEF_DEFAULT, DAYS_SINCE_DEFAULT },
    trainCount: train.X.length,
    testCount: test.X.length,
    backtest: {
      eloOnly: { accuracy: eloAcc, brier: brierScore(eloProbs, test.y) },
      featureOnly: { accuracy: accuracy(featureProbs, test.y), brier: brierScore(featureProbs, test.y) },
      blended: { accuracy: blendedAcc, brier: brierScore(blendedProbs, test.y) },
    },
  };
  const outPath = path.join(outDir, "feature-v1.json");
  writeFileSync(outPath, JSON.stringify(artifact, null, 2));
  console.log(`\nSaved model artifact to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
