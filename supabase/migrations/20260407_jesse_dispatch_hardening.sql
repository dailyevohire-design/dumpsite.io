-- Jesse dispatch hardening — 2026-04-07
-- Combines: failed_admin_alerts retry queue, sticky language column, driver payment uniqueness.

-- 1. Failed admin alert retry queue (payment-watchdog and any other cron with persistent SMS)
CREATE TABLE IF NOT EXISTS failed_admin_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempted_at timestamptz
);
CREATE INDEX IF NOT EXISTS failed_admin_alerts_created_idx ON failed_admin_alerts(created_at);

-- 2. Sticky language preference on driver_profiles
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS preferred_language text;

-- 3. Prevent double-pay: one payment row per (load_request, driver) pair
CREATE UNIQUE INDEX IF NOT EXISTS driver_payments_load_driver_unique
  ON driver_payments(load_request_id, driver_id);
