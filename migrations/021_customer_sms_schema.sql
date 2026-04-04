-- 021_customer_sms_schema.sql
-- Customer SMS system: conversations, logs, dedup, RPCs
-- Safe to run multiple times (IF NOT EXISTS / CREATE OR REPLACE)

-- ─────────────────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_conversations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL UNIQUE,
  state text DEFAULT 'NEW',
  customer_name text,
  customer_email text,
  delivery_address text,
  delivery_city text,
  delivery_lat double precision,
  delivery_lng double precision,
  material_purpose text,
  material_type text,
  yards_needed integer,
  dimensions_raw text,
  access_type text,
  delivery_date text,
  zone text,
  distance_miles double precision,
  price_per_yard_cents integer,
  total_price_cents integer,
  payment_method text,
  payment_account text,
  payment_status text DEFAULT 'pending',
  dispatch_order_id uuid,
  follow_up_at timestamptz,
  follow_up_count integer DEFAULT 0,
  opted_out boolean DEFAULT false,
  -- Priority order fields (Stripe payment for guaranteed delivery)
  order_type text,
  priority_total_cents integer,
  priority_guaranteed_date text,
  priority_quarry_name text,
  stripe_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_sms_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  body text,
  direction text NOT NULL,
  message_sid text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_processed_messages (
  message_sid text PRIMARY KEY,
  created_at timestamptz DEFAULT now()
);

-- If tables already exist but are missing priority columns, add them
DO $$ BEGIN
  ALTER TABLE customer_conversations ADD COLUMN IF NOT EXISTS order_type text;
  ALTER TABLE customer_conversations ADD COLUMN IF NOT EXISTS priority_total_cents integer;
  ALTER TABLE customer_conversations ADD COLUMN IF NOT EXISTS priority_guaranteed_date text;
  ALTER TABLE customer_conversations ADD COLUMN IF NOT EXISTS priority_quarry_name text;
  ALTER TABLE customer_conversations ADD COLUMN IF NOT EXISTS stripe_session_id text;
  ALTER TABLE customer_conversations ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
END $$;

-- ─────────────────────────────────────────────────────────
-- RLS — service_role only
-- ─────────────────────────────────────────────────────────

ALTER TABLE customer_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_processed_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_customer_conversations" ON customer_conversations FOR ALL TO service_role USING (true) WITH CHECK (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_customer_sms_logs" ON customer_sms_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_customer_processed_messages" ON customer_processed_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_customer_conv_phone ON customer_conversations(phone);
CREATE INDEX IF NOT EXISTS idx_customer_conv_state ON customer_conversations(state);
CREATE INDEX IF NOT EXISTS idx_customer_sms_phone ON customer_sms_logs(phone);
CREATE INDEX IF NOT EXISTS idx_customer_sms_created ON customer_sms_logs(created_at DESC);

