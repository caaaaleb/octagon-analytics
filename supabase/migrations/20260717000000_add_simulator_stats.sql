-- Win Simulator (spec Section 3) — per-fighter historical stats needed to
-- drive method-of-victory and round-of-finish sampling. Same pattern as
-- elo_rating: engine-maintained derived columns, not scraped, refreshed by
-- scripts/backfill-simulator-stats.mjs.

alter table fighters
  add column historical_finish_rate numeric,       -- fraction of wins that were finishes
  add column historical_finish_speed numeric,      -- 0-1: how early they finish (1 = fast)
  add column historical_gets_finished_rate numeric; -- fraction of losses that were finishes (inverse durability)
