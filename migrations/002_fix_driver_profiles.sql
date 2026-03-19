-- =====================================================================
-- DumpSite.io — Fix Existing Driver Profiles
-- Run in Supabase SQL Editor
-- =====================================================================

-- Set phone_verified = true for all existing drivers who have a phone number
-- (They signed up and we collected their phone — mark as verified)
UPDATE driver_profiles
SET phone_verified = true
WHERE phone IS NOT NULL
  AND phone != ''
  AND phone_verified = false;

-- Set default city to Dallas for drivers with no city_id
-- This ensures they receive dispatch SMS for Dallas jobs
UPDATE driver_profiles
SET city_id = (
  SELECT id FROM cities
  WHERE name ILIKE '%Dallas%'
    AND is_active = true
  LIMIT 1
)
WHERE city_id IS NULL;

-- Set status = 'active' for any drivers stuck in pending
UPDATE driver_profiles
SET status = 'active'
WHERE status IS NULL OR status = 'pending';

-- Set default gps_score if null
UPDATE driver_profiles
SET gps_score = 85
WHERE gps_score IS NULL;

-- Verify the fix
SELECT
  COUNT(*) as total_drivers,
  COUNT(CASE WHEN phone_verified = true THEN 1 END) as phone_verified_count,
  COUNT(CASE WHEN city_id IS NOT NULL THEN 1 END) as has_city_count,
  COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count
FROM driver_profiles;
