-- =============================================================================
-- DumpSite.io — Migration 007: Short ID for SMS-friendly URLs
-- Carriers block long URLs with hex tokens (error 30034).
-- Short 8-char alphanumeric IDs solve this.
-- =============================================================================

ALTER TABLE job_access_tokens
  ADD COLUMN IF NOT EXISTS short_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_access_tokens_short_id
  ON job_access_tokens(short_id)
  WHERE short_id IS NOT NULL;

-- =============================================================================
-- DONE
-- =============================================================================
