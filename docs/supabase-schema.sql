-- VENOM MD BOT - Supabase / Postgres schema
--
-- Run this ONCE in the Supabase dashboard:
--   SQL Editor -> New query -> paste -> Run
--
-- Each bot collection becomes one table holding whole documents in a jsonb
-- column. That keeps the schemaless behaviour the plugins rely on: when a
-- plugin starts writing a new field, Postgres needs no migration.
--
-- After running this, put your project URL and key in .env:
--   SUPABASE_URL=https://xxxxx.supabase.co
--   SUPABASE_KEY=<service_role key>
--
-- Use the SERVICE ROLE key, not the anon key. The bot is a trusted backend
-- and needs to bypass Row Level Security. Never expose that key publicly.

create table if not exists vars      (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists users     (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists groups    (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists warns     (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists sudo      (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists banned    (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists notes     (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists afk       (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists mods      (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists filters   (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists customcmd (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists stats     (id text primary key, doc jsonb not null default '{}'::jsonb);

-- Row Level Security stays ON, with no public policies. The service_role key
-- bypasses RLS, so the bot works while the anon key can read nothing.
alter table vars      enable row level security;
alter table users     enable row level security;
alter table groups    enable row level security;
alter table warns     enable row level security;
alter table sudo      enable row level security;
alter table banned    enable row level security;
alter table notes     enable row level security;
alter table afk       enable row level security;
alter table mods      enable row level security;
alter table filters   enable row level security;
alter table customcmd enable row level security;
alter table stats     enable row level security;

-- GIN indexes make jsonb lookups fast once a table grows.
create index if not exists users_doc_idx  on users  using gin (doc);
create index if not exists groups_doc_idx on groups using gin (doc);
create index if not exists warns_doc_idx  on warns  using gin (doc);

-- ---------------------------------------------------------------------
-- IMPORTANT: the Supabase free tier pauses a project after 7 days with no
-- database activity, which takes the bot offline until you unpause it by
-- hand. A busy bot never hits this. A quiet one will.
--
-- To stay awake, schedule any request against the project - for example a
-- free UptimeRobot monitor hitting your bot's health endpoint every 5
-- minutes, or a GitHub Actions cron that runs a trivial select.
--
-- MongoDB Atlas M0 has no such pause, which is why it is the default
-- recommendation in the README.
-- ---------------------------------------------------------------------
