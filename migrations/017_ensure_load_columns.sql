-- =============================================================================
-- DumpSite.io — Migration 017: Ensure all load_requests columns exist
-- The code expects these columns but they may not exist in all environments.
-- All ADD COLUMN IF NOT EXISTS — safe to run multiple times.
-- =============================================================================

-- Core completion columns (used by complete-load API)
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS completion_photo_url text;
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS payout_cents int;
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Geofence columns (used by complete-load geofence check)
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS completion_latitude double precision;
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS completion_longitude double precision;
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS completion_distance_km double precision;
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS requires_manual_review boolean DEFAULT false;

-- Fraud detection columns (used by fraud engine)
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS fraud_score int DEFAULT 0;
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS fraud_flags jsonb DEFAULT '[]'::jsonb;
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS flagged_for_review boolean DEFAULT false;
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS ping_count int DEFAULT 0;

-- Rejection tracking
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS rejected_reason text;
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS reviewed_by uuid;

-- Idempotency
ALTER TABLE load_requests ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_load_requests_idempotency
  ON load_requests(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- =============================================================================
-- DONE — Run this in Supabase SQL Editor immediately
-- =============================================================================
