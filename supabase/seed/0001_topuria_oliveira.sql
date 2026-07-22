-- Manually-entered fight for Week 1 pipeline confirmation.
-- UFC 317: Topuria vs. Oliveira, June 28, 2025 — T-Mobile Arena, Las Vegas.
-- Stats are approximate pre-fight career figures for pipeline testing;
-- Week 2's scraper will replace these with exact UFCStats data.

insert into fighters (
  full_name, ufcstats_id, dob, height_cm, reach_cm, stance, weight_class,
  wins, losses, draws, no_contests, slpm, sapm, str_acc, str_def,
  td_avg, td_acc, td_def, sub_avg, elo_rating
) values (
  'Ilia Topuria', 'topuria-ilia', '1997-01-21', 170, 175, 'orthodox', 'Lightweight',
  17, 0, 0, 0, 4.44, 3.05, 0.46, 0.66,
  2.19, 0.56, 0.92, 0.2, 1700
) returning id;

insert into fighters (
  full_name, ufcstats_id, dob, height_cm, reach_cm, stance, weight_class,
  wins, losses, draws, no_contests, slpm, sapm, str_acc, str_def,
  td_avg, td_acc, td_def, sub_avg, elo_rating
) values (
  'Charles Oliveira', 'oliveira-charles', '1989-10-17', 178, 188, 'orthodox', 'Lightweight',
  34, 10, 0, 1, 3.23, 3.05, 0.55, 0.53,
  2.29, 0.39, 0.61, 3.0, 1650
) returning id;

insert into events (name, date, location, is_ppv)
values ('UFC 317: Topuria vs. Oliveira', '2025-06-28', 'T-Mobile Arena, Las Vegas, Nevada, USA', true)
returning id;

-- Fight row references the rows above by name lookup so this script
-- doesn't depend on hand-copying generated UUIDs between statements.
insert into fights (
  event_id, fighter_a_id, fighter_b_id, weight_class, is_title_fight,
  scheduled_rounds, result_winner_id, result_method, result_round, result_time, status
)
select
  e.id,
  a.id,
  b.id,
  'Lightweight',
  true,
  5,
  a.id,
  'KO/TKO',
  1,
  '2:27',
  'completed'
from events e, fighters a, fighters b
where e.name = 'UFC 317: Topuria vs. Oliveira'
  and a.full_name = 'Ilia Topuria'
  and b.full_name = 'Charles Oliveira';
