CREATE TABLE IF NOT EXISTS driver_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
  subscription_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON driver_push_subscriptions(user_id);
ALTER TABLE driver_push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_push" ON driver_push_subscriptions
  FOR ALL USING (auth.uid() = user_id);
