// Rankings sync — pulls official UFC.com Pound-for-Pound and per-division
// rankings and writes them onto fighters.p4p_rank / fighters.division_rank.
// Shared by the CLI script (scripts/sync-rankings.mjs) and the Vercel Cron
// route handler (src/app/api/cron/sync-rankings/route.ts), same pattern as
// sync-odds-core.ts.
//
// Unlike ufcstats.com (blocked by a JS proof-of-work wall — see Week 2
// notes), ufc.com/rankings is server-rendered plain HTML (Drupal Views
// markup), so a normal fetch + HTML parse works with no headless browser.
// Each division and the two Pound-for-Pound lists render as a
// `.view-grouping` block: the champion appears separately in the table
// caption (not numbered), and `tbody tr` rows hold the numbered contenders
// (rank + name + profile link). Name matching against our roster reuses
// the same exact -> variant -> last-name-only logic as the odds sync — see
// src/lib/fighter-name-matcher.ts — since UFC.com gives us nothing but a
// plain name string here either.
//
// This only ever reflects the CURRENT rankings snapshot, not history:
// every run clears p4p_rank/division_rank for anyone no longer listed
// (dropped out, retired) rather than leaving stale numbers behind.
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import { buildFighterMatcher, type MatchableFighter } from "./fighter-name-matcher.ts";

const RANKINGS_URL = "https://www.ufc.com/rankings";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type FighterRow = MatchableFighter;

type ParsedEntry = { group: string; rank: number; name: string };

export type RankingsSyncReport = {
  groupsParsed: number;
  entriesParsed: number;
  matched: number;
  cleared: number;
  unmatched: string[];
  variantMatches: string[];
};

function parseRankings(html: string): ParsedEntry[] {
  const $ = cheerio.load(html);
  const entries: ParsedEntry[] = [];

  $(".view-grouping").each((_, el) => {
    const header = $(el).find(".view-grouping-header").first().text().trim();
    if (!header) return;

    $(el)
      .find("tbody tr")
      .each((_, tr) => {
        const rankText = $(tr).find(".views-field-weight-class-rank").first().text().trim();
        const rank = parseInt(rankText, 10);
        const name = $(tr).find(".views-field-title a").first().text().trim();
        if (!Number.isNaN(rank) && name) entries.push({ group: header, rank, name });
      });
  });

  return entries;
}

export async function runRankingsSync(): Promise<RankingsSyncReport> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const res = await fetch(RANKINGS_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`UFC.com rankings request failed: ${res.status}`);
  const html = await res.text();
  const entries = parseRankings(html);

  const report: RankingsSyncReport = {
    groupsParsed: new Set(entries.map((e) => e.group)).size,
    entriesParsed: entries.length,
    matched: 0,
    cleared: 0,
    unmatched: [],
    variantMatches: [],
  };

  if (entries.length === 0) return report;

  async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
    const rows: T[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from(table).select(columns).range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < pageSize) break;
    }
    return rows;
  }

  const fighters = await fetchAll<FighterRow>("fighters", "id, full_name, wins, losses, draws, no_contests");
  const resolveFighterId = buildFighterMatcher(fighters);

  const newP4pByFighterId = new Map<string, number>();
  const newDivisionByFighterId = new Map<string, number>();

  for (const entry of entries) {
    const match = resolveFighterId(entry.name);
    if (!match) {
      report.unmatched.push(`${entry.name} (${entry.group} #${entry.rank})`);
      continue;
    }
    if (match.matchedVia !== "exact") report.variantMatches.push(`"${entry.name}" -> ${match.matchedVia}`);

    if (/pound-for-pound/i.test(entry.group)) {
      newP4pByFighterId.set(match.id, entry.rank);
    } else {
      newDivisionByFighterId.set(match.id, entry.rank);
    }
    report.matched++;
  }

  const currentlyRanked = await fetchAll<{ id: string; p4p_rank: number | null; division_rank: number | null }>(
    "fighters",
    "id, p4p_rank, division_rank"
  );

  const updates: Array<{ id: string; p4p_rank: number | null; division_rank: number | null }> = [];
  for (const f of currentlyRanked) {
    const newP4p = newP4pByFighterId.get(f.id) ?? null;
    const newDivision = newDivisionByFighterId.get(f.id) ?? null;
    if (newP4p !== f.p4p_rank || newDivision !== f.division_rank) {
      updates.push({ id: f.id, p4p_rank: newP4p, division_rank: newDivision });
      if (newP4p === null && newDivision === null) report.cleared++;
    }
  }

  const CONCURRENCY = 25;
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const batch = updates.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (u) => {
        const { error } = await supabase
          .from("fighters")
          .update({ p4p_rank: u.p4p_rank, division_rank: u.division_rank })
          .eq("id", u.id);
        if (error) throw error;
      })
    );
  }

  return report;
}
