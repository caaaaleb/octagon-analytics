// Import / refresh from the current seed dataset: UFC_full_data_silver_v2.csv
// (one denormalized row per fight, fighter snapshot columns duplicated on
// every row that fighter appears in). Unlike the original three-file import,
// this is a true UPSERT — existing fighters/events/fights are updated with
// fresh values from this file, not just skipped. That's deliberate: this
// dataset is a fresher pull than what's currently in the DB, so stale stats
// (fighter records, win/loss counts, missing result method/round/time) should
// be overwritten, not left alone.
//
// Fighters and fights from the OLD dataset that aren't present in this file
// are left untouched — this file doesn't cover every fighter/event the old
// one did (2.7k fighters here vs ~4.3k already in the DB), so this is a
// refresh of overlapping data plus new rows, not a full replacement.
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseCsvObjects } from "./lib/csv-parser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "data", "seed");
const CSV_FILE = path.join(SEED_DIR, "UFC_full_data_silver_v2.csv");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const report = {
  fighters: { snapshots: 0, updated: 0, inserted: 0 },
  events: { seen: 0, updated: 0, inserted: 0 },
  fights: { parsed: 0, updated: 0, inserted: 0, unresolved: 0, roundsFallback: 0, draws: 0, noContests: 0 },
  dateRange: { earliest: null, latest: null },
};

const num = (s) => (s === "" || s === undefined || s === null ? null : Number(s));
const str = (s) => (s === "" || s === undefined || s === null ? null : s);

function ufcstatsIdFromUrl(url) {
  if (!url) return null;
  return url.split("/").filter(Boolean).pop();
}

function normalizeStance(s) {
  const v = (s || "").trim().toLowerCase();
  return ["orthodox", "southpaw", "switch"].includes(v) ? v : null;
}

