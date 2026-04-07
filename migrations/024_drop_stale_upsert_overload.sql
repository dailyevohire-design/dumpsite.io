-- 024_drop_stale_upsert_overload.sql
-- BUG: Migration 023 added p_source_number + p_agent_id to upsert_customer_conversation,
-- creating a SECOND overload alongside the 24-param version from 022. Postgres errors:
--   "Could not choose the best candidate function between: public.upsert_customer_conversation(...)"
-- Result: every saveConv() silently fails. Sales agent attribution (Micah/John) is broken —
-- conversations are never persisted with source_number/agent_id, so leads to Micah's number
-- end up linked to nothing (or to whichever agent the dashboard shows by default).
--
-- Fix: drop the old 24-param overload. Keep only the 26-param version from 023.

DROP FUNCTION IF EXISTS upsert_customer_conversation(
  text, text, text, text, text, text,
  double precision, double precision,
  text, text, integer, text, text, text, text,
  double precision, integer, integer,
  text, text, text, uuid, timestamptz, integer
);

-- Sanity check: confirm only one overload remains
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc WHERE proname = 'upsert_customer_conversation';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 upsert_customer_conversation function, found %', n;
  END IF;
END $$;
