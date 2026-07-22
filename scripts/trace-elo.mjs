// Diagnostic: replays the full fight history exactly like backfill-elo.mjs,
// but prints a fight-by-fight ledger for the named fighters instead of just
// writing final ratings. Read-only — does not touch the database. Uses the
// same shared resolveFightOutcome as backfill-elo.mjs (rather than a
// duplicated copy) so there's no risk of the two drifting apart.
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ELO_DEFAULT, K_FACTOR, updateElo } from "../src/lib/elo.ts";
import { buildStatsLookup, fetchAll as fetchAllShared, resolveFightOutcome } from "./lib/replay-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "data", "seed");
const TARGET_NAMES = process.argv.slice(2).map((n) => n.toLowerCase());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const fetchAll = (table, columns) => fetchAllShared(supabase, table, columns);

async function main() {
  const statsLookup = buildStatsLookup(SEED_DIR);
  const fighters = await fetchAll("fighters", "id, full_name");
  const fights = await fetchAll(
    "fights",
    `id, fighter_a_id, fighter_b_id, result_winner_id, result_method, result_round, result_time, scheduled_rounds, status,
     is_title_fight, weight_class,
     fighter_a:fighter_a_id(ufcstats_id, full_name), fighter_b:fighter_b_id(ufcstats_id, full_name), event:event_id(date, name)`
  );

  const completed = fights.filter((f) => f.status === "completed");
  completed.sort((a, b) => {
    const dateCompare = (a.event?.date ?? "").localeCompare(b.event?.date ?? "");
    if (dateCompare !== 0) return dateCompare;
    return a.id.localeCompare(b.id);
  });

  const ratings = new Map(fighters.map((f) => [f.id, ELO_DEFAULT]));
  const nameById = new Map(fighters.map((f) => [f.id, f.full_name]));
  const titlesWonByFighter = new Map();
  const targetIds = new Set(
    fighters.filter((f) => TARGET_NAMES.includes(f.full_name.toLowerCase())).map((f) => f.id)
  );

  const ledgers = new Map(Array.from(targetIds).map((id) => [id, []]));

  for (const fight of completed) {
    const { fighter_a_id, fighter_b_id, event } = fight;
    if (!ratings.has(fighter_a_id) || !ratings.has(fighter_b_id)) continue;

    const { outcome, winnerMultiplier, loserMultiplier, methodLabel } = resolveFightOutcome(
      fight,
      statsLookup,
      titlesWonByFighter
    );
    if (outcome === "nc") continue;

    const ratingA = ratings.get(fighter_a_id);
    const ratingB = ratings.get(fighter_b_id);
    const updated = updateElo(ratingA, ratingB, outcome, K_FACTOR, { winnerMultiplier, loserMultiplier });

    if (targetIds.has(fighter_a_id)) {
      const opponent = nameById.get(fighter_b_id);
      const result = outcome === "a_win" ? "WIN" : outcome === "b_win" ? "LOSS" : "DRAW";
      ledgers.get(fighter_a_id).push({
        date: event?.date,
        opponent,
        opponentRating: ratingB.toFixed(0),
        result,
        method: methodLabel,
        before: ratingA.toFixed(1),
        after: updated.ratingA.toFixed(1),
        delta: (updated.ratingA - ratingA).toFixed(1),
      });
    }
    if (targetIds.has(fighter_b_id)) {
      const opponent = nameById.get(fighter_a_id);
      const result = outcome === "b_win" ? "WIN" : outcome === "a_win" ? "LOSS" : "DRAW";
      ledgers.get(fighter_b_id).push({
        date: event?.date,
        opponent,
        opponentRating: ratingA.toFixed(0),
        result,
        method: methodLabel,
        before: ratingB.toFixed(1),
        after: updated.ratingB.toFixed(1),
        delta: (updated.ratingB - ratingB).toFixed(1),
      });
    }

    ratings.set(fighter_a_id, updated.ratingA);
    ratings.set(fighter_b_id, updated.ratingB);
  }

  for (const [id, ledger] of ledgers) {
    console.log(`\n=== ${nameById.get(id)} — final Elo ${ratings.get(id).toFixed(1)} ===`);
    for (const row of ledger) {
      console.log(
        `${row.date} | vs ${row.opponent.padEnd(25)} (opp rating ~${row.opponentRating}) | ${row.result.padEnd(4)} ${row.method.padEnd(28)} | ${row.before} -> ${row.after} (${row.delta >= 0 ? "+" : ""}${row.delta})`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
