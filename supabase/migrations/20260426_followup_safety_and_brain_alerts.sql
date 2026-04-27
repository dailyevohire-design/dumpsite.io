-- ═══════════════════════════════════════════════════════════════════════════
-- Followup safety controls + brain alerts + idempotency gate
-- Apply manually in Supabase Dashboard → dumpsite-production → SQL Editor.
--
-- Background:
--   On 2026-04-25 four customers (Sergio, Christy/Vicki, Tom, Michael) received
--   2-3 customer-facing rescue/followup SMSs in 24h, including re-pitches
--   AFTER explicit defer signals. Two crons (rescue-stuck every 30m,
--   customer-followup every 4h) fire independently and weren't sharing controls.
--
-- This migration:
--   1. Adds last_followup_at, followup_paused_until, last_outbound_at,
--      last_inbound_at to customer_conversations.
--   2. Repurposes existing follow_up_count as the shared cap counter
--      (NOT a new rescue_attempts column — single source of truth).
--   3. Backfills nulls and historical timestamps.
--   4. Adds shared RPCs both crons call: claim_followup_attempt /
--      get_followup_candidates / on_customer_inbound / mark_defer_if_detected.
--   5. RPCs operate on the canonical row per phone (most-recently-updated)
--      and FAN OUT updates to all rows for that phone — duplicate-row situation
--      doesn't break the cap-of-3 invariant. Eligibility is phone-level
--      aggregate (MAX/BOOL_OR), not per-row. pg_advisory_xact_lock
--      serializes concurrent claims (xact-scoped, PgBouncer-safe).
--   6. Creates brain_alerts table for fail-closed pause records.
--
-- Idempotency note: customer-webhook calls the existing single-arg
-- check_and_mark_message(p_sid) RPC from a prior migration (writes to
-- processed_messages). Not re-created here.
--
-- DO NOT include CONVERSATION in any defer alternation — '[CONVERSATION RESET]'
-- is a sentinel marker, but that pattern is in sms_logs.body, not relevant here.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. New columns ──────────────────────────────────────────────────────────
ALTER TABLE customer_conversations
  ADD COLUMN IF NOT EXISTS last_followup_at      timestamptz,
  ADD COLUMN IF NOT EXISTS followup_paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at      timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_at       timestamptz;

-- ── 2. Backfill follow_up_count nulls to 0 (single source of truth) ─────────
UPDATE customer_conversations
SET follow_up_count = 0
WHERE follow_up_count IS NULL;

-- ── 3. Backfill last_outbound_at / last_inbound_at from customer_sms_logs ──
UPDATE customer_conversations cc
SET last_outbound_at = sub.last_out
FROM (
  SELECT phone, MAX(created_at) AS last_out
  FROM customer_sms_logs
  WHERE direction = 'outbound'
  GROUP BY phone
) sub
WHERE cc.phone = sub.phone AND cc.last_outbound_at IS NULL;

UPDATE customer_conversations cc
SET last_inbound_at = sub.last_in
FROM (
  SELECT phone, MAX(created_at) AS last_in
  FROM customer_sms_logs
  WHERE direction = 'inbound'
  GROUP BY phone
) sub
WHERE cc.phone = sub.phone AND cc.last_inbound_at IS NULL;

-- ── 4. Index for the cron's hot query ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cc_followup_eligible
  ON customer_conversations (mode, follow_up_count, updated_at DESC)
  WHERE mode = 'AI_ACTIVE'
    AND follow_up_count < 3
    AND opted_out IS NOT TRUE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- get_followup_candidates: canonical row per phone, phone-level eligibility.
