"use server";

// Submits/updates a user's pick for a fight — upserts on the (user_id,
// fight_id) unique constraint so picking again just changes the pick
// instead of erroring. RLS already restricts this to the caller's own
// user_id (see supabase/migrations/20260716000000_init_schema.sql), but
// that alone wouldn't stop someone from picking on a fight whose card has
// already started (the UI just disables the button) — re-checking the
// fight's status/event date here is the real enforcement. Same for
// predicted_round: it only makes sense within however many rounds this
// specific bout is scheduled for, re-checked here rather than trusted from
// the client.
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { PICK_METHODS, type PickMethod } from "@/lib/pick-constants";

type FightGate = { status: string; scheduled_rounds: number; event: { date: string } | null };

export async function submitPick(
  fightId: string,
  fighterId: string,
  predictedMethod: PickMethod | null,
  predictedRound: number | null
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to make picks." };

  if (predictedMethod !== null && !PICK_METHODS.includes(predictedMethod)) {
    return { error: "Invalid method." };
  }

  const { data: fight, error: fightError } = await supabase
    .from("fights")
    .select("status, scheduled_rounds, event:event_id(date)")
    .eq("id", fightId)
    .maybeSingle();
  if (fightError) return { error: fightError.message };
  if (!fight) return { error: "Fight not found." };

  const typedFight = fight as unknown as FightGate;
  const today = new Date().toISOString().slice(0, 10);
  if (typedFight.status !== "scheduled" || (typedFight.event && typedFight.event.date < today)) {
    return { error: "Picks are locked — this card has already started." };
  }

  if (predictedRound !== null && (predictedRound < 1 || predictedRound > typedFight.scheduled_rounds)) {
    return { error: "Invalid round." };
  }

  const { error } = await supabase.from("user_picks").upsert(
    {
      user_id: user.id,
      fight_id: fightId,
      picked_fighter_id: fighterId,
      predicted_method: predictedMethod,
      predicted_round: predictedRound,
    },
    { onConflict: "user_id,fight_id" }
  );
  if (error) return { error: error.message };

  revalidatePath("/picks");
  return {};
}
