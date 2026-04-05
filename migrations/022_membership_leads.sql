-- Membership leads from homepage signup form
CREATE TABLE IF NOT EXISTS membership_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  company_name text,
  phone text NOT NULL,
  email text NOT NULL,
  plan text NOT NULL CHECK (plan IN ('pickup', 'tandem', 'fleet')),
  monthly_yards text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
  stripe_checkout_url text,
  notes text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_membership_leads_dedup
  ON membership_leads (email, plan, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_membership_leads_status
  ON membership_leads (status, submitted_at DESC);