CREATE OR REPLACE FUNCTION get_followup_candidates(p_limit int DEFAULT 50)
RETURNS TABLE (
  phone           text,
  agent_id        uuid,
  state           text,
  customer_name   text,
  follow_up_count smallint,
  last_followup_at timestamptz,
  source_number   text
) LANGUAGE sql STABLE AS $$
  WITH per_phone AS (
    SELECT
      cc.phone,
      MAX(COALESCE(cc.follow_up_count, 0))           AS max_count,
      MAX(cc.last_followup_at)                       AS last_fu,
      MAX(cc.last_inbound_at)                        AS last_in,
      MAX(cc.last_outbound_at)                       AS last_out,
      MAX(cc.followup_paused_until)                  AS paused,
      BOOL_OR(cc.opted_out IS TRUE)                  AS any_opted,
      BOOL_OR(cc.mode = 'HUMAN_ACTIVE')              AS any_human,
      BOOL_OR(cc.needs_human_review IS TRUE)         AS any_review,
      BOOL_OR(cc.state IN ('CLOSED','PAID','CANCELED','DELIVERED','ORDER_PLACED','OUT_OF_AREA')) AS any_terminal
    FROM customer_conversations cc
    GROUP BY cc.phone
  ),
  canonical AS (
    SELECT DISTINCT ON (cc.phone)
      cc.phone, cc.agent_id, cc.state, cc.customer_name,
      COALESCE(cc.follow_up_count, 0)::smallint AS follow_up_count,
      cc.last_followup_at,
      cc.source_number
    FROM customer_conversations cc
    ORDER BY cc.phone, cc.updated_at DESC
  )
  SELECT c.phone, c.agent_id, c.state, c.customer_name,
         c.follow_up_count, c.last_followup_at, c.source_number
  FROM canonical c
  JOIN per_phone p ON p.phone = c.phone
  WHERE p.max_count < 3
    AND (p.last_fu  IS NULL OR p.last_fu  < now() - interval '24 hours')
    AND (p.last_out IS NULL OR p.last_out < now() - interval '24 hours')
    AND (p.last_in  IS NULL OR p.last_in  < now() - interval '24 hours')
    AND (p.paused   IS NULL OR p.paused   < now())
    AND NOT p.any_opted
    AND NOT p.any_human
    AND NOT p.any_review
    AND NOT p.any_terminal
  ORDER BY c.last_followup_at NULLS FIRST
  LIMIT p_limit;
$$;

