-- ═══════════════════════════════════════════════════════════════════════════
-- should_notify_admin RPC + brain_alerts.last_notified_at / source columns
--
-- Companion to lib/alerts/notify-admin-throttled.ts. Centralizes the
-- "have we already sent this (alert_class, phone) pair within the cooldown
-- window?" check so every code path that pages the admin shares one
-- DB-side cooldown rather than each maintaining its own in-memory map
-- (which doesn't survive cold starts and isn't shared across regions).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- This file mirrors what is already deployed in production via MCP on
-- 2026-04-27 (the apply-via-MCP step happened before the file was committed
-- to the repo); applying it again to prod is a no-op.
--
-- Returns:
--   true  → caller should send the SMS; an audit row was inserted (or the
--           existing row's last_notified_at refreshed) so the next call
--           within the window will see it.
--   false → caller should suppress the SMS; existing row is annotated with
--           a [suppressed at ...] line in error_message for forensics.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE brain_alerts
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS source           text;

CREATE OR REPLACE FUNCTION should_notify_admin(
  p_alert_class      text,
  p_phone            text,
  p_cooldown_minutes integer DEFAULT 60,
  p_message          text    DEFAULT NULL,
  p_source           text    DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff    timestamptz := now() - (p_cooldown_minutes || ' minutes')::interval;
  v_recent_id uuid;
BEGIN
  -- Serialize concurrent callers for the same (class, phone) within this xact.
  PERFORM pg_advisory_xact_lock(hashtext(p_alert_class || ':' || p_phone));

  SELECT id INTO v_recent_id
    FROM brain_alerts
   WHERE alert_class = p_alert_class
     AND phone       = p_phone
     AND last_notified_at >= v_cutoff
   ORDER BY last_notified_at DESC
   LIMIT 1;

  IF v_recent_id IS NOT NULL THEN
    UPDATE brain_alerts
       SET error_message = COALESCE(error_message, '') ||
           E'\n[suppressed at ' || now()::text || ']' ||
           COALESCE(' ' || p_message, '')
     WHERE id = v_recent_id;
    RETURN false;
  END IF;

  INSERT INTO brain_alerts (
    phone, alert_class, source, error_message, last_notified_at, created_at
  ) VALUES (
    p_phone, p_alert_class, p_source, p_message, now(), now()
  );
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION should_notify_admin(text, text, integer, text, text) TO service_role;
