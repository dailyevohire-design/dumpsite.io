-- =============================================================================
-- DumpSite.io — Migration 008: Fix Signup Profile Creation
-- Adds INSERT RLS policy so new drivers can create their own profile at signup.
-- The API route handles this now, but this policy is belt-and-suspenders.
-- =============================================================================

DROP POLICY IF EXISTS "drivers_insert_own_profile" ON driver_profiles;
CREATE POLICY "drivers_insert_own_profile" ON driver_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- DONE
-- =============================================================================
