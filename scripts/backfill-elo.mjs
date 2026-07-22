// Elo backfill — spec Section 2, Layer 1 / Week 3.
// Replays every completed fight in chronological order, computing each
// fighter's Elo rating from scratch (ignores whatever's currently stored;
// this is a full deterministic replay, not an incremental update), then
// writes the final ratings to fighters.elo_rating.
//
// Method-of-victory weighting, title-fight/double-champ bonuses, and the
// stats-lookup/multiplier logic all live in scripts/lib/replay-helpers.mjs
// (resolveFightOutcome) — shared with trace-elo.mjs and
// train-feature-model.mjs so all three walk the exact same reconstructed
// Elo trajectory.
//
// Known limitation: fights are ordered by (event date, row insertion order)
// as a proxy for actual card order. That's exact for modern events (one
// fight per fighter per card) but approximate for early-UFC tournament
// cards where a fighter could fight multiple times in one night — bout
// sequence within those cards isn't stored anywhere in this schema.
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ELO_DEFAULT, K_FACTOR, updateElo } from "../src/lib/elo.ts";
import { buildStatsLookup, fetchAll as fetchAllShared, resolveFightOutcome } from "./lib/replay-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "data", "seed");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const fetchAll = (table, columns) => fetchAllShared(supabase, table, columns);

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log("Building method/dominance lookup from the seed CSV...");
  const statsLookup = buildStatsLookup(SEED_DIR);

  console.log("Fetching fighters and fights...");
  const fighters = await fetchAll("fighters", "id");
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

  console.log(`${completed.length} completed fights to replay (of ${fights.length} total).`);

  const ratings = new Map(fighters.map((f) => [f.id, ELO_DEFAULT]));
  const titlesWonByFighter = new Map(); // fighterId -> Set<weight_class>

  let applied = 0;
  let skippedNoContest = 0;
  let skippedUnresolved = 0;
  let finishes = 0;
  let decisions = 0;
  let titleBonusesApplied = 0;
  let doubleChampBonusesApplied = 0;

  for (const fight of completed) {
    const { fighter_a_id, fighter_b_id } = fight;
    if (!ratings.has(fighter_a_id) || !ratings.has(fighter_b_id)) {
      skippedUnresolved++;
      continue;
    }

    const { outcome, winnerMultiplier, loserMultiplier, methodLabel } = resolveFightOutcome(
      fight,
      statsLookup,
      titlesWonByFighter
    );

    if (outcome === "nc") {
      skippedNoContest++;
      continue;
    }
    if (methodLabel.startsWith("finish")) finishes++;
    else if (methodLabel.startsWith("decision")) decisions++;
    if (methodLabel.includes("+title")) titleBonusesApplied++;
    if (methodLabel.includes("+2xchamp")) doubleChampBonusesApplied++;

    const ratingA = ratings.get(fighter_a_id);
    const ratingB = ratings.get(fighter_b_id);
    const updated = updateElo(ratingA, ratingB, outcome, K_FACTOR, { winnerMultiplier, loserMultiplier });
    ratings.set(fighter_a_id, updated.ratingA);
    ratings.set(fighter_b_id, updated.ratingB);
    applied++;
  }

  console.log(
    `Applied: ${applied} (finishes: ${finishes}, decisions: ${decisions}), ` +
    `title bonuses: ${titleBonusesApplied}, double-champ bonuses: ${doubleChampBonusesApplied}, ` +
    `skipped (no contest / unresolved result): ${skippedNoContest}, skipped (unresolved fighter): ${skippedUnresolved}`
  );
  console.log("Writing ratings back to the fighters table...");

  const entries = Array.from(ratings.entries());
  const CONCURRENCY = 25;
  let written = 0;
  for (const batch of chunk(entries, CONCURRENCY)) {
    await Promise.all(
      batch.map(async ([id, elo_rating]) => {
        const { error } = await supabase
          .from("fighters")
          .update({ elo_rating: Math.round(elo_rating * 100) / 100 })
          .eq("id", id);
        if (error) console.warn(`Failed to update ${id}:`, error.message);
        else written++;
      })
    );
  }

  console.log(`Wrote ${written} / ${entries.length} ratings.`);

  const { data: top, error: topErr } = await supabase
    .from("fighters")
    .select("full_name, elo_rating, wins, losses")
    .order("elo_rating", { ascending: false })
    .limit(10);
  if (topErr) throw topErr;
  console.log("\nTop 10 by Elo:");
  top.forEach((f, i) => console.log(`${i + 1}. ${f.full_name} — ${f.elo_rating} (${f.wins}-${f.losses})`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
