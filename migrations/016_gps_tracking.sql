-- =============================================================================
-- DumpSite.io — Migration 016: Enhanced GPS Tracking & Fraud Detection
-- Adds delivery coordinates, fraud detection columns, and ping enrichment
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: Add delivery coordinates to dispatch_orders
-- Enables GPS-based geofence checks without geocoding on every ping
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS delivery_latitude double precision,
  ADD COLUMN IF NOT EXISTS delivery_longitude double precision;

CREATE INDEX IF NOT EXISTS idx_dispatch_orders_coords
  ON dispatch_orders(delivery_latitude, delivery_longitude)
  WHERE delivery_latitude IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Add fraud detection columns to load_requests
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE load_requests
  ADD COLUMN IF NOT EXISTS fraud_score int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fraud_flags jsonb DEFAULT '[]'::jsonb;

-- Note: flagged_for_review, requires_manual_review, completion_latitude,
-- completion_longitude, completion_distance_km, ping_count already exist
-- from migrations 009. Add only if missing:
ALTER TABLE load_requests
  ADD COLUMN IF NOT EXISTS ping_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flagged_for_review boolean DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: Enrich job_location_pings with distance + site detection
-- Table already exists from migration 005 — add new columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE job_location_pings
  ADD COLUMN IF NOT EXISTS speed_kmh double precision,
  ADD COLUMN IF NOT EXISTS heading double precision,
  ADD COLUMN IF NOT EXISTS distance_from_delivery_km double precision,
  ADD COLUMN IF NOT EXISTS at_delivery_site boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pings_delivery
  ON job_location_pings(at_delivery_site, recorded_at)
  WHERE at_delivery_site = true;

-- =============================================================================
-- DONE
-- =============================================================================
