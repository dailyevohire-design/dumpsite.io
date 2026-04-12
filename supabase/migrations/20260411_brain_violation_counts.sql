-- Brain violation counts — persistent self-healing feedback loop.
--
-- Why this exists: trackViolation() used to increment a module-level JS
-- variable. On Vercel serverless every cold container starts with {}, so the
-- counter never reached threshold before the container died. Two days of
-- production traffic produced zero auto-inserted learnings, and Sarah kept
-- repeating the same slop — e.g. Luis's 41 near-duplicate "Want me to get
-- that scheduled" messages on 2026-04-10/11.
--
-- With this table, trackViolation() does an atomic upsert and reads the
-- authoritative count. At threshold = 5 it writes a rule into brain_learnings
-- and resets the counter, so the same slop category can never ship more than
-- 5 times to production without a permanent rule being added.
create table if not exists brain_violation_counts (
  brain text not null check (brain in ('sarah', 'jesse')),
  type text not null,
  count integer not null default 0,
  last_example text,
  updated_at timestamptz not null default now(),
  primary key (brain, type)
);

create index if not exists idx_brain_violation_counts_updated
  on brain_violation_counts (updated_at desc);
