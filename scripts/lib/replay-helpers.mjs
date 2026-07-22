// Shared helpers for scripts that replay fight history chronologically
// (backfill-elo.mjs, trace-elo.mjs, build-feature-dataset.mjs). Consolidated
// here so all three walk the exact same reconstructed history — if the Elo
// trajectory or per-fight stat lookup drifted between scripts, the feature
// model's "Elo differential" feature would silently disagree with the Elo
// actually stored in the database.
import path from "node:path";
import { parseCsvObjects } from "./csv-parser.mjs";
import { FINISH_MULTIPLIER, TITLE_FIGHT_MULTIPLIER, DOUBLE_CHAMP_MULTIPLIER, decisionMultiplier } from "../../src/lib/elo.ts";

const SEED_FILE = "UFC_full_data_silver_v2.csv";

export const toNum = (s) => (s === "" || s === undefined || s === null ? 0 : Number(s));

export function ufcstatsIdFromUrl(url) {
  return url ? url.split("/").filter(Boolean).pop() : null;
}

// Builds a map from (fighterA ufcstats_id, fighterB ufcstats_id, event name)
// to a queue of raw per-fight stat rows — a queue (not a single value)
// because the same two fighters can legitimately fight twice at the same
// event (see Sakuraba vs. Silveira, UFC - Ultimate Japan, 1997).
export function buildStatsLookup(seedDir) {
  const rows = parseCsvObjects(path.join(seedDir, SEED_FILE));

  const lookup = new Map();
  for (const row of rows) {
    const ufcA = ufcstatsIdFromUrl(row.f_1_fighter_url);
    const ufcB = ufcstatsIdFromUrl(row.f_2_fighter_url);
    const eventName = (row.event_name ?? "").trim().toLowerCase();
    if (!ufcA || !ufcB || !eventName) continue;

    const key = `${ufcA}|${ufcB}|${eventName}`;
    const stats = {
      sigStrikesA: toNum(row.f_1_sig_strikes_succ),
      sigStrikesB: toNum(row.f_2_sig_strikes_succ),
      controlA: toNum(row.f_1_ctrl_time_sec),
      controlB: toNum(row.f_2_ctrl_time_sec),
      takedownsA: toNum(row.f_1_takedown_succ),
      takedownsB: toNum(row.f_2_takedown_succ),
      takedownAttsA: toNum(row.f_1_takedown_att),
      takedownAttsB: toNum(row.f_2_takedown_att),
    };
    if (!lookup.has(key)) lookup.set(key, []);
    lookup.get(key).push(stats);
  }
  return lookup;
}

// Method-of-victory classification straight from the dataset's `result`
// string (stored verbatim as fights.result_method) — ground truth, not a
// heuristic. A handful of fights (DQ, or the ~27 rows the refreshed dataset
// doesn't cover) have no finish/decision signal at all and are treated as a
// neutral-weight win either way.
const FINISH_METHODS = new Set(["KO/TKO", "Submission", "TKO - Doctor's Stoppage"]);
const isFinishMethod = (m) => FINISH_METHODS.has(m);
const isDecisionMethod = (m) => (m ?? "").startsWith("Decision");

function parseClockToSeconds(clock) {
  if (!clock) return null;
  const [min, sec] = clock.split(":").map(Number);
  if (Number.isNaN(min) || Number.isNaN(sec)) return null;
  return min * 60 + sec;
}

