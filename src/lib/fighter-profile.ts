import { cache } from "react";
import { createClient } from "@/utils/supabase/server";

export type FighterProfile = {
  id: string;
  full_name: string;
  dob: string | null;
  height_cm: number | null;
  reach_cm: number | null;
  stance: string | null;
  weight_class: string | null;
  wins: number;
  losses: number;
  draws: number;
  no_contests: number;
  slpm: number | null;
  sapm: number | null;
  str_acc: number | null;
  str_def: number | null;
  td_avg: number | null;
  td_acc: number | null;
  td_def: number | null;
  sub_avg: number | null;
  elo_rating: number;
};

export type FighterFightHistoryRow = {
  id: string;
  status: string;
  weight_class: string | null;
  is_title_fight: boolean;
  result_method: string | null;
  result_round: number | null;
  result_time: string | null;
  opponent: { id: string; full_name: string } | null;
  winner_id: string | null;
  event: { name: string; date: string } | null;
};

export const getFighterProfile = cache(async (id: string): Promise<FighterProfile | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fighters")
    .select(
      "id, full_name, dob, height_cm, reach_cm, stance, weight_class, wins, losses, draws, no_contests, slpm, sapm, str_acc, str_def, td_avg, td_acc, td_def, sub_avg, elo_rating"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
});

export async function getFighterFightHistory(id: string): Promise<FighterFightHistoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fights")
    .select(
      `
      id, status, weight_class, is_title_fight, result_method, result_round, result_time,
      result_winner_id,
      fighter_a:fighter_a_id ( id, full_name ),
      fighter_b:fighter_b_id ( id, full_name ),
      event:event_id ( name, date )
    `
    )
    .or(`fighter_a_id.eq.${id},fighter_b_id.eq.${id}`)
    .eq("status", "completed");

  if (error) throw error;

  const rows = (data as unknown as Array<{
    id: string;
    status: string;
    weight_class: string | null;
    is_title_fight: boolean;
    result_method: string | null;
    result_round: number | null;
    result_time: string | null;
    result_winner_id: string | null;
    fighter_a: { id: string; full_name: string } | null;
    fighter_b: { id: string; full_name: string } | null;
    event: { name: string; date: string } | null;
  }>) ?? [];

  const mapped: FighterFightHistoryRow[] = rows.map((row) => ({
    id: row.id,
    status: row.status,
    weight_class: row.weight_class,
    is_title_fight: row.is_title_fight,
    result_method: row.result_method,
    result_round: row.result_round,
    result_time: row.result_time,
    opponent: row.fighter_a?.id === id ? row.fighter_b : row.fighter_a,
    winner_id: row.result_winner_id,
    event: row.event,
  }));

  mapped.sort((a, b) => (b.event?.date ?? "").localeCompare(a.event?.date ?? ""));
  return mapped;
}
