-- =============================================================================
-- DumpSite.io — Production Database Migration
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Safe to run multiple times (uses IF NOT EXISTS / CREATE OR REPLACE)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: PERFORMANCE INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- load_requests: driver dashboard query
CREATE INDEX IF NOT EXISTS idx_load_requests_driver_status
  ON load_requests (driver_id, status);

-- load_requests: admin pending queue sorted by time
CREATE INDEX IF NOT EXISTS idx_load_requests_status_submitted
  ON load_requests (status, submitted_at ASC);

-- load_requests: admin loads by dispatch order
CREATE INDEX IF NOT EXISTS idx_load_requests_dispatch_order
  ON load_requests (dispatch_order_id);

-- load_requests: idempotency enforcement
CREATE UNIQUE INDEX IF NOT EXISTS idx_load_requests_idempotency
  ON load_requests (idempotency_key);

-- dispatch_orders: driver job map by city
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_city_status
  ON dispatch_orders (city_id, status);

-- dispatch_orders: admin chronological view
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_created_desc
  ON dispatch_orders (created_at DESC);

-- dispatch_orders: zapier idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_orders_zapier_row
  ON dispatch_orders (zapier_row_id)
  WHERE zapier_row_id IS NOT NULL;

-- driver_profiles: dispatch SMS targeting
CREATE INDEX IF NOT EXISTS idx_driver_profiles_city_status_phone
  ON driver_profiles (city_id, status, phone_verified);

-- driver_profiles: tier-based dispatch ordering
CREATE INDEX IF NOT EXISTS idx_driver_profiles_tier
  ON driver_profiles (tier_id);

-- dump_sites: active sites by city
CREATE INDEX IF NOT EXISTS idx_dump_sites_city_active
  ON dump_sites (city_id, is_active);

-- audit_logs: audit trail per record
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id);

-- audit_logs: per-user activity history
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON audit_logs (actor_id, created_at DESC);

-- sms_log: delivery check per load
CREATE INDEX IF NOT EXISTS idx_sms_log_related
  ON sms_log (related_id, message_type);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: updated_at TRIGGERS
-- Auto-updates updated_at on every row change. Critical for cache invalidation.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at column if missing (safe to run if already exists)
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

ALTER TABLE load_requests
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

ALTER TABLE dump_sites
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

-- Create triggers (drop first to allow re-running)
DROP TRIGGER IF EXISTS set_updated_at_driver_profiles ON driver_profiles;
CREATE TRIGGER set_updated_at_driver_profiles
  BEFORE UPDATE ON driver_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_dispatch_orders ON dispatch_orders;
CREATE TRIGGER set_updated_at_dispatch_orders
  BEFORE UPDATE ON dispatch_orders
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_load_requests ON load_requests;
CREATE TRIGGER set_updated_at_load_requests
  BEFORE UPDATE ON load_requests
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_dump_sites ON dump_sites;
CREATE TRIGGER set_updated_at_dump_sites
  BEFORE UPDATE ON dump_sites
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: CONTRACTOR PROFILES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contractor_profiles (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name       text NOT NULL,
  contact_name       text NOT NULL,
  phone              text NOT NULL CHECK (phone ~ '^\+[1-9]\d{7,14}$'),
  email              text NOT NULL,
  billing_address    text,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('active', 'suspended', 'pending')),
  verified_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT NOW(),
  updated_at         timestamptz NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_contractor_profiles ON contractor_profiles;
CREATE TRIGGER set_updated_at_contractor_profiles
  BEFORE UPDATE ON contractor_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: MATERIAL APPROVALS
-- Tracks which drivers are pre-approved for which material/site combinations.
-- Enables the auto-approval flow for trusted drivers.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS material_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id      uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
  dump_site_id   uuid NOT NULL REFERENCES dump_sites(id) ON DELETE CASCADE,
  material_type  text NOT NULL,
  approved_by    uuid NOT NULL REFERENCES auth.users(id),
  approved_at    timestamptz NOT NULL DEFAULT NOW(),
  expires_at     timestamptz,
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE (driver_id, dump_site_id, material_type)
);

CREATE INDEX IF NOT EXISTS idx_material_approvals_driver_site
  ON material_approvals (driver_id, dump_site_id, is_active);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: ADDRESS RELEASES
-- Immutable audit log of every dumpsite address sent to a driver.
-- Critical for privacy compliance and dispute resolution.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS address_releases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_request_id  uuid NOT NULL REFERENCES load_requests(id) ON DELETE RESTRICT,
  driver_id        uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE RESTRICT,
  dump_site_id     uuid REFERENCES dump_sites(id) ON DELETE RESTRICT,
  dispatch_order_id uuid REFERENCES dispatch_orders(id) ON DELETE RESTRICT,
  released_at      timestamptz NOT NULL DEFAULT NOW(),
  release_method   text NOT NULL CHECK (release_method IN ('sms', 'email', 'manual')),
  released_by      uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_address_releases_load
  ON address_releases (load_request_id);

CREATE INDEX IF NOT EXISTS idx_address_releases_driver
  ON address_releases (driver_id, released_at DESC);