// Given a fight row (must include fighter_a_id, fighter_b_id, result_winner_id,
// result_method, result_round, result_time, scheduled_rounds, is_title_fight,
// weight_class, event.name, fighter_a.ufcstats_id, fighter_b.ufcstats_id)
// plus the shared stats lookup and a running titlesWonByFighter map
// (fighterId -> Set<weight_class>, mutated in place), returns the outcome,
// winner/loser Elo multipliers, the raw per-fight stats (if found — used by
// train-feature-model.mjs to accumulate career totals regardless of method),
// and the fight's actual elapsed seconds (ground truth: goes the full
// scheduled distance for a decision, or round/time for a finish). Shared by
// backfill-elo.mjs, trace-elo.mjs, and train-feature-model.mjs so all three
// walk the exact same reconstructed Elo trajectory.
export function resolveFightOutcome(fight, statsLookup, titlesWonByFighter) {
  const {
    fighter_a_id,
    fighter_b_id,
    result_winner_id,
    result_method,
    result_round,
    result_time,
    scheduled_rounds,
    event,
    is_title_fight,
    weight_class,
  } = fight;

  let outcome;
  if (result_winner_id === fighter_a_id) outcome = "a_win";
  else if (result_winner_id === fighter_b_id) outcome = "b_win";
  else if (result_method === "Draw") outcome = "draw";
  else outcome = "nc"; // no rating change, as if the fight didn't happen

  if (outcome === "nc") {
    return { outcome, winnerMultiplier: 1, loserMultiplier: 1, methodLabel: "nc", winnerId: null, rawStats: null, totalFightSeconds: null };
  }

  const scheduledSeconds = (scheduled_rounds ?? 3) * 300;

  // Look up the raw per-fight numbers whenever available, regardless of
  // method — train-feature-model.mjs needs these for career-stat replay
  // (SLpM/SApM/TD rates) on finishes just as much as on decisions.
  const ufcA = fight.fighter_a?.ufcstats_id;
  const ufcB = fight.fighter_b?.ufcstats_id;
  const eventName = event?.name?.trim().toLowerCase();
  const key = ufcA && ufcB && eventName ? `${ufcA}|${ufcB}|${eventName}` : null;
  const queue = key ? statsLookup.get(key) : null;
  const rawStats = queue && queue.length ? queue.shift() : null;

  if (outcome === "draw") {
    return { outcome, winnerMultiplier: 1, loserMultiplier: 1, methodLabel: "draw", winnerId: null, rawStats, totalFightSeconds: scheduledSeconds };
  }

  const winnerId = outcome === "a_win" ? fighter_a_id : fighter_b_id;
  const winnerIsA = outcome === "a_win";

  let winnerMultiplier = 1;
  let loserMultiplier = 1;
  let methodLabel;
  let totalFightSeconds = null;

  if (isFinishMethod(result_method)) {
    winnerMultiplier = FINISH_MULTIPLIER;
    loserMultiplier = 1;
    methodLabel = "finish";
    const elapsedInFinalRound = parseClockToSeconds(result_time);
    if (result_round && elapsedInFinalRound !== null) {
      totalFightSeconds = (result_round - 1) * 300 + elapsedInFinalRound;
    }
  } else if (isDecisionMethod(result_method)) {
    totalFightSeconds = scheduledSeconds;
    if (rawStats) {
      const dm = decisionMultiplier({
        winnerSigStrikes: winnerIsA ? rawStats.sigStrikesA : rawStats.sigStrikesB,
        loserSigStrikes: winnerIsA ? rawStats.sigStrikesB : rawStats.sigStrikesA,
        winnerControlSeconds: winnerIsA ? rawStats.controlA : rawStats.controlB,
        loserControlSeconds: winnerIsA ? rawStats.controlB : rawStats.controlA,
        totalFightSeconds,
      });
      winnerMultiplier = dm;
      loserMultiplier = dm;
      methodLabel = `decision (x${dm.toFixed(2)})`;
    } else {
      methodLabel = "decision (no stats)";
    }
  } else {
    // DQ, or one of the handful of fights the refreshed dataset doesn't
    // cover (no result_method at all) — no finish/dominance signal either
    // way, so a neutral (1x) weight on both sides.
    methodLabel = result_method === "DQ" ? "decision (DQ)" : "decision (no method)";
  }

  if (is_title_fight) {
    winnerMultiplier *= TITLE_FIGHT_MULTIPLIER;
    methodLabel += " +title";
  }

  if (is_title_fight && weight_class) {
    if (!titlesWonByFighter.has(winnerId)) titlesWonByFighter.set(winnerId, new Set());
    titlesWonByFighter.get(winnerId).add(weight_class);
  }

  const titles = titlesWonByFighter.get(winnerId);
  if (titles && titles.size >= 2) {
    winnerMultiplier *= DOUBLE_CHAMP_MULTIPLIER;
    methodLabel += " +2xchamp";
  }

  return { outcome, winnerMultiplier, loserMultiplier, methodLabel, winnerId, rawStats, totalFightSeconds };
}

export async function fetchAll(supabase, table, columns) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
