-- =============================================================================
-- DumpSite.io — Migration 005: Secure Job Access & Tracking
-- Controlled reveal + tracking + completion proof
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: LOCK DOWN dispatch_orders FROM DRIVER READS
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "drivers_read_dispatch_orders" ON dispatch_orders;

-- Block all client-side SELECT for dispatch_orders
-- Admin reads go through service role via API routes
CREATE POLICY "no_driver_dispatch_order_reads" ON dispatch_orders
  FOR SELECT
  USING (false);

-- Allow admin users to UPDATE dispatch_orders (mark complete, etc.)
-- Admin role is set in user_metadata by Supabase auth
CREATE POLICY "admin_update_dispatch_orders" ON dispatch_orders
  FOR UPDATE
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'superadmin')
  );

-- Allow admin users to DELETE dispatch_orders
CREATE POLICY "admin_delete_dispatch_orders" ON dispatch_orders
  FOR DELETE
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'superadmin')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: JOB ACCESS TOKENS
-- One-time-use secure links for drivers to start jobs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_request_id uuid NOT NULL REFERENCES load_requests(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_access_tokens_load_request
  ON job_access_tokens(load_request_id);

CREATE INDEX IF NOT EXISTS idx_job_access_tokens_driver
  ON job_access_tokens(driver_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: JOB TRACKING SESSIONS
-- Tracks driver progression through the job lifecycle
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_tracking_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_request_id uuid NOT NULL REFERENCES load_requests(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
  terms_accepted_at timestamptz,
  location_permission_granted_at timestamptz,
  job_started_at timestamptz,
  address_revealed_at timestamptz,
  arrived_at timestamptz,
  completion_code_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ping_at timestamptz
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: JOB LOCATION PINGS
-- GPS breadcrumb trail while driver is en route
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_location_pings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_session_id uuid NOT NULL REFERENCES job_tracking_sessions(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_meters double precision,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_location_pings_session
  ON job_location_pings(tracking_session_id, recorded_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: JOB COMPLETION CODES
-- 4-digit codes given to driver on-site to prove they arrived
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_completion_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_request_id uuid NOT NULL UNIQUE REFERENCES load_requests(id) ON DELETE CASCADE,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by_driver_id uuid REFERENCES driver_profiles(user_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: ENABLE RLS ON NEW TABLES (backend/admin-only by default)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE job_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_location_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_completion_codes ENABLE ROW LEVEL SECURITY;

-- No client-side reads — all access through service role via API routes
-- These policies block all anon/authenticated direct reads
CREATE POLICY "no_direct_read_job_access_tokens" ON job_access_tokens
  FOR SELECT USING (false);

CREATE POLICY "no_direct_read_job_tracking_sessions" ON job_tracking_sessions
  FOR SELECT USING (false);

CREATE POLICY "no_direct_read_job_location_pings" ON job_location_pings
  FOR SELECT USING (false);

CREATE POLICY "no_direct_read_job_completion_codes" ON job_completion_codes
  FOR SELECT USING (false);

-- =============================================================================
-- DONE
-- =============================================================================
