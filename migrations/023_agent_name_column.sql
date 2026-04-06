-- 023_agent_name_column.sql
-- Add agent_name to customer_conversations for multi-agent routing
-- Safe to run multiple times (IF NOT EXISTS / CREATE OR REPLACE)

-- ─────────────────────────────────────────────────────────
-- ADD COLUMN
-- ─────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE customer_conversations ADD COLUMN IF NOT EXISTS agent_name text DEFAULT 'sarah';
END $$;

-- ─────────────────────────────────────────────────────────
-- UPDATE UPSERT RPC to include agent_name
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
  p_follow_up_count integer DEFAULT NULL,
  p_agent_name text DEFAULT NULL
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
    dispatch_order_id, follow_up_at, follow_up_count, agent_name, updated_at)
  VALUES (p_phone, COALESCE(p_state, 'NEW'), p_customer_name, p_customer_email,
    p_delivery_address, p_delivery_city, p_delivery_lat, p_delivery_lng,
    p_material_purpose, p_material_type, p_yards_needed, p_dimensions_raw,
    p_access_type, p_delivery_date, p_zone, p_distance_miles,
    p_price_per_yard_cents, p_total_price_cents,
    p_payment_method, p_payment_account, p_payment_status,
    p_dispatch_order_id, p_follow_up_at, p_follow_up_count, COALESCE(p_agent_name, 'sarah'), now())
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
    agent_name = COALESCE(p_agent_name, customer_conversations.agent_name),
    updated_at = now();
END;
$$;
