-- ============================================================================
-- 031_customer_sms_logs_agent_id.sql
-- Target: Supabase project agsjodzzjrnqdopysjbb (dumpsite-production)
-- Apply by: Supabase SQL Editor.
-- Date: 2026-04-24
--
-- Stage 1.6 — add agent_id to customer_sms_logs so manual-order outbound
-- sends (via sendSMSWithAgent) can record which sales_agent was the sender.
--
-- Non-breaking: column is nullable. Sarah's existing logMsg() calls continue
-- without setting it (stays NULL) until a future refinement wires it in.
-- FK to sales_agents(id); index scoped by agent for the common lookup
-- "show me recent messages sent via agent X to phone Y".
-- ============================================================================

BEGIN;

ALTER TABLE customer_sms_logs
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES sales_agents(id);

CREATE INDEX IF NOT EXISTS idx_customer_sms_logs_agent_phone_created
  ON customer_sms_logs (agent_id, phone, created_at DESC)
  WHERE agent_id IS NOT NULL;

COMMIT;
