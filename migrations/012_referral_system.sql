ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;

CREATE TABLE IF NOT EXISTS driver_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
  referred_id uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified', 'paid')),
  qualified_at timestamptz,
  loads_completed_by_referred int DEFAULT 0,
  loads_required_to_qualify int NOT NULL DEFAULT 5,
  bonus_amount_cents int NOT NULL DEFAULT 2500,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(referred_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON driver_referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON driver_referrals(referral_code);

ALTER TABLE driver_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers_read_own_referrals" ON driver_referrals
  FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
