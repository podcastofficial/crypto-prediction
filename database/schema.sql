-- Crypto Prediction Arena - MVP schema (Neon SQL Editor mein paste karke Run karo)

create table if not exists users (
  id serial primary key,
  telegram_id bigint unique not null,
  username text,
  first_name text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists coins (
  id serial primary key,
  symbol text unique not null,
  name text not null,
  cg_id text not null,
  price_precision int not null default 2,
  enabled boolean not null default true
);

create table if not exists market_prices (
  id bigserial primary key,
  coin_id int not null references coins(id),
  price numeric(24,8) not null,
  provider text not null,
  source_time timestamptz,
  received_at timestamptz not null default now(),
  quality_status text not null default 'ok'
);
create index if not exists idx_prices_coin_time on market_prices(coin_id, received_at desc);

create table if not exists prediction_rounds (
  id bigserial primary key,
  coin_id int not null references coins(id),
  duration_sec int not null,
  open_at timestamptz not null,
  lock_at timestamptz not null,
  close_at timestamptz not null,
  status text not null default 'scheduled',
  open_snapshot_id bigint references market_prices(id),
  close_snapshot_id bigint references market_prices(id),
  void_reason text,
  unique (coin_id, duration_sec, open_at)
);
create index if not exists idx_rounds_status_lock on prediction_rounds(status, lock_at);
create index if not exists idx_rounds_status_close on prediction_rounds(status, close_at);

create table if not exists predictions (
  id bigserial primary key,
  user_id int not null references users(id),
  round_id bigint not null references prediction_rounds(id),
  direction text not null check (direction in ('UP','DOWN')),
  status text not null default 'pending',
  accepted_at timestamptz not null default now(),
  unique (user_id, round_id)
);
create index if not exists idx_pred_user_time on predictions(user_id, accepted_at desc);
create index if not exists idx_pred_round on predictions(round_id);

create table if not exists prediction_results (
  round_id bigint primary key references prediction_rounds(id),
  outcome text not null,
  open_price numeric(24,8) not null,
  close_price numeric(24,8) not null,
  settled_at timestamptz not null default now()
);

create table if not exists points_ledger (
  id bigserial primary key,
  user_id int not null references users(id),
  points_type text not null check (points_type in ('AP','XP')),
  amount int not null,
  reason text not null,
  reference_type text not null,
  reference_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, points_type, reason, reference_type, reference_id)
);
create index if not exists idx_ledger_user on points_ledger(user_id);

-- ledger append-only: update/delete block
create or replace function ledger_block() returns trigger as $$
begin raise exception 'points_ledger is append-only'; end;
$$ language plpgsql;
drop trigger if exists trg_ledger_block on points_ledger;
create trigger trg_ledger_block before update or delete on points_ledger
  for each row execute function ledger_block();

create table if not exists user_stats (
  user_id int primary key references users(id),
  total_predictions int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  ties int not null default 0,
  current_streak int not null default 0,
  best_streak int not null default 0
);

insert into coins (symbol, name, cg_id, price_precision) values
  ('BTC','Bitcoin','bitcoin',2),
  ('ETH','Ethereum','ethereum',2),
  ('BNB','BNB','binancecoin',2),
  ('SOL','Solana','solana',3)
on conflict (symbol) do nothing;
