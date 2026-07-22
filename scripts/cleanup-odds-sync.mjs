// One-time cleanup: undoes the first (unfiltered) sync-odds.mjs run, which
// mixed non-UFC promotions into the schema and created duplicate fighter
// rows for name-variant mismatches (e.g. "Ian Garry" vs the existing
// "Ian Machado Garry"). Since events/fights/odds_snapshots all cascade on
// delete, and every event with date >= today was created by that run (the
// DB had zero upcoming events before it), deleting those events cleans up
// the rest. The stub fighter rows it created are identified by name match
// against the exact list the sync printed, plus a zeroed-stats safety check.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CREATED_FIGHTER_NAMES = [
  "Mateusz Pawlik", "Adam Niedzwiedz", "Artur Szpilka", "Bartosz Kurek", "Laid Zerhouni",
  "Przemyslaw Gorny", "Grzegorz Stabach", "Maciej Rozanski", "Ibragim Chuzhigaev",
  "Adam Niedźwiedź", "Sebastian Przybysz", "Edgars Skrīvers", "Rafał Haratyk", "Bartosz Leśko",
  "Andrea Bicchi", "Arbi Chakaev", "Dominik Herold", "Jindrich Byrtus", "Ernesto Papa",
  "Toni Estorer", "Tomas Melis", "Alden Coria", "Ezra Elliott", "Levi Rodrigues",
  "Felipe Franco", "Seok Hyun Ko", "Jean-Paul Lebosnoyani", "Anna Melisano", "Andrea Vazquez",
  "Aleksandra Savicheva", "RJ Harris", "Alvin Hines", "Mia Grawe", "Ashley Thiner",
  "Biaggio Ali Walsh", "Gamid Khizriev", "Victoria Alba", "Borena Tsertsvadze", "Johnny Eblen",
  "Jackson Glass", "Zak Flessas", "Lewis McGrillen", "Rafael do Nascimento", "Levy Saul Marroquin",
  "Axel Sola", "Stephen Erceg", "Ramazonbek Temirov", "Tyrell Fortune", "Khalil Rountree",
  "Ian Garry", "Josh Hokit", "Paulo Henrique Costa",
];

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const { data: futureEvents, error: fetchErr } = await supabase
    .from("events")
    .select("id, name, date")
    .gte("date", today);
  if (fetchErr) throw fetchErr;

  console.log(`Deleting ${futureEvents.length} events dated >= ${today} (cascades to fights + odds_snapshots)...`);
  if (futureEvents.length > 0) {
    const { error: delEventsErr } = await supabase
      .from("events")
      .delete()
      .in("id", futureEvents.map((e) => e.id));
    if (delEventsErr) throw delEventsErr;
  }

  const { data: stubFighters, error: stubErr } = await supabase
    .from("fighters")
    .select("id, full_name, wins, losses, draws, no_contests, elo_rating")
    .in("full_name", CREATED_FIGHTER_NAMES);
  if (stubErr) throw stubErr;

  const safeToDelete = stubFighters.filter(
    (f) => f.wins === 0 && f.losses === 0 && f.draws === 0 && f.no_contests === 0 && f.elo_rating === 1500
  );
  const skipped = stubFighters.filter((f) => !safeToDelete.includes(f));

  console.log(`Deleting ${safeToDelete.length} stub fighter rows (zeroed stats, matching the created-names list)...`);
  if (safeToDelete.length > 0) {
    const { error: delFightersErr } = await supabase
      .from("fighters")
      .delete()
      .in("id", safeToDelete.map((f) => f.id));
    if (delFightersErr) throw delFightersErr;
  }
  if (skipped.length > 0) {
    console.log(`Left ${skipped.length} matching-name rows alone (non-zero stats, not safe to assume they're stubs):`, skipped.map((f) => f.full_name));
  }

  console.log("Cleanup complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
