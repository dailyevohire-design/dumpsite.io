-- Site visitor tracking for analytics and geo identification
CREATE TABLE IF NOT EXISTS site_visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip inet NOT NULL,
  city text,
  region text,
  country text,
  latitude text,
  longitude text,
  user_agent text,
  path text,
  referer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying by IP and time
CREATE INDEX idx_site_visitors_ip ON site_visitors (ip);
CREATE INDEX idx_site_visitors_created_at ON site_visitors (created_at DESC);
CREATE INDEX idx_site_visitors_country ON site_visitors (country);

-- RLS: only admin/service role can read
ALTER TABLE site_visitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on site_visitors"
  ON site_visitors FOR ALL
  USING (auth.role() = 'service_role');
