-- Phase 10 — Production monitoring tables for Jesse's brain.
--
-- Apply in Supabase: SQL Editor → paste → Run. Idempotent.

-- Every brain decision (every inbound SMS that produced a reply) gets one row.
CREATE TABLE IF NOT EXISTS brain_decisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_phone text NOT NULL,
  message_sid text,
  incoming_body text,
  state_before text,
  state_after text,
  handler text CHECK (handler IN ('template', 'sonnet', 'safety_net', 'fallback')),
  response_text text,
  response_length int,
  validator_replaced boolean DEFAULT false,
  validator_reason text,
  latency_ms int,
  delay_ms int,
  model_used text,
  tokens_used int,
  -- Phase 11 experiment tracking columns live here too
  experiment_id text,
  experiment_variant text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_decisions_phone
  ON brain_decisions (conversation_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_decisions_handler
  ON brain_decisions (handler, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_decisions_experiment
  ON brain_decisions (experiment_id, experiment_variant) WHERE experiment_id IS NOT NULL;

-- Per-conversation aggregate scores (populated by conversation-monitor.service).
CREATE TABLE IF NOT EXISTS conversation_scores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_phone text NOT NULL,
  completion_score float,
  efficiency_score float,
  frustration_score float,
  safety_net_count int DEFAULT 0,
  validator_replacement_count int DEFAULT 0,
  template_hit_rate float,
  total_turns int,
  reached_payment boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_scores_phone
  ON conversation_scores (conversation_phone, created_at DESC);

-- Hourly metrics rollup for dashboards.
DROP MATERIALIZED VIEW IF EXISTS brain_metrics_hourly;
CREATE MATERIALIZED VIEW brain_metrics_hourly AS
SELECT
  date_trunc('hour', created_at) AS hour,
  COUNT(*)                                                   AS total_messages,
  COUNT(*) FILTER (WHERE handler = 'template')               AS template_hits,
  COUNT(*) FILTER (WHERE handler = 'sonnet')                 AS sonnet_hits,
  COUNT(*) FILTER (WHERE handler IN ('safety_net','fallback')) AS safety_net_fires,
  COUNT(*) FILTER (WHERE validator_replaced = true)          AS validator_replacements,
  AVG(latency_ms)                                            AS avg_latency_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)   AS p99_latency_ms,
  AVG(response_length)                                       AS avg_response_length,
  AVG(delay_ms)                                              AS avg_delay_ms
FROM brain_decisions
WHERE created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY 1 DESC;

-- Refresh manually, via Supabase cron, or via pg_cron:
--   REFRESH MATERIALIZED VIEW brain_metrics_hourly;
-- With pg_cron (requires extension):
--   SELECT cron.schedule('refresh-brain-metrics','0 * * * *','REFRESH MATERIALIZED VIEW brain_metrics_hourly;');
