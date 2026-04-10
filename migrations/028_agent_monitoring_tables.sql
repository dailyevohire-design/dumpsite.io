-- Migration 028: Agent monitoring tables + needs_human_review columns
-- Run in Supabase SQL Editor

-- 1. Health watchdog logs
CREATE TABLE IF NOT EXISTS agent_health_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at timestamptz NOT NULL,
  jesse_issues jsonb NOT NULL DEFAULT '{}',
  sarah_issues jsonb NOT NULL DEFAULT '{}',
  dispatch_issues jsonb NOT NULL DEFAULT '{}',
  total_issue_count int NOT NULL DEFAULT 0,
  alert_sent bool NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_health_logs_checked_at ON agent_health_logs (checked_at DESC);

-- 2. Rescue agent logs
CREATE TABLE IF NOT EXISTS agent_rescue_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system text NOT NULL CHECK (system IN ('jesse', 'sarah')),
  phone text NOT NULL,
  stuck_state text NOT NULL,
  rescue_message text NOT NULL DEFAULT '',
  attempt_number int NOT NULL DEFAULT 1,
  escalated bool NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_rescue_logs_phone ON agent_rescue_logs (phone, system, sent_at DESC);

-- 3. Add needs_human_review to both conversation tables (safe — IF NOT EXISTS via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'needs_human_review'
  ) THEN
    ALTER TABLE conversations ADD COLUMN needs_human_review bool NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customer_conversations' AND column_name = 'needs_human_review'
  ) THEN
    ALTER TABLE customer_conversations ADD COLUMN needs_human_review bool NOT NULL DEFAULT false;
  END IF;
END $$;
