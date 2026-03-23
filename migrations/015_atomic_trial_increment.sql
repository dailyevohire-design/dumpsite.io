-- Migration 015: Atomic trial load increment
-- Prevents race condition where two concurrent requests both pass the trial check
CREATE OR REPLACE FUNCTION increment_trial_loads(p_user_id uuid)
RETURNS TABLE(new_count int, limit_reached bool) AS $$
DECLARE
  v_used int;
  v_limit int;
BEGIN
  SELECT
    dp.trial_loads_used,
    t.trial_load_limit
  INTO v_used, v_limit
  FROM driver_profiles dp
  JOIN tiers t ON t.id = dp.tier_id
  WHERE dp.user_id = p_user_id
  FOR UPDATE;

  IF v_used >= v_limit THEN
    RETURN QUERY SELECT v_used, true;
    RETURN;
  END IF;

  UPDATE driver_profiles
  SET trial_loads_used = trial_loads_used + 1
  WHERE user_id = p_user_id;

  RETURN QUERY SELECT v_used + 1, false;
END;
$$ LANGUAGE plpgsql;
