-- DealScout v2 schema: one row per research run, and the saved profiles, one
-- row per version per company (the long-term memory). The LangGraph
-- checkpoint tables (checkpoints, checkpoint_writes, ...) are created by the
-- checkpointer's own setup(), which app/migrate.py runs after these files.

create table runs (
  -- Also the LangGraph thread id: every checkpoint of the run is stored
  -- under it.
  id uuid primary key,
  company text not null,
  -- lower-cased, whitespace-collapsed name: how a later run finds the
  -- profile an earlier one saved.
  company_key text not null,
  status text not null default 'running'
    check (status in ('running', 'awaiting_approval', 'saved', 'rejected', 'failed')),
  -- The request driving the graph holds the run until this time, a little
  -- past the function's 300 s limit. A 'running' run whose lease has passed
  -- was cut off mid-graph and can be resumed from its last checkpoint.
  lease_until timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index runs_created_at on runs (created_at desc);

create table profiles (
  id bigint generated always as identity primary key,
  company_key text not null,
  version integer not null check (version > 0),
  -- One profile per run: a save that runs twice (killed after the insert,
  -- then resumed) can't store a second version.
  run_id uuid not null unique references runs (id),
  profile jsonb not null,
  created_at timestamptz not null default now(),
  unique (company_key, version)
);
