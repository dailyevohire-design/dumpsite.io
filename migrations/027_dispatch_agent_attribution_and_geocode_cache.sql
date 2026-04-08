-- 027: Sales-agent attribution on dispatch_orders + geocode cache table
-- Run via Supabase SQL editor.

-- 1. Per-order sales agent attribution. Nullable so legacy rows are unaffected.
ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES sales_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_number text;

CREATE INDEX IF NOT EXISTS idx_dispatch_orders_agent_id ON dispatch_orders(agent_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_source_number ON dispatch_orders(source_number);

-- 2. Geocode cache — avoid hammering Google Maps for repeat addresses.
CREATE TABLE IF NOT EXISTS geocode_cache (
  address_key text PRIMARY KEY,         -- normalized lowercased trimmed address
  raw_address text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  city text,
  source text NOT NULL DEFAULT 'google', -- google | nominatim | manual
  hits integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_last_used ON geocode_cache(last_used_at);
