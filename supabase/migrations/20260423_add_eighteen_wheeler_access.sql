-- CP2: 18-wheeler access gate
--
-- Adds an explicit flag indicating whether a dispatch_orders site can accept
-- 18-wheeler / end-dump / semi trucks. Existing rows backfill to false
-- (conservative — access wasn't structured before this migration, so we
-- cannot prove a legacy site fits an 18-wheeler).
--
-- Sarah's customer-brain.service.ts will be updated separately to set this
-- to true when the customer confirms 18-wheeler access during intake.
-- Until then, findNearbyJobs() in routing.service.ts filters end_dump and
-- 18_wheeler drivers to rows where this column = true; tandem/dump-truck
-- drivers are not filtered (small trucks fit anywhere).

ALTER TABLE public.dispatch_orders
  ADD COLUMN IF NOT EXISTS eighteen_wheeler_access boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_dispatch_orders_18wheeler_access
  ON public.dispatch_orders (eighteen_wheeler_access)
  WHERE eighteen_wheeler_access = true;

COMMENT ON COLUMN public.dispatch_orders.eighteen_wheeler_access IS
  'True if site can accept end_dump / 18-wheeler / semi trucks. Default false (conservative). Set by Sarah during customer intake when 18-wheeler access is confirmed.';

-- Routing observability: one row per findNearbyJobs() call.
-- Used to audit filtered-vs-unfiltered candidate counts as the 18-wheeler
-- gate rolls out. audit_logs.entity_id is UUID NOT NULL and can't hold a
-- driver phone / location string, so this gets its own table.
CREATE TABLE IF NOT EXISTS public.jesse_routing_log (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_location           text,
  truck_type_input          text,
  normalized_class          text,
  candidates_before_filter  integer,
  candidates_after_filter   integer,
  access_column_used        text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jesse_routing_log_created_at
  ON public.jesse_routing_log (created_at DESC);