-- claim_followup_attempt: atomic claim with pg_advisory_xact_lock.
-- Returns true if the attempt was claimed (updates fanned out across all rows
-- for that phone). Returns false if blocked by predicate. The blocking lock
-- means a concurrent claimer waits for us to commit, then evaluates the
-- (now-incremented) predicate and returns false — no double-fire.
CREATE OR REPLACE FUNCTION claim_followup_attempt(p_phone text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_max_count smallint;
  v_last_fu   timestamptz;
  v_last_in   timestamptz;
  v_last_out  timestamptz;
  v_paused    timestamptz;
  v_any_opted boolean;
  v_any_human boolean;
  v_any_review boolean;
  v_any_terminal boolean;
BEGIN
  -- Blocking xact-scoped lock per phone (auto-releases on commit; PgBouncer-safe).
  -- Matches the hashtext idiom from try_advisory_lock_phone (20260412).
  PERFORM pg_advisory_xact_lock(hashtext(p_phone));

  SELECT
    MAX(COALESCE(follow_up_count, 0)),
    MAX(last_followup_at), MAX(last_inbound_at), MAX(last_outbound_at),
    MAX(followup_paused_until),
    BOOL_OR(opted_out IS TRUE),
    BOOL_OR(mode = 'HUMAN_ACTIVE'),
    BOOL_OR(needs_human_review IS TRUE),
    BOOL_OR(state IN ('CLOSED','PAID','CANCELED','DELIVERED','ORDER_PLACED','OUT_OF_AREA'))
  INTO
    v_max_count, v_last_fu, v_last_in, v_last_out,
    v_paused, v_any_opted, v_any_human, v_any_review, v_any_terminal
  FROM customer_conversations
  WHERE phone = p_phone;

  IF v_max_count IS NULL          THEN RETURN false; END IF;  -- no rows for phone
  IF v_max_count >= 3             THEN RETURN false; END IF;  -- cap
  IF v_any_opted                  THEN RETURN false; END IF;
  IF v_any_human                  THEN RETURN false; END IF;
  IF v_any_review                 THEN RETURN false; END IF;
  IF v_any_terminal               THEN RETURN false; END IF;
  IF v_paused IS NOT NULL  AND v_paused  > now()                    THEN RETURN false; END IF;
  IF v_last_fu IS NOT NULL AND v_last_fu > now() - interval '24 hours' THEN RETURN false; END IF;
  IF v_last_out IS NOT NULL AND v_last_out > now() - interval '24 hours' THEN RETURN false; END IF;
  IF v_last_in IS NOT NULL AND v_last_in > now() - interval '24 hours' THEN RETURN false; END IF;

  -- Fan out increment to ALL rows for this phone so duplicate-row state stays in sync.
  UPDATE customer_conversations
  SET follow_up_count  = v_max_count + 1,
      last_followup_at = now(),
      last_outbound_at = now()
  WHERE phone = p_phone;

  RETURN true;
END;
$$;

-- on_customer_inbound: reset rescue counter on every customer reply (fan-out).
CREATE OR REPLACE FUNCTION on_customer_inbound(p_phone text)
RETURNS void LANGUAGE sql AS $$
  UPDATE customer_conversations
  SET last_inbound_at        = now(),
      follow_up_count        = 0,
      followup_paused_until  = NULL,
      last_followup_at       = NULL
  WHERE phone = p_phone;
$$;

-- mark_defer_if_detected: lightweight phrase match → 72h pause (fan-out).
-- Defer-classifier upgrade (Claude Haiku) is P1.
CREATE OR REPLACE FUNCTION mark_defer_if_detected(p_phone text, p_message text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_lower text := lower(coalesce(p_message, ''));
BEGIN
  IF v_lower ~ '(husband|wife|partner|spouse|run.{0,3}by|run.{0,3}past|think about it|get back to you|let me think|talk to (my|the)|need to (check|ask|talk)|maybe later|next week|not (ready|yet)|hold off|pause|circle back|not right now|free dirt|operators? (giv|brin|providing) free)' THEN
    UPDATE customer_conversations
    SET followup_paused_until = now() + interval '72 hours',
        follow_up_count       = LEAST(COALESCE(follow_up_count, 0), 1)
    WHERE phone = p_phone;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. brain_alerts table (fail-closed pause records)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS brain_alerts (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone               text NOT NULL,
  alert_class         text NOT NULL,           -- 'fail_closed_pause', 'cap_reached', etc.
  source              text,                    -- 'customer-webhook', 'rescue-stuck-sarah', 'customer-followup'
  conversation_state  jsonb,
  transcript_snapshot jsonb,
  error_message       text,
  error_stack         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  acknowledged_at     timestamptz,
  acknowledged_by     text,
  resolution_category text,
  operator_diagnosis  text
);

CREATE INDEX IF NOT EXISTS idx_brain_alerts_phone     ON brain_alerts (phone);
CREATE INDEX IF NOT EXISTS idx_brain_alerts_unacked   ON brain_alerts (created_at DESC) WHERE acknowledged_at IS NULL;

-- (Section 7 — processed_message_sids + check_and_mark_message — removed.
--  customer-webhook calls the existing single-arg check_and_mark_message(p_sid)
--  RPC from a prior migration; that function writes to processed_messages.)

-- ── 7. Grants ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION get_followup_candidates(int)        TO service_role;
GRANT EXECUTE ON FUNCTION claim_followup_attempt(text)        TO service_role;
GRANT EXECUTE ON FUNCTION on_customer_inbound(text)           TO service_role;
GRANT EXECUTE ON FUNCTION mark_defer_if_detected(text, text)  TO service_role;
GRANT INSERT, SELECT ON brain_alerts                          TO service_role;
