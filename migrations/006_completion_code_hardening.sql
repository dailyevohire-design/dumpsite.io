-- =============================================================================
-- DumpSite.io — Migration 006: Completion Code Hardening
-- Rate limiting for completion code attempts
-- =============================================================================

CREATE TABLE IF NOT EXISTS completion_code_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_request_id uuid NOT NULL REFERENCES load_requests(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
  attempted_code text,
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_completion_code_attempts_load_driver
  ON completion_code_attempts(load_request_id, driver_id, created_at DESC);

ALTER TABLE completion_code_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no_direct_read_completion_code_attempts" ON completion_code_attempts
  FOR SELECT USING (false);

-- =============================================================================
-- DONE
-- =============================================================================
