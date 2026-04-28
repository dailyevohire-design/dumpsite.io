-- Migration: lockdown_create_sms_driver_and_dead_admin_policies
-- Date: 2026-04-28
-- Purpose: close the last two pre-launch blockers.
--
-- BLOCKER 1: public.create_sms_driver(text, text, text) is SECURITY DEFINER and was
-- EXECUTE-able by PUBLIC, anon, and authenticated. Anyone with the publishable anon
-- key could POST /rest/v1/rpc/create_sms_driver and stuff driver_profiles with rows
-- whose user_id is gen_random_uuid() (orphan rows, no matching auth.users entry).
-- This is the orphan-driver mechanism behind F-001's 130 phantoms.
--
-- Fix: REVOKE EXECUTE FROM PUBLIC, anon, authenticated. Keep service_role.
-- Server-side driver creation continues via createAdminSupabase().
--
-- BLOCKER 2: admin_update_dispatch_orders / admin_delete_dispatch_orders gate on
--   (auth.jwt() -> 'app_metadata') ->> 'role' IN ('admin', 'superadmin')
-- Verified via MCP: zero rows in auth.users have raw_app_meta_data ? 'role'. Both
-- policies evaluate false silently — every admin UPDATE/DELETE in app/admin/page.tsx
-- has been failing with no rows affected and no error since the policies were written.
--
-- Fix: drop both policies. No replacement. Admin mutations move server-side to
-- /api/admin/dispatch-orders/[id] using createAdminSupabase() (service_role bypasses
-- RLS) gated by the existing rep-portal admin session check. See companion commit.
--
-- This migration is idempotent and safe to re-run.

-- ── Blocker 1: lock down create_sms_driver ─────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.create_sms_driver(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_sms_driver(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_sms_driver(text, text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.create_sms_driver(text, text, text) TO service_role;

-- ── Blocker 2: drop dead admin policies on dispatch_orders ─────────────────────
DROP POLICY IF EXISTS admin_update_dispatch_orders ON public.dispatch_orders;
DROP POLICY IF EXISTS admin_delete_dispatch_orders ON public.dispatch_orders;
