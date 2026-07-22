import { createClient } from "@/utils/supabase/server";

export type FightWithDetails = {
  id: string;
  weight_class: string | null;
  is_title_fight: boolean;
  scheduled_rounds: number;
  status: string;
  result_method: string | null;
  result_round: number | null;
  result_time: string | null;
  fighter_a: { id: string; full_name: string; wins: number; losses: number; draws: number } | null;
  fighter_b: { id: string; full_name: string; wins: number; losses: number; draws: number } | null;
  winner: { id: string; full_name: string } | null;
  event: { name: string; date: string; location: string | null } | null;
};

// Scoped to the single most recent event rather than the whole fights table —
// with the historical dataset loaded (7,800+ fights), an unbounded query here
// pulls every fight in UFC history on every page load. The real "upcoming
// card" page (spec Section 6 Step 1.5) replaces this once odds are wired up
// in Week 3; this just keeps the Week 1/2 pipeline-check page responsive.
export async function getFights(): Promise<FightWithDetails[]> {
  const supabase = await createClient();

  const { data: latestEvent, error: eventError } = await supabase
    .from("events")
    .select("id")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (eventError) throw eventError;
  if (!latestEvent) return [];

  const { data, error } = await supabase
    .from("fights")
    .select(
      `
      id,
      weight_class,
      is_title_fight,
      scheduled_rounds,
      status,
      result_method,
      result_round,
      result_time,
      fighter_a:fighter_a_id ( id, full_name, wins, losses, draws ),
      fighter_b:fighter_b_id ( id, full_name, wins, losses, draws ),
      winner:result_winner_id ( id, full_name ),
      event:event_id ( name, date, location )
    `
    )
    .eq("event_id", latestEvent.id);

  if (error) throw error;

  return data as unknown as FightWithDetails[];
}