-- Prevent updates/deletes — this table is append-only
CREATE OR REPLACE RULE address_releases_no_update AS
  ON UPDATE TO address_releases DO INSTEAD NOTHING;

CREATE OR REPLACE RULE address_releases_no_delete AS
  ON DELETE TO address_releases DO INSTEAD NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: PAYOUTS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id          uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE RESTRICT,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  total_cents        int NOT NULL CHECK (total_cents >= 0),
  payout_method      text NOT NULL DEFAULT 'ach'
                       CHECK (payout_method IN ('ach', 'wire')),
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  processed_at       timestamptz,
  external_reference text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT NOW(),
  updated_at         timestamptz NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_payouts ON payouts;
CREATE TRIGGER set_updated_at_payouts
  BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_payouts_driver_status
  ON payouts (driver_id, status);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7: DATABASE CONSTRAINTS
-- Additional check constraints for data integrity
-- ─────────────────────────────────────────────────────────────────────────────

-- load_requests constraints
ALTER TABLE load_requests
  DROP CONSTRAINT IF EXISTS chk_load_status,
  ADD CONSTRAINT chk_load_status
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed'));

ALTER TABLE load_requests
  DROP CONSTRAINT IF EXISTS chk_truck_count,
  ADD CONSTRAINT chk_truck_count
    CHECK (truck_count BETWEEN 1 AND 200);

ALTER TABLE load_requests
  DROP CONSTRAINT IF EXISTS chk_yards_positive,
  ADD CONSTRAINT chk_yards_positive
    CHECK (yards_estimated > 0);

-- dispatch_orders constraints
ALTER TABLE dispatch_orders
  DROP CONSTRAINT IF EXISTS chk_dispatch_status,
  ADD CONSTRAINT chk_dispatch_status
    CHECK (status IN ('dispatching', 'active', 'completed', 'cancelled'));

ALTER TABLE dispatch_orders
  DROP CONSTRAINT IF EXISTS chk_yards_needed,
  ADD CONSTRAINT chk_yards_needed
    CHECK (yards_needed > 0);

-- driver_profiles constraints
ALTER TABLE driver_profiles
  DROP CONSTRAINT IF EXISTS chk_gps_score,
  ADD CONSTRAINT chk_gps_score
    CHECK (gps_score BETWEEN 0 AND 100);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 8: ROW LEVEL SECURITY POLICIES
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE load_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE address_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_profiles ENABLE ROW LEVEL SECURITY;

-- ── driver_profiles ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "drivers_read_own" ON driver_profiles;
CREATE POLICY "drivers_read_own" ON driver_profiles
  FOR SELECT USING (auth.uid() = user_id);

-- Updates go through API routes using service role — no direct client update
DROP POLICY IF EXISTS "drivers_no_direct_update" ON driver_profiles;

-- ── load_requests ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "drivers_read_own_loads" ON load_requests;
CREATE POLICY "drivers_read_own_loads" ON load_requests
  FOR SELECT USING (auth.uid() = driver_id);

-- No direct client inserts — must go through API
DROP POLICY IF EXISTS "no_direct_load_insert" ON load_requests;

-- ── dispatch_orders ───────────────────────────────────────────────────────────
-- Drivers can read dispatch orders (but NOT client_address — excluded at API level)
DROP POLICY IF EXISTS "drivers_read_dispatch_orders" ON dispatch_orders;
CREATE POLICY "drivers_read_dispatch_orders" ON dispatch_orders
  FOR SELECT USING (auth.role() = 'authenticated');

-- ── audit_logs ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_logs_insert_authenticated" ON audit_logs;
CREATE POLICY "audit_logs_insert_authenticated" ON audit_logs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- No SELECT for non-admins — admin reads via service role
-- No UPDATE or DELETE ever

-- ── address_releases ─────────────────────────────────────────────────────────
-- Only service role can insert/read — enforced at API level

-- ── payouts ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "drivers_read_own_payouts" ON payouts;
CREATE POLICY "drivers_read_own_payouts" ON payouts
  FOR SELECT USING (auth.uid() = driver_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9: ANALYTICS SNAPSHOTS (for future reporting without hitting prod)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_driver_stats (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       uuid NOT NULL REFERENCES driver_profiles(user_id),
  date            date NOT NULL,
  loads_submitted int NOT NULL DEFAULT 0,
  loads_approved  int NOT NULL DEFAULT 0,
  loads_rejected  int NOT NULL DEFAULT 0,
  loads_completed int NOT NULL DEFAULT 0,
  total_payout_cents int NOT NULL DEFAULT 0,
  UNIQUE (driver_id, date)
);

CREATE TABLE IF NOT EXISTS city_demand_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id         uuid NOT NULL REFERENCES cities(id),
  date            date NOT NULL,
  active_orders   int NOT NULL DEFAULT 0,
  drivers_notified int NOT NULL DEFAULT 0,
  loads_completed int NOT NULL DEFAULT 0,
  UNIQUE (city_id, date)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- DONE — Run this and check for errors above before proceeding
-- ─────────────────────────────────────────────────────────────────────────────
