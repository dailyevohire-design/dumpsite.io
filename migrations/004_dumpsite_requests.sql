-- Table for dumpsite interest submissions from the public form
CREATE TABLE IF NOT EXISTS dumpsite_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  material text NOT NULL,
  yards_needed integer NOT NULL DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'new',  -- new, contacted, converted, closed
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER set_dumpsite_requests_updated_at
  BEFORE UPDATE ON dumpsite_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index for duplicate detection (name + phone + city + recent time)
CREATE INDEX IF NOT EXISTS idx_dumpsite_requests_dedup
  ON dumpsite_requests (name, phone, city, submitted_at DESC);

-- Index for admin listing
CREATE INDEX IF NOT EXISTS idx_dumpsite_requests_status
  ON dumpsite_requests (status, submitted_at DESC);
