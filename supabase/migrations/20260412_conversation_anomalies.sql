-- Real-time anomaly logging for Sarah's brain.
-- Every failure pattern gets logged the moment it occurs so we catch
-- problems in real time instead of after forensic analysis.
CREATE TABLE IF NOT EXISTS conversation_anomalies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  anomaly_type text NOT NULL,  -- 'ai_detected', 'address_lost', 'duplicate_message',
                                -- 'state_regression', 'collecting_timeout', 'photo_burst',
                                -- 'dedup_exhausted', 'yards_null_after_quote'
  severity text NOT NULL,       -- 'critical', 'high', 'medium', 'low'
  details jsonb,                -- full context: message, state, conv snapshot
  resolved_at timestamptz,
  created_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_anomalies_phone ON conversation_anomalies (phone);
CREATE INDEX IF NOT EXISTS idx_conversation_anomalies_type ON conversation_anomalies (anomaly_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_anomalies_unresolved ON conversation_anomalies (anomaly_type) WHERE resolved_at IS NULL;

-- Advisory lock RPC for preventing photo-burst / rapid-fire race conditions.
-- Returns true if lock acquired, false if another request holds it.
-- Lock is session-scoped — auto-releases when the Supabase client disconnects
-- (which happens at the end of the serverless function invocation).
CREATE OR REPLACE FUNCTION try_advisory_lock_phone(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN pg_try_advisory_lock(hashtext(p_phone));
END;
$$;
