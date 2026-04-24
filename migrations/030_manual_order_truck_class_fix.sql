-- ============================================================================
-- 030_manual_order_truck_class_fix.sql
-- Target: Supabase project agsjodzzjrnqdopysjbb (dumpsite-production)
-- Apply by: Supabase SQL Editor. Paste the whole file; run once.
-- Date: 2026-04-24
--
-- Stage 1.5 — fix truck_type_needed domain mismatch in fdnm_create_manual_order.
--
-- Background:
--   truck_type_needed on dispatch_orders is TRUCK CLASS (driver vehicle type:
--   tandem_axle, end_dump, dump_truck, 18_wheeler). It drives driver-pay
--   lookup (FLAT_TRUCK_PAY_CENTS in dispatch.service.ts) and driver-side
--   jobs-feed filtering. It is NOT a site-access enum.
--
--   The Stage 1 RPC wrote p_truck_access (site-access enum values
--   'dump_truck_only' / 'dump_truck_and_18wheeler') directly into this column,
--   which would (1) break driver-pay lookup (unknown key) and (2) render
--   manual orders inconsistently vs SMS/web_form orders in the admin dashboard.
--
-- Fix:
--   Add a local v_truck_class and map site-access → truck-class inside the
--   RPC. customer_conversations.access_type keeps receiving p_truck_access
--   directly — that column IS a site-access enum (Sarah writes the same values).
--
--   Mapping (approved by Juan 2026-04-24):
--     'dump_truck_only'          → 'tandem_axle'
--     'dump_truck_and_18wheeler' → 'end_dump'
--
--   Caveat: when an access-permitted site could be served by a tandem_axle
--   (small load, driver availability), this over-maps to end_dump. Acceptable
--   for now — downstream dispatch can override truck_type_needed at driver
--   assignment time. Logged as a future refinement.
--
-- Nothing else in the RPC changes. Same 19 params, same signature, same
-- return shape, same grants (CREATE OR REPLACE preserves them).
-- ============================================================================

BEGIN;

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
  v_truck_class          text;
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

  -- Map customer-reported site access to dispatch truck class.
  -- Site access (dump_truck_only vs dump_truck_and_18wheeler) describes what
  -- physically fits at the delivery property. Yards drives truck count in
  -- downstream dispatch, not class.
  v_truck_class := CASE p_truck_access
    WHEN 'dump_truck_only'          THEN 'tandem_axle'
    WHEN 'dump_truck_and_18wheeler' THEN 'end_dump'
  END;

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
  --    CHANGED from Stage 1: truck_type_needed now uses v_truck_class (truck
  --    class derived from site access), not p_truck_access (site-access enum).
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
    v_truck_class,     'dispatching',      'manual',            'standard',
    p_agent_id,        p_source_number,    p_material_type,
    p_delivery_lat,    p_delivery_lng
  )
  RETURNING id INTO v_order_id;

  -- i. UPSERT customer_conversations at state='QUOTING'
  --    UNCHANGED: access_type continues to receive p_truck_access directly
  --    (this column IS a site-access enum — Sarah writes the same values).
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

COMMIT;
