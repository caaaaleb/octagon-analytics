-- Lets a pick capture not just who wins but how — matching the granularity
-- the site's own model already reasons about (see BoutSimulator's method
-- breakdown). Round is only meaningful for a finish (KO/TKO or Submission);
-- left null for a Decision pick, which by definition goes the scheduled
-- distance.
alter table user_picks add column predicted_method text check (predicted_method in ('KO/TKO', 'Submission', 'Decision'));
alter table user_picks add column predicted_round int check (predicted_round between 1 and 5);
