CREATE TABLE IF NOT EXISTS driver_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  action_url text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON driver_notifications(user_id, is_read, created_at DESC);
ALTER TABLE driver_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_notifications" ON driver_notifications
  FOR ALL USING (auth.uid() = user_id);
