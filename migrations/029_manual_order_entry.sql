-- ============================================================================
-- 029_manual_order_entry.sql
-- Target: Supabase project agsjodzzjrnqdopysjbb (dumpsite-production)
-- Apply by: Supabase SQL Editor (DDL is NOT applied via MCP for this project).
-- Author: rep-portal manual order entry feature (Stage 1 of 4).
-- Date: 2026-04-24
--
-- Idempotent: safe to re-run; every CREATE uses IF NOT EXISTS / OR REPLACE,
-- every ALTER is guarded, every policy is dropped-then-recreated, and the
-- pg_cron job is unscheduled before being rescheduled.
--
-- Changes in this file:
--   1. CREATE TABLE sms_consent (append-only consent capture log)
--      + index + RLS + service_role policy
--   2. CREATE TABLE manual_order_submissions (rep-portal idempotency state)
--      + index + RLS + service_role policy
--   3. CREATE FUNCTION fdnm_cleanup_manual_order_submissions (7-day TTL)
--   4. Schedule daily pg_cron job 'fdnm-cleanup-manual-order-submissions'
--      at 04:00 UTC (skipped with NOTICE if pg_cron is not installed)
--   5. ALTER TABLE admin_activity_log:
--        - ADD COLUMN rep_id text REFERENCES sales_reps(id)
--        - ALTER COLUMN admin_user_id DROP NOT NULL
--        - ADD CONSTRAINT admin_activity_log_actor_present (at least one actor)
--        - partial index on (rep_id, created_at DESC)
--   6. CREATE FUNCTION fdnm_create_manual_order(...)
--        Transactional RPC. Order of operations:
--          a. Input sanity
--          b. Validate agent + source_number consistency
--          c. Validate city
--          d. Validate rep (authorized + active)
--          e. Read opt-out flag (scoped by phone + agent_id; mirrors Sarah 1:1)
--          f. Hijack check: any non-CLOSED non-opted-out conversation at
--             (phone, agent_id) => return block_reason='active_conversation_exists'
--          g. Duplicate-order check (unless p_allow_duplicate_phone): any
--             dispatch_orders row with status IN (dispatching,in_progress) on
--             same client_phone (E.164) => return block_reason='duplicate_order_possible'
--          h. INSERT dispatch_orders (status='dispatching', source='manual',
--             agent_id + source_number to keep resolve-agent trigger consistent)
--          i. UPSERT customer_conversations at state='QUOTING' with
--             dispatch_order_id FK; opted_out preserved across conflict
--          j. Return jsonb {order_id, conversation_id, outbound_sms_ready}
--
-- Post-apply verification queries are at the bottom of this file.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. sms_consent
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_consent (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164         text NOT NULL,
  source             text NOT NULL CHECK (source IN (
                        'inbound_call','web_form','in_person_quote',
                        'referral_confirmed','existing_customer','other')),
  source_note        text,
  captured_by_rep_id text REFERENCES sales_reps(id),
  captured_at        timestamptz NOT NULL DEFAULT now(),
  consent_given      boolean NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sms_consent_phone_captured
  ON sms_consent (phone_e164, captured_at DESC);

ALTER TABLE sms_consent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_consent_service_role_all ON sms_consent;
CREATE POLICY sms_consent_service_role_all
  ON sms_consent FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. manual_order_submissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual_order_submissions (
  idempotency_key uuid PRIMARY KEY,
  rep_id          text NOT NULL REFERENCES sales_reps(id),
  status          text NOT NULL CHECK (status IN ('in_progress','completed','failed')),
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_manual_order_submissions_created
  ON manual_order_submissions (created_at);

ALTER TABLE manual_order_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manual_order_submissions_service_role_all ON manual_order_submissions;
CREATE POLICY manual_order_submissions_service_role_all
  ON manual_order_submissions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. TTL cleanup function (returns number of rows deleted)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fdnm_cleanup_manual_order_submissions()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM manual_order_submissions
   WHERE created_at < now() - INTERVAL '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. pg_cron schedule (daily 04:00 UTC) — idempotent
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fdnm-cleanup-manual-order-submissions') THEN
      PERFORM cron.unschedule('fdnm-cleanup-manual-order-submissions');
    END IF;
    PERFORM cron.schedule(
      'fdnm-cleanup-manual-order-submissions',
      '0 4 * * *',
      $cron$SELECT public.fdnm_cleanup_manual_order_submissions()$cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron extension is not installed; TTL cleanup will not run automatically. Install pg_cron or invoke fdnm_cleanup_manual_order_submissions() manually.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. admin_activity_log alters
-- ---------------------------------------------------------------------------
ALTER TABLE admin_activity_log
  ADD COLUMN IF NOT EXISTS rep_id text REFERENCES sales_reps(id);

ALTER TABLE admin_activity_log
  ALTER COLUMN admin_user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'admin_activity_log_actor_present'
       AND conrelid = 'public.admin_activity_log'::regclass
  ) THEN
    EXECUTE '
      ALTER TABLE admin_activity_log
        ADD CONSTRAINT admin_activity_log_actor_present
        CHECK (admin_user_id IS NOT NULL OR rep_id IS NOT NULL)
    ';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_admin_activity_log_rep_id_created_at
  ON admin_activity_log (rep_id, created_at DESC)
  WHERE rep_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. fdnm_create_manual_order — transactional RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fdnm_create_manual_order(
  p_rep_id                text,
  p_customer_name         text,
  p_phone_e164            text,
  p_phone_10              text,
  p_delivery_street       text,
  p_delivery_city_name    text,
  p_delivery_state        text,
  p_city_id               uuid,
  p_delivery_lat          double precision,
  p_delivery_lng          double precision,
  p_date_needed           text,
  p_truck_access          text,
  p_dirt_purpose          text,
  p_material_type         text,
  p_yards_needed          integer,
  p_price_quoted_cents    integer,
  p_agent_id              uuid,
  p_source_number         text,
  p_allow_duplicate_phone boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agent                sales_agents%ROWTYPE;
  v_order_id             uuid;
  v_conversation_id      uuid;
  v_existing_conv        customer_conversations%ROWTYPE;
  v_opted_out            boolean;
  v_duplicate_orders     jsonb;
  v_full_address         text;
  v_price_per_yard_cents integer;
BEGIN
  -- a. Input sanity (defense in depth; app-layer Zod is the primary gate)
  IF p_yards_needed IS NULL OR p_yards_needed <= 0 THEN
    RETURN jsonb_build_object('block_reason','invalid_input','detail','yards_needed must be > 0');
  END IF;
  IF p_price_quoted_cents IS NULL OR p_price_quoted_cents <= 0 THEN
    RETURN jsonb_build_object('block_reason','invalid_input','detail','price_quoted_cents must be > 0');
  END IF;
  IF p_truck_access NOT IN ('dump_truck_only','dump_truck_and_18wheeler') THEN
    RETURN jsonb_build_object('block_reason','invalid_input','detail','truck_access enum violation');
  END IF;
  IF p_material_type NOT IN ('fill_dirt','structural_fill','screened_topsoil','sand') THEN
    RETURN jsonb_build_object('block_reason','invalid_input','detail','material_type enum violation');
  END IF;

  -- b. Agent validation + source_number consistency
  --    (trigger resolve_agent_from_source_number() on customer_conversations fires
  --    BEFORE INSERT/UPDATE and resolves agent_id from source_number. If these two
  --    disagree, the trigger silently rewrites agent_id to whatever source_number
  --    resolves to, corrupting our writes. Enforce consistency up-front.)
  SELECT * INTO v_agent FROM sales_agents WHERE id = p_agent_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('block_reason','invalid_agent','detail','agent not found or inactive');
  END IF;
  IF v_agent.twilio_number <> p_source_number THEN
    RETURN jsonb_build_object('block_reason','invalid_agent','detail','source_number does not match agent.twilio_number');
  END IF;

  -- c. City validation
  PERFORM 1 FROM cities WHERE id = p_city_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('block_reason','invalid_city_id');
  END IF;

  -- d. Rep validation (role IN rep|lead OR is_admin=true; is_active=true)
  PERFORM 1 FROM sales_reps
   WHERE id = p_rep_id
     AND is_active = true
     AND (role IN ('rep','lead') OR is_admin = true);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('block_reason','invalid_rep','detail','rep not authorized');
  END IF;

  -- e. Opt-out read (scoped by phone + agent_id; mirrors customer-brain.service.ts)
  SELECT opted_out INTO v_opted_out
    FROM customer_conversations
   WHERE phone = p_phone_10
     AND agent_id = p_agent_id
   LIMIT 1;
  v_opted_out := COALESCE(v_opted_out, false);

  -- f. Hijack check
  SELECT * INTO v_existing_conv
    FROM customer_conversations
   WHERE phone = p_phone_10
     AND agent_id = p_agent_id
     AND state <> 'CLOSED'
     AND opted_out = false
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'block_reason',    'active_conversation_exists',
      'conversation_id', v_existing_conv.id,
      'state',           v_existing_conv.state,
      'agent_name',      v_existing_conv.agent_name,
      'created_at',      v_existing_conv.created_at
    );
  END IF;

  -- g. Duplicate-order check (override via p_allow_duplicate_phone=true)
  IF NOT p_allow_duplicate_phone THEN
    SELECT jsonb_agg(jsonb_build_object(
      'id',           m.id,
      'city_id',      m.city_id,
      'yards_needed', m.yards_needed,
      'status',       m.status,
      'created_at',   m.created_at
    ))
    INTO v_duplicate_orders
    FROM (
      SELECT id, city_id, yards_needed, status, created_at
        FROM dispatch_orders
       WHERE client_phone = p_phone_e164
         AND status IN ('dispatching','in_progress')
       ORDER BY created_at DESC
       LIMIT 3
    ) m;

    IF v_duplicate_orders IS NOT NULL THEN
      RETURN jsonb_build_object(
        'block_reason','duplicate_order_possible',
        'matches',      v_duplicate_orders
      );
    END IF;
  END IF;

  -- Compose derived values
  v_full_address := p_delivery_street || ', ' || p_delivery_city_name || ', ' || p_delivery_state;
  v_price_per_yard_cents := p_price_quoted_cents / p_yards_needed; -- yards > 0 verified in (a)

  -- h. INSERT dispatch_orders
  INSERT INTO dispatch_orders (
    client_name,       client_phone,       client_address,
    city_id,           yards_needed,       price_quoted_cents,
    truck_type_needed, status,             source,             urgency,
    agent_id,          source_number,      material_type,
    delivery_latitude, delivery_longitude
  )
  VALUES (
    p_customer_name,   p_phone_e164,       v_full_address,
    p_city_id,         p_yards_needed,     p_price_quoted_cents,
    p_truck_access,    'dispatching',      'manual',            'standard',
    p_agent_id,        p_source_number,    p_material_type,
    p_delivery_lat,    p_delivery_lng
  )
  RETURNING id INTO v_order_id;

  -- i. UPSERT customer_conversations at state='QUOTING'
  --    The BEFORE INSERT/UPDATE trigger resolve_agent_from_source_number()
  --    will re-resolve agent_id from source_number; because step (b) verified
  --    v_agent.twilio_number = p_source_number, the trigger is a no-op for us.
  INSERT INTO customer_conversations (
    phone,                agent_id,         source_number,   state,          mode,
    customer_name,        delivery_address, delivery_city,
    delivery_lat,         delivery_lng,
    material_purpose,     material_type,    yards_needed,
    access_type,          delivery_date,
    price_per_yard_cents, total_price_cents,
    dispatch_order_id
  )
  VALUES (
    p_phone_10,           p_agent_id,       p_source_number, 'QUOTING',      'AI_ACTIVE',
    p_customer_name,      v_full_address,   p_delivery_city_name,
    p_delivery_lat,       p_delivery_lng,
    p_dirt_purpose,       p_material_type,  p_yards_needed,
    p_truck_access,       p_date_needed,
    v_price_per_yard_cents, p_price_quoted_cents,
    v_order_id
  )
  ON CONFLICT (phone, agent_id) DO UPDATE SET
    source_number        = EXCLUDED.source_number,
    state                = EXCLUDED.state,
    mode                 = EXCLUDED.mode,
    customer_name        = EXCLUDED.customer_name,
    delivery_address     = EXCLUDED.delivery_address,
    delivery_city        = EXCLUDED.delivery_city,
    delivery_lat         = EXCLUDED.delivery_lat,
    delivery_lng         = EXCLUDED.delivery_lng,
    material_purpose     = EXCLUDED.material_purpose,
    material_type        = EXCLUDED.material_type,
    yards_needed         = EXCLUDED.yards_needed,
    access_type          = EXCLUDED.access_type,
    delivery_date        = EXCLUDED.delivery_date,
    price_per_yard_cents = EXCLUDED.price_per_yard_cents,
    total_price_cents    = EXCLUDED.total_price_cents,
    dispatch_order_id    = EXCLUDED.dispatch_order_id,
    updated_at           = now()
    -- opted_out intentionally not touched: preserves existing flag across reopen-of-CLOSED
  RETURNING id INTO v_conversation_id;

  -- j. Success
  RETURN jsonb_build_object(
    'order_id',           v_order_id,
    'conversation_id',    v_conversation_id,
    'outbound_sms_ready', NOT v_opted_out
  );
END;
$$;

-- Explicit grants (service_role already bypasses RLS and can EXECUTE
-- SECURITY DEFINER functions; grants are for clarity and belt-and-suspenders).
GRANT EXECUTE ON FUNCTION fdnm_create_manual_order(
  text, text, text, text, text, text, text, uuid,
  double precision, double precision,
  text, text, text, text, integer, integer, uuid, text, boolean
) TO service_role;

GRANT EXECUTE ON FUNCTION fdnm_cleanup_manual_order_submissions() TO service_role;

COMMIT;

-- ============================================================================
-- POST-APPLY VERIFICATION — run these separately after the migration commits.
-- Every row returned should confirm a green check; any empty result = a bug.
-- ============================================================================
-- -- Tables exist
-- SELECT to_regclass('public.sms_consent')                 AS sms_consent,
--        to_regclass('public.manual_order_submissions')    AS manual_order_submissions;
--
-- -- admin_activity_log schema
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'admin_activity_log'
--    AND column_name IN ('admin_user_id','rep_id');
--
-- -- Actor-present CHECK
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conname = 'admin_activity_log_actor_present';
--
-- -- RPC signature + cleanup function
-- SELECT proname, pg_get_function_identity_arguments(oid) AS args
--   FROM pg_proc
--  WHERE proname IN ('fdnm_create_manual_order','fdnm_cleanup_manual_order_submissions');
--
-- -- RLS + policies
-- SELECT schemaname, tablename, rowsecurity
--   FROM pg_tables
--  WHERE tablename IN ('sms_consent','manual_order_submissions');
-- SELECT tablename, policyname, roles, cmd
--   FROM pg_policies
--  WHERE tablename IN ('sms_consent','manual_order_submissions');
--
-- -- pg_cron job scheduled (empty result means pg_cron is not installed, see NOTICE)
-- SELECT jobname, schedule, command
--   FROM cron.job
--  WHERE jobname = 'fdnm-cleanup-manual-order-submissions';
--
-- -- Smoke-test the RPC (dry: run inside a ROLLBACK transaction)
-- BEGIN;
-- SELECT fdnm_create_manual_order(
--   p_rep_id               => (SELECT id FROM sales_reps WHERE is_active=true LIMIT 1),
--   p_customer_name        => 'Test Customer',
--   p_phone_e164           => '+12145550199',
--   p_phone_10             => '2145550199',
--   p_delivery_street      => '123 Test St',
--   p_delivery_city_name   => (SELECT name  FROM cities LIMIT 1),
--   p_delivery_state       => (SELECT state FROM cities LIMIT 1),
--   p_city_id              => (SELECT id    FROM cities LIMIT 1),
--   p_delivery_lat         => NULL,
--   p_delivery_lng         => NULL,
--   p_date_needed          => 'Friday',
--   p_truck_access         => 'dump_truck_only',
--   p_dirt_purpose         => 'Pool backfill - test',
--   p_material_type        => 'fill_dirt',
--   p_yards_needed         => 10,
--   p_price_quoted_cents   => 50000,
--   p_agent_id             => (SELECT id             FROM sales_agents WHERE active=true LIMIT 1),
--   p_source_number        => (SELECT twilio_number  FROM sales_agents WHERE active=true LIMIT 1),
--   p_allow_duplicate_phone=> false
-- );
-- ROLLBACK;
-- ============================================================================
