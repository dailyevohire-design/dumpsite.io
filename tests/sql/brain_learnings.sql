-- Brain learnings table — tracks rules learned from production incidents.
-- Referenced by customer-brain and jesse-brain learning systems.
-- Safe to re-run: CREATE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS brain_learnings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  brain text NOT NULL CHECK (brain IN ('sarah', 'jesse')),
  rule text NOT NULL,
  category text DEFAULT 'general',
  priority int DEFAULT 5,
  active boolean DEFAULT true,
  times_injected int DEFAULT 0,
  improvement_signal float,
  created_at timestamptz DEFAULT now(),
  last_effectiveness_check timestamptz
);

CREATE INDEX IF NOT EXISTS idx_brain_learnings_active
  ON brain_learnings (brain, active, priority)
  WHERE active = true;