function eventLocation(row) {
  const parts = [row.event_city, row.event_state, row.event_country].map((p) => (p || "").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// scheduled_rounds has a DB check constraint of (3, 5). Old-era UFC events
// (1-2 round fights, no standard format) and 31 blank rows need a fallback —
// same heuristic as the original import: 5 for a title fight, 3 otherwise.
function scheduledRounds(numRoundsRaw, isTitleFight) {
  const n = num(numRoundsRaw);
  if (n === 3 || n === 5) return { rounds: n, fallback: false };
  return { rounds: isTitleFight ? 5 : 3, fallback: true };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Runs `fn` over `items` with bounded concurrency, for per-row updates that
// can't be batched into a single insert/upsert call.
async function runConcurrent(items, concurrency, fn) {
  let done = 0;
  for (const batch of chunk(items, concurrency)) {
    await Promise.all(batch.map(fn));
    done += batch.length;
  }
  return done;
}

async function fetchAll(table, columns) {
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

async function main() {
  const rows = parseCsvObjects(CSV_FILE);
  report.fights.parsed = rows.length;

  for (const row of rows) {
    if (!row.event_date) continue;
    if (!report.dateRange.earliest || row.event_date < report.dateRange.earliest) report.dateRange.earliest = row.event_date;
    if (!report.dateRange.latest || row.event_date > report.dateRange.latest) report.dateRange.latest = row.event_date;
  }

  // ---------- Fighters: collapse to one latest snapshot per fighter ----------
  // Fighter stat columns are a static "current as of scrape" snapshot
  // duplicated on every row that fighter appears in, not point-in-time — so
  // take the row with the latest event_date per fighter as their freshest data.
  const snapshotByUfcstatsId = new Map();
  for (const row of rows) {
    for (const side of ["f_1", "f_2"]) {
      const url = row[`${side}_fighter_url`];
      const ufcstatsId = ufcstatsIdFromUrl(url);
      if (!ufcstatsId) continue;
      const existing = snapshotByUfcstatsId.get(ufcstatsId);
      if (existing && existing.event_date >= row.event_date) continue;
      snapshotByUfcstatsId.set(ufcstatsId, {
        event_date: row.event_date,
        full_name: row[`${side}_name`],
        dob: row[`${side}_fighter_dob`],
        height_cm: row[`${side}_fighter_height_cm`],
        reach_cm: row[`${side}_fighter_reach_cm`],
        stance: row[`${side}_fighter_stance`],
        weight_class: row.weight_class,
        wins: row[`${side}_fighter_w`],
        losses: row[`${side}_fighter_l`],
        draws: row[`${side}_fighter_d`],
        no_contests: row[`${side}_fighter_nc_dq`],
        slpm: row[`${side}_fighter_SlpM`],
        sapm: row[`${side}_fighter_SApM`],
        str_acc: row[`${side}_fighter_Str_Acc`],
        str_def: row[`${side}_fighter_Str_Def`],
        td_avg: row[`${side}_fighter_TD_Avg`],
        td_acc: row[`${side}_fighter_TD_Acc`],
        td_def: row[`${side}_fighter_TD_Def`],
        sub_avg: row[`${side}_fighter_Sub_Avg`],
      });
    }
  }
  report.fighters.snapshots = snapshotByUfcstatsId.size;
  console.log(`Fighters: ${snapshotByUfcstatsId.size} distinct fighters in this file.`);

  const existingFighters = await fetchAll("fighters", "id, full_name, ufcstats_id");
  const fighterByUfcstatsId = new Map(existingFighters.filter((f) => f.ufcstats_id).map((f) => [f.ufcstats_id, f]));
  const fighterByName = new Map(existingFighters.map((f) => [f.full_name.trim().toLowerCase(), f]));

  const fighterIdMap = new Map(); // ufcstats_id -> db uuid
  const fighterUpdates = [];
  const fighterInserts = [];

  for (const [ufcstatsId, snap] of snapshotByUfcstatsId) {
    const fields = {
      dob: str(snap.dob),
      height_cm: num(snap.height_cm),
      reach_cm: num(snap.reach_cm),
      stance: normalizeStance(snap.stance),
      weight_class: str(snap.weight_class),
      wins: num(snap.wins) ?? 0,
      losses: num(snap.losses) ?? 0,
      draws: num(snap.draws) ?? 0,
      no_contests: Math.round(num(snap.no_contests) ?? 0),
      slpm: num(snap.slpm),
      sapm: num(snap.sapm),
      str_acc: num(snap.str_acc),
      str_def: num(snap.str_def),
      td_avg: num(snap.td_avg),
      td_acc: num(snap.td_acc),
      td_def: num(snap.td_def),
      sub_avg: num(snap.sub_avg),
    };

    const matchByUfcId = fighterByUfcstatsId.get(ufcstatsId);
    const matchByName = matchByUfcId ? null : fighterByName.get(snap.full_name.trim().toLowerCase());
    const match = matchByUfcId ?? matchByName;

    if (match) {
      fighterIdMap.set(ufcstatsId, match.id);
      fighterUpdates.push({
        id: match.id,
        // Backfill ufcstats_id for name-matched rows (e.g. Week 1 manual
        // entries) that didn't have one yet.
        fields: matchByUfcId ? fields : { ...fields, ufcstats_id: ufcstatsId },
      });
    } else {
      fighterInserts.push({ __ufcstatsId: ufcstatsId, full_name: snap.full_name, ufcstats_id: ufcstatsId, ...fields });
    }
  }

  console.log(`Fighters: ${fighterUpdates.length} to update, ${fighterInserts.length} to insert.`);

  report.fighters.updated = await runConcurrent(fighterUpdates, 25, async (u) => {
    const { error } = await supabase.from("fighters").update(u.fields).eq("id", u.id);
    if (error) console.warn(`Fighter update failed for ${u.id}:`, error.message);
  });

  for (const batch of chunk(fighterInserts, 500)) {
    const payload = batch.map(({ __ufcstatsId, ...rest }) => rest);
    const { data, error } = await supabase.from("fighters").insert(payload).select("id, ufcstats_id");
    if (error) throw error;
    data.forEach((row) => fighterIdMap.set(row.ufcstats_id, row.id));
    report.fighters.inserted += data.length;
  }

  // ---------- Events ----------
  const eventByUrl = new Map(); // event_url -> row (first occurrence has everything we need)
  for (const row of rows) {
    if (!eventByUrl.has(row.event_url)) eventByUrl.set(row.event_url, row);
  }
  report.events.seen = eventByUrl.size;

  const existingEvents = await fetchAll("events", "id, name, location");
  const eventByName = new Map(existingEvents.map((e) => [e.name.trim().toLowerCase(), e]));

  const eventUrlMap = new Map(); // event_url -> db uuid
  const eventLocationUpdates = [];
  const eventInserts = [];

  for (const [url, row] of eventByUrl) {
    const nameKey = row.event_name.trim().toLowerCase();
    const existing = eventByName.get(nameKey);
    if (existing) {
      eventUrlMap.set(url, existing.id);
      if (!existing.location) {
        const location = eventLocation(row);
        if (location) eventLocationUpdates.push({ id: existing.id, location });
      }
      continue;
    }
    eventInserts.push({
      __url: url,
      name: row.event_name,
      date: row.event_date,
      location: eventLocation(row),
      is_ppv: /^ufc \d+:/i.test(row.event_name),
    });
  }

  console.log(`Events: ${eventInserts.length} to insert, ${eventLocationUpdates.length} location backfills.`);

  report.events.updated = await runConcurrent(eventLocationUpdates, 25, async (u) => {
    const { error } = await supabase.from("events").update({ location: u.location }).eq("id", u.id);
    if (error) console.warn(`Event location update failed for ${u.id}:`, error.message);
  });

  for (const batch of chunk(eventInserts, 500)) {
    const payload = batch.map(({ __url, ...rest }) => rest);
    const { data, error } = await supabase.from("events").insert(payload).select("id");
    if (error) throw error;
    data.forEach((row, i) => eventUrlMap.set(batch[i].__url, row.id));
    report.events.inserted += data.length;
  }

  // ---------- Fights ----------
  // Match existing fights by (event, unordered fighter pair) so real result
  // data replaces the old nulls/heuristics instead of duplicating rows. A
  // pair can legitimately fight twice at the same event (rematches on one
  // card), so each key holds a queue, consumed in file order.
  const existingFights = await fetchAll("fights", "id, event_id, fighter_a_id, fighter_b_id");
  const fightQueueByKey = new Map();
  const pairKey = (eventId, a, b) => `${eventId}|${[a, b].sort().join("|")}`;
  for (const f of existingFights) {
    const key = pairKey(f.event_id, f.fighter_a_id, f.fighter_b_id);
    if (!fightQueueByKey.has(key)) fightQueueByKey.set(key, []);
    fightQueueByKey.get(key).push(f);
  }

  const fightUpdates = [];
  const fightInserts = [];

  for (const row of rows) {
    const fighterAId = fighterIdMap.get(ufcstatsIdFromUrl(row.f_1_fighter_url));
    const fighterBId = fighterIdMap.get(ufcstatsIdFromUrl(row.f_2_fighter_url));
    const eventId = eventUrlMap.get(row.event_url);

    if (!fighterAId || !fighterBId || !eventId) {
      report.fights.unresolved++;
      continue;
    }

    const isTitleFight = row.title_fight === "True";
    const { rounds, fallback } = scheduledRounds(row.num_rounds, isTitleFight);
    if (fallback) report.fights.roundsFallback++;

    const winnerName = row.winner.trim();
    let resultWinnerId = null;
    let resultMethod = row.result;

    if (winnerName && winnerName === row.f_1_name.trim()) {
      resultWinnerId = fighterAId;
    } else if (winnerName && winnerName === row.f_2_name.trim()) {
      resultWinnerId = fighterBId;
    } else {
      // Blank winner: a decision with no winner is a draw; anything else
      // (Overturned, Could Not Continue, Other) is a no contest.
      if (/^decision/i.test(row.result)) {
        resultMethod = "Draw";
        report.fights.draws++;
      } else {
        resultMethod = "No Contest";
        report.fights.noContests++;
      }
    }

    const fields = {
      weight_class: str(row.weight_class),
      is_title_fight: isTitleFight,
      scheduled_rounds: rounds,
      result_winner_id: resultWinnerId,
      result_method: str(resultMethod),
      result_round: num(row.finish_round),
      result_time: str(row.finish_time),
      status: "completed",
    };

    const key = pairKey(eventId, fighterAId, fighterBId);
    const queue = fightQueueByKey.get(key);
    const existingFight = queue && queue.length ? queue.shift() : null;

    if (existingFight) {
      fightUpdates.push({ id: existingFight.id, fields });
    } else {
      fightInserts.push({ event_id: eventId, fighter_a_id: fighterAId, fighter_b_id: fighterBId, ...fields });
    }
  }

  console.log(`Fights: ${fightUpdates.length} to update, ${fightInserts.length} to insert, ${report.fights.unresolved} unresolved.`);

  report.fights.updated = await runConcurrent(fightUpdates, 25, async (u) => {
    const { error } = await supabase.from("fights").update(u.fields).eq("id", u.id);
    if (error) console.warn(`Fight update failed for ${u.id}:`, error.message);
  });

  for (const batch of chunk(fightInserts, 500)) {
    const { data, error } = await supabase.from("fights").insert(batch).select("id");
    if (error) throw error;
    report.fights.inserted += data.length;
  }

  console.log("\n=== Import report ===");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
