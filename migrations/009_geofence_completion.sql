-- =============================================================================
-- DumpSite.io — Migration 009: Geofence Completion Columns
-- GPS-based completion verification instead of completion codes
-- =============================================================================

ALTER TABLE load_requests
  ADD COLUMN IF NOT EXISTS completion_latitude double precision,
  ADD COLUMN IF NOT EXISTS completion_longitude double precision,
  ADD COLUMN IF NOT EXISTS completion_distance_km double precision,
  ADD COLUMN IF NOT EXISTS requires_manual_review boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_load_requests_manual_review
  ON load_requests(requires_manual_review)
  WHERE requires_manual_review = true;

-- =============================================================================
-- DONE
-- =============================================================================
