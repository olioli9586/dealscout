-- What each run may spend and what it has spent, in USD. cost_usd is
-- written at the end of every request that drives the run (start, resume,
-- decision), from the usage stored in its checkpoints; null means a call
-- had no known price. The daily spend cap sums it (app/runs.py).

alter table runs
  add column budget_usd double precision,
  add column cost_usd double precision default 0;
