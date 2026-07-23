-- Official UFC.com rankings — Pound-for-Pound and per-division. Nullable:
-- most fighters in our roster (retired, regional, unranked) have neither.
-- Kept simple as two columns on `fighters` rather than a separate rankings
-- table, since only the CURRENT rankings are shown (no history/trend UI) —
-- see scripts/sync-rankings.mjs, which overwrites both on every run and
-- clears them for anyone no longer listed.
alter table fighters add column p4p_rank int;
alter table fighters add column division_rank int;
