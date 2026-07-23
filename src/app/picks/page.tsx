import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getUpcomingCard, type UpcomingBout } from "@/lib/upcoming-card";
import { SiteHeader } from "@/components/SiteHeader";
import { PickButtons, type InitialPick } from "@/components/PickButtons";
import type { PickMethod } from "@/lib/pick-constants";

export const metadata: Metadata = {
  title: "Make Your Picks — Octagon Analytics",
  description: "Pick a winner for every bout on the upcoming UFC card.",
};

export default async function PicksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const card = await getUpcomingCard();

  if (!card || card.bouts.length === 0) {
    return (
      <>
        <SiteHeader current="picks" />
        <div className="mx-auto w-full max-w-4xl px-6 py-10">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">Make Your Picks</h1>
          <p className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-muted">
            No upcoming card to pick right now.
          </p>
        </div>
      </>
    );
  }

  const fightIds = card.bouts.map((b) => b.id);
  const { data: picks } = await supabase
    .from("user_picks")
    .select("fight_id, picked_fighter_id, predicted_method, predicted_round")
    .eq("user_id", user.id)
    .in("fight_id", fightIds);

  const pickByFightId = new Map<string, InitialPick>(
    (picks ?? []).map((p) => [
      p.fight_id,
      {
        fighterId: p.picked_fighter_id as string,
        method: p.predicted_method as PickMethod | null,
        round: p.predicted_round as number | null,
      },
    ])
  );

  // Picks lock once the event's date has passed — the schema only tracks an
  // event date, not per-bout start times, so this is the finest-grained
  // lock available. The real enforcement is server-side in submitPick;
  // this just keeps the UI from offering a control that would fail anyway.
  const today = new Date().toISOString().slice(0, 10);
  const locked = card.event.date < today;

  return (
    <>
      <SiteHeader current="picks" />
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight">Make Your Picks</h1>
        <p className="mt-1 max-w-md text-sm text-muted">
          Pick a winner for every bout on {card.event.name} ({card.event.date}).
          {locked && " Picks are locked — this card has already started."}
        </p>

        <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
          <div className="divide-y divide-border">
            {card.bouts.map((bout: UpcomingBout) => (
              <div key={bout.id} className="px-5 py-4">
                <div className="mb-2 text-center text-xs uppercase tracking-wide text-muted">
                  {bout.weight_class ? `${bout.weight_class} Bout` : "Bout"}
                </div>
                <PickButtons
                  fightId={bout.id}
                  fighterA={{ id: bout.fighterA.id, name: bout.fighterA.full_name }}
                  fighterB={{ id: bout.fighterB.id, name: bout.fighterB.full_name }}
                  scheduledRounds={bout.scheduled_rounds}
                  initialPick={pickByFightId.get(bout.id) ?? null}
                  locked={locked}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