-- ─────────────────────────────────────────────────────────
-- UPSERT RPC — COALESCE so nulls don't overwrite existing data
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION upsert_customer_conversation(
  p_phone text,
  p_state text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,
  p_delivery_address text DEFAULT NULL,
  p_delivery_city text DEFAULT NULL,
  p_delivery_lat double precision DEFAULT NULL,
  p_delivery_lng double precision DEFAULT NULL,
  p_material_purpose text DEFAULT NULL,
  p_material_type text DEFAULT NULL,
  p_yards_needed integer DEFAULT NULL,
  p_dimensions_raw text DEFAULT NULL,
  p_access_type text DEFAULT NULL,
  p_delivery_date text DEFAULT NULL,
  p_zone text DEFAULT NULL,
  p_distance_miles double precision DEFAULT NULL,
  p_price_per_yard_cents integer DEFAULT NULL,
  p_total_price_cents integer DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_payment_account text DEFAULT NULL,
  p_payment_status text DEFAULT NULL,
  p_dispatch_order_id uuid DEFAULT NULL,
  p_follow_up_at timestamptz DEFAULT NULL,
  p_follow_up_count integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO customer_conversations (phone, state, customer_name, customer_email,
    delivery_address, delivery_city, delivery_lat, delivery_lng,
    material_purpose, material_type, yards_needed, dimensions_raw,
    access_type, delivery_date, zone, distance_miles,
    price_per_yard_cents, total_price_cents,
    payment_method, payment_account, payment_status,
    dispatch_order_id, follow_up_at, follow_up_count, updated_at)
  VALUES (p_phone, COALESCE(p_state, 'NEW'), p_customer_name, p_customer_email,
    p_delivery_address, p_delivery_city, p_delivery_lat, p_delivery_lng,
    p_material_purpose, p_material_type, p_yards_needed, p_dimensions_raw,
    p_access_type, p_delivery_date, p_zone, p_distance_miles,
    p_price_per_yard_cents, p_total_price_cents,
    p_payment_method, p_payment_account, p_payment_status,
    p_dispatch_order_id, p_follow_up_at, p_follow_up_count, now())
  ON CONFLICT (phone) DO UPDATE SET
    state = COALESCE(p_state, customer_conversations.state),
    customer_name = COALESCE(p_customer_name, customer_conversations.customer_name),
    customer_email = COALESCE(p_customer_email, customer_conversations.customer_email),
    delivery_address = COALESCE(p_delivery_address, customer_conversations.delivery_address),
    delivery_city = COALESCE(p_delivery_city, customer_conversations.delivery_city),
    delivery_lat = COALESCE(p_delivery_lat, customer_conversations.delivery_lat),
    delivery_lng = COALESCE(p_delivery_lng, customer_conversations.delivery_lng),
    material_purpose = COALESCE(p_material_purpose, customer_conversations.material_purpose),
    material_type = COALESCE(p_material_type, customer_conversations.material_type),
    yards_needed = COALESCE(p_yards_needed, customer_conversations.yards_needed),
    dimensions_raw = COALESCE(p_dimensions_raw, customer_conversations.dimensions_raw),
    access_type = COALESCE(p_access_type, customer_conversations.access_type),
    delivery_date = COALESCE(p_delivery_date, customer_conversations.delivery_date),
    zone = COALESCE(p_zone, customer_conversations.zone),
    distance_miles = COALESCE(p_distance_miles, customer_conversations.distance_miles),
    price_per_yard_cents = COALESCE(p_price_per_yard_cents, customer_conversations.price_per_yard_cents),
    total_price_cents = COALESCE(p_total_price_cents, customer_conversations.total_price_cents),
    payment_method = COALESCE(p_payment_method, customer_conversations.payment_method),
    payment_account = COALESCE(p_payment_account, customer_conversations.payment_account),
    payment_status = COALESCE(p_payment_status, customer_conversations.payment_status),
    dispatch_order_id = COALESCE(p_dispatch_order_id, customer_conversations.dispatch_order_id),
    follow_up_at = COALESCE(p_follow_up_at, customer_conversations.follow_up_at),
    follow_up_count = COALESCE(p_follow_up_count, customer_conversations.follow_up_count),
    updated_at = now();
END;
$$;

-- ─────────────────────────────────────────────────────────
-- DEDUP RPC — returns true if new, false if duplicate
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_customer_message(p_sid text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO customer_processed_messages (message_sid) VALUES (p_sid);
  RETURN true;
EXCEPTION WHEN unique_violation THEN
  RETURN false;
END;
$$;

-- ─────────────────────────────────────────────────────────
-- AUTO-UPDATE updated_at trigger
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_customer_conv_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_conv_updated_at ON customer_conversations;
CREATE TRIGGER trg_customer_conv_updated_at
  BEFORE UPDATE ON customer_conversations
  FOR EACH ROW EXECUTE FUNCTION update_customer_conv_updated_at();
