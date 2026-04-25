-- 034_edge_function_telemetry.sql
-- Adds per-row generation telemetry + widens rep_content_alerts enum.
-- Apply manually in Supabase dashboard against agsjodzzjrnqdopysjbb.

BEGIN;

-- 1. Per-row telemetry on rep_posts
ALTER TABLE public.rep_posts ADD COLUMN IF NOT EXISTS generation_attempts smallint NOT NULL DEFAULT 1;
ALTER TABLE public.rep_posts ADD COLUMN IF NOT EXISTS generation_error text;

-- 2. Widen rep_content_alerts.alert_type to cover Edge Function failure modes
ALTER TABLE public.rep_content_alerts DROP CONSTRAINT IF EXISTS rep_content_alerts_alert_type_check;
ALTER TABLE public.rep_content_alerts ADD CONSTRAINT rep_content_alerts_alert_type_check
  CHECK (alert_type IN (
    'empty_queue','cron_stale','generation_failed',
    'rotation_exhausted','batch_per_rep_error','dedup_exhausted',
    'anthropic_5xx_after_retry','anthropic_4xx','dedup_collision_after_retry',
    'no_fresh_photo','malformed_response'
  ));

-- 3. Helper RPC for the watchdog cooldown lookup
CREATE OR REPLACE FUNCTION public.fdnm_should_auto_heal(p_rep_id text, p_cooldown_min int DEFAULT 30)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.rep_content_alerts
    WHERE rep_id = p_rep_id
      AND alert_type IN ('anthropic_5xx_after_retry','anthropic_4xx')
      AND fired_at > now() - (p_cooldown_min || ' minutes')::interval
      AND resolved_at IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.fdnm_should_auto_heal(text,int) TO service_role;

COMMIT;
