-- Octagon Analytics — initial schema (spec Section 1)

-- ============================================================
-- fighters
-- ============================================================
create table fighters (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  ufcstats_id text unique,
  dob date,
  height_cm numeric,
  reach_cm numeric,
  stance text check (stance in ('orthodox', 'southpaw', 'switch')),
  weight_class text,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  no_contests int not null default 0,
  slpm numeric,
  sapm numeric,
  str_acc numeric,
  str_def numeric,
  td_avg numeric,
  td_acc numeric,
  td_def numeric,
  sub_avg numeric,
  elo_rating numeric not null default 1500,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- events
-- ============================================================
create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null,
  location text,
  is_ppv boolean not null default false
);

-- ============================================================
-- fights
-- ============================================================
create table fights (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  fighter_a_id uuid not null references fighters (id),
  fighter_b_id uuid not null references fighters (id),
  weight_class text,
  is_title_fight boolean not null default false,
  scheduled_rounds int not null default 3 check (scheduled_rounds in (3, 5)),
  result_winner_id uuid references fighters (id),
  result_method text,
  result_round int,
  result_time text,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  check (fighter_a_id <> fighter_b_id)
);

create index fights_event_id_idx on fights (event_id);
create index fights_fighter_a_id_idx on fights (fighter_a_id);
create index fights_fighter_b_id_idx on fights (fighter_b_id);

-- ============================================================
-- odds_snapshots
-- ============================================================
create table odds_snapshots (
  id uuid primary key default gen_random_uuid(),
  fight_id uuid not null references fights (id) on delete cascade,
  sportsbook text not null,
  fighter_a_moneyline int not null,
  fighter_b_moneyline int not null,
  fetched_at timestamptz not null default now()
);

create index odds_snapshots_fight_id_idx on odds_snapshots (fight_id);

-- ============================================================
-- predictions
-- ============================================================
create table predictions (
  id uuid primary key default gen_random_uuid(),
  fight_id uuid not null references fights (id) on delete cascade,
  model_version text not null,
  fighter_a_win_prob numeric not null check (fighter_a_win_prob between 0 and 1),
  fighter_b_win_prob numeric not null check (fighter_b_win_prob between 0 and 1),
  predicted_method text,
  generated_at timestamptz not null default now()
);

create index predictions_fight_id_idx on predictions (fight_id);

-- ============================================================
-- model_accuracy — computed view, not a stored table.
-- Rolling accuracy + Brier score per model version, evaluated
-- against the latest prediction for each completed fight.
-- ============================================================
create view model_accuracy as
with latest_predictions as (
  select distinct on (fight_id, model_version) *
  from predictions
  order by fight_id, model_version, generated_at desc
)
select
  lp.model_version,
  count(*) as total_predictions,
  count(*) filter (
    where (
      case when lp.fighter_a_win_prob >= lp.fighter_b_win_prob
        then f.fighter_a_id else f.fighter_b_id end
    ) = f.result_winner_id
  ) as correct_picks,
  round(
    count(*) filter (
      where (
        case when lp.fighter_a_win_prob >= lp.fighter_b_win_prob
          then f.fighter_a_id else f.fighter_b_id end
      ) = f.result_winner_id
    )::numeric / count(*),
    4
  ) as accuracy,
  round(
    avg(
      power(
        lp.fighter_a_win_prob - (case when f.result_winner_id = f.fighter_a_id then 1 else 0 end),
        2
      )
    ),
    4
  ) as brier_score
from latest_predictions lp
join fights f on f.id = lp.fight_id
where f.status = 'completed' and f.result_winner_id is not null
group by lp.model_version;

-- ============================================================
-- Phase 3 (scaffold now, build later) — community layer
-- Uses Supabase Auth's built-in auth.users, no separate users table.
-- ============================================================
create table user_picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  fight_id uuid not null references fights (id) on delete cascade,
  picked_fighter_id uuid not null references fighters (id),
  submitted_at timestamptz not null default now(),
  unique (user_id, fight_id)
);

create index user_picks_user_id_idx on user_picks (user_id);
create index user_picks_fight_id_idx on user_picks (fight_id);

create view leaderboard as
select
  up.user_id,
  count(*) as total_picks,
  count(*) filter (where up.picked_fighter_id = f.result_winner_id) as correct_picks,
  round(
    count(*) filter (where up.picked_fighter_id = f.result_winner_id)::numeric
      / nullif(count(*) filter (where f.status = 'completed'), 0),
    4
  ) as accuracy
from user_picks up
join fights f on f.id = up.fight_id
group by up.user_id;

-- ============================================================
-- Row Level Security
-- Core fight/odds/prediction data is public read-only over the
-- publishable key; writes are reserved for the service role
-- (scraper, model jobs) which bypasses RLS entirely.
-- ============================================================
alter table fighters enable row level security;
alter table events enable row level security;
alter table fights enable row level security;
alter table odds_snapshots enable row level security;
alter table predictions enable row level security;
alter table user_picks enable row level security;

create policy "Public read access" on fighters for select using (true);
create policy "Public read access" on events for select using (true);
create policy "Public read access" on fights for select using (true);
create policy "Public read access" on odds_snapshots for select using (true);
create policy "Public read access" on predictions for select using (true);

create policy "Users can read all picks" on user_picks for select using (true);
create policy "Users can insert their own picks" on user_picks for insert with check (auth.uid() = user_id);
create policy "Users can update their own picks" on user_picks for update using (auth.uid() = user_id);
create policy "Users can delete their own picks" on user_picks for delete using (auth.uid() = user_id);
