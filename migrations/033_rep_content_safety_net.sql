-- 033_rep_content_safety_net.sql
-- Permanent fix: rep content generation never silently fails, dashboards never go empty.
-- Apply manually in Supabase dashboard against agsjodzzjrnqdopysjbb.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Allow NULL city on skipped rows (root cause of Apr 24-25 outage)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.rep_posts ALTER COLUMN city DROP NOT NULL;

ALTER TABLE public.rep_posts DROP CONSTRAINT IF EXISTS rep_posts_city_required;
ALTER TABLE public.rep_posts ADD CONSTRAINT rep_posts_city_required
  CHECK (status = 'skipped' OR city IS NOT NULL);

-- ─────────────────────────────────────────────────────────────
-- 2. rep_content_alerts — observability for every failure path
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rep_content_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id      text NOT NULL,
  alert_type  text NOT NULL CHECK (alert_type IN (
                'empty_queue','cron_stale','generation_failed',
                'rotation_exhausted','batch_per_rep_error','dedup_exhausted'
              )),
  severity    text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  fired_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rep_content_alerts_unresolved
  ON public.rep_content_alerts (rep_id, fired_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.rep_content_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_content_alerts_admin_read ON public.rep_content_alerts;
CREATE POLICY rep_content_alerts_admin_read ON public.rep_content_alerts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sales_reps sr
    WHERE sr.id = current_setting('request.jwt.claims', true)::jsonb->>'rep_id'
      AND sr.is_admin = true
  ));

GRANT SELECT, INSERT, UPDATE ON public.rep_content_alerts TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 3. Index for health view (covers rep_posts queue queries)
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rep_posts_health
  ON public.rep_posts (rep_id, status, scheduled_for DESC)
  WHERE status IN ('queued','generated');

-- ─────────────────────────────────────────────────────────────
-- 4. rep_content_health view — single source of truth for "is this rep okay?"
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.rep_content_health AS
SELECT
  sr.id AS rep_id,
  sr.market,
  sr.is_active,
  sr.is_admin,
  COALESCE(sr.contract_signed, false) AS contract_signed,
  COALESCE(sr.video_watched, false) AS video_watched,
  COALESCE((
    SELECT COUNT(*) FROM public.rep_posts rp
    WHERE rp.rep_id = sr.id
      AND rp.status IN ('queued','generated')
      AND rp.posted_at IS NULL
      AND rp.scheduled_for >= CURRENT_DATE
  ), 0) AS postable_count,
  (
    SELECT MAX(rp.created_at) FROM public.rep_posts rp
    WHERE rp.rep_id = sr.id AND rp.status != 'skipped'
  ) AS last_generated_at,
  EXTRACT(EPOCH FROM (now() - (
    SELECT MAX(rp.created_at) FROM public.rep_posts rp
    WHERE rp.rep_id = sr.id AND rp.status != 'skipped'
  )))/3600.0 AS hours_since_last_generation,
  (
    sr.is_active = true
    AND COALESCE(sr.is_decoy, false) = false
    AND COALESCE(sr.contract_signed, false) = true
    AND COALESCE(sr.video_watched, false) = true
    AND COALESCE((
      SELECT COUNT(*) FROM public.rep_posts rp
      WHERE rp.rep_id = sr.id
        AND rp.status IN ('queued','generated')
        AND rp.posted_at IS NULL
        AND rp.scheduled_for >= CURRENT_DATE
    ), 0) >= 3
  ) AS is_healthy
FROM public.sales_reps sr
WHERE sr.is_active = true AND COALESCE(sr.is_decoy, false) = false;

GRANT SELECT ON public.rep_content_health TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 5. Patch fn_next_cities_for_rep — recycle oldest-posted instead of returning empty
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_next_cities_for_rep(p_rep_id text, p_count integer)
RETURNS TABLE(city text, state text, lat numeric, lng numeric, ring smallint, miles numeric)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_anchor RECORD;
  v_state CHAR(2);
  v_returned INT;
BEGIN
  SELECT anchor_lat, anchor_lng, rep_city_anchors.state INTO v_anchor
  FROM public.rep_city_anchors WHERE rep_id = p_rep_id;

  IF NOT FOUND THEN
    SELECT
      CASE WHEN sr.market = 'Denver' THEN 39.7392 ELSE 32.7767 END AS anchor_lat,
      CASE WHEN sr.market = 'Denver' THEN -104.9903 ELSE -96.7970 END AS anchor_lng,
      CASE WHEN sr.market = 'Denver' THEN 'CO' ELSE 'TX' END AS state
    INTO v_anchor
    FROM public.sales_reps sr WHERE sr.id = p_rep_id;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;

  v_state := v_anchor.state;

  -- Phase 1: cities NOT posted in last 14 days, ordered by ring/distance
  RETURN QUERY
  SELECT c.name, c.state::TEXT, c.lat, c.lng, c.ring,
         public.fn_haversine_miles(v_anchor.anchor_lat, v_anchor.anchor_lng, c.lat, c.lng)
  FROM public.cities c
  WHERE c.state = v_state AND c.is_active = true AND c.lat IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.rep_posts rp
      WHERE rp.rep_id = p_rep_id AND rp.city = c.name
        AND rp.state ILIKE c.state AND rp.created_at >= NOW() - INTERVAL '14 days'
    )
  ORDER BY c.ring ASC NULLS LAST, miles ASC NULLS LAST
  LIMIT p_count;

  GET DIAGNOSTICS v_returned = ROW_COUNT;

  -- Phase 2: rotation exhausted — recycle oldest-posted, log alert
  IF v_returned < p_count THEN
    INSERT INTO public.rep_content_alerts (rep_id, alert_type, severity, payload)
    VALUES (p_rep_id, 'rotation_exhausted', 'warning',
            jsonb_build_object('phase1_returned', v_returned, 'requested', p_count, 'state', v_state));

    RETURN QUERY
    SELECT c.name, c.state::TEXT, c.lat, c.lng, c.ring,
           public.fn_haversine_miles(v_anchor.anchor_lat, v_anchor.anchor_lng, c.lat, c.lng)
    FROM public.cities c
    LEFT JOIN LATERAL (
      SELECT MAX(rp.created_at) AS last_posted FROM public.rep_posts rp
      WHERE rp.rep_id = p_rep_id AND rp.city = c.name AND rp.state ILIKE c.state
    ) lp ON true
    WHERE c.state = v_state AND c.is_active = true AND c.lat IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.rep_posts rp
        WHERE rp.rep_id = p_rep_id AND rp.city = c.name
          AND rp.state ILIKE c.state AND rp.created_at >= NOW() - INTERVAL '14 days'
      )
    ORDER BY lp.last_posted ASC NULLS FIRST, c.ring ASC NULLS LAST
    LIMIT (p_count - v_returned);
  END IF;
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 6. Patch daily_rep_post_generation_batch — per-rep EXCEPTION wrapping
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.daily_rep_post_generation_batch(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r RECORD;
  c RECORD;
  v_service_key TEXT;
  v_function_url TEXT;
  v_req_count INT := 0;
  v_rep_count INT := 0;
  v_skipped_reps INT := 0;
  v_failed_reps INT := 0;
  v_audit_id UUID;
  v_quota INT;
  v_cities_assigned INT;
  v_state TEXT;
  v_err_text TEXT;
BEGIN
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_service_key IS NULL THEN
    RETURN jsonb_build_object('error', 'Missing vault secret: service_role_key');
  END IF;
  v_function_url := 'https://agsjodzzjrnqdopysjbb.supabase.co/functions/v1/generate-rep-posts';

  INSERT INTO public.post_generation_audit(run_type, target_date, invocation_status)
  VALUES ('cron', p_date, 'running') RETURNING id INTO v_audit_id;

  FOR r IN
    SELECT sr.id, sr.market, sr.home_state
    FROM public.sales_reps sr
    WHERE sr.is_active = true AND (sr.is_decoy IS NOT TRUE)
    ORDER BY sr.id
  LOOP
    v_rep_count := v_rep_count + 1;

    BEGIN  -- per-rep savepoint — failure here NEVER blocks the next rep
      DELETE FROM public.rep_posts
      WHERE rep_id = r.id AND scheduled_for::date = p_date
        AND generated_by = 'manual' AND status = 'queued' AND posted_at IS NULL;

      v_quota := public.fn_rep_daily_quota(r.id);
      v_cities_assigned := 0;

      FOR c IN
        SELECT * FROM public.fn_next_cities_for_rep(r.id, v_quota)
      LOOP
        v_state := LOWER(c.state);
        PERFORM net.http_post(
          url := v_function_url,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_service_key
          ),
          body := jsonb_build_object(
            'rep_id', r.id, 'keyword_slot', 'fill_dirt',
            'city', c.city, 'state', v_state,
            'date', p_date::text, 'source', 'daily_rotation'
          ),
          timeout_milliseconds := 60000
        );
        v_req_count := v_req_count + 1;
        v_cities_assigned := v_cities_assigned + 1;
      END LOOP;

      IF v_cities_assigned = 0 THEN
        v_skipped_reps := v_skipped_reps + 1;
        INSERT INTO public.rep_posts (rep_id, scheduled_for, city, state, status, generated_by, skip_reason, title, keyword_slot)
        VALUES (r.id, p_date::timestamptz, NULL, COALESCE(r.home_state, 'tx'), 'skipped', 'daily_rotation',
                'no_cities_available — rotation fully exhausted including recycle pool',
                '[skipped] ' || r.id || ' ' || p_date::text, 'fill_dirt');

        INSERT INTO public.rep_content_alerts (rep_id, alert_type, severity, payload)
        VALUES (r.id, 'generation_failed', 'critical',
                jsonb_build_object('reason','no_cities_available','date',p_date::text));
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_failed_reps := v_failed_reps + 1;
      v_err_text := SQLERRM;
      INSERT INTO public.rep_content_alerts (rep_id, alert_type, severity, payload)
      VALUES (r.id, 'batch_per_rep_error', 'critical',
              jsonb_build_object('error', v_err_text, 'date', p_date::text));
    END;  -- end per-rep block
  END LOOP;

  UPDATE public.post_generation_audit
  SET invocation_status = 'dispatched',
      active_rep_count = v_rep_count,
      completed_at = NOW(),
      duration_ms = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::int
  WHERE id = v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reps_processed', v_rep_count,
    'cities_dispatched', v_req_count,
    'reps_skipped', v_skipped_reps,
    'reps_failed', v_failed_reps,
    'audit_id', v_audit_id
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 7. Emergency RPC — force-generate for a single rep, bypasses 14-day window
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fdnm_emergency_generate_for_rep(p_rep_id text, p_count int DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r RECORD;
  c RECORD;
  v_service_key TEXT;
  v_function_url TEXT;
  v_anchor RECORD;
  v_state CHAR(2);
  v_dispatched INT := 0;
BEGIN
  SELECT * INTO r FROM public.sales_reps WHERE id = p_rep_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','rep_not_found'); END IF;

  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_service_key IS NULL THEN RETURN jsonb_build_object('error','missing_vault_secret'); END IF;
  v_function_url := 'https://agsjodzzjrnqdopysjbb.supabase.co/functions/v1/generate-rep-posts';

  SELECT anchor_lat, anchor_lng, rep_city_anchors.state INTO v_anchor
  FROM public.rep_city_anchors WHERE rep_id = p_rep_id;
  IF NOT FOUND THEN
    SELECT
      CASE WHEN r.market='Denver' THEN 39.7392 ELSE 32.7767 END,
      CASE WHEN r.market='Denver' THEN -104.9903 ELSE -96.7970 END,
      CASE WHEN r.market='Denver' THEN 'CO' ELSE 'TX' END
    INTO v_anchor;
  END IF;
  v_state := v_anchor.state;

  -- Bypass the 14-day window entirely — pick by ring/distance, oldest-posted first
  FOR c IN
    SELECT cit.name AS city, cit.state::TEXT AS st
    FROM public.cities cit
    LEFT JOIN LATERAL (
      SELECT MAX(rp.created_at) last_posted FROM public.rep_posts rp
      WHERE rp.rep_id = p_rep_id AND rp.city = cit.name AND rp.state ILIKE cit.state
    ) lp ON true
    WHERE cit.state = v_state AND cit.is_active = true AND cit.lat IS NOT NULL
    ORDER BY lp.last_posted ASC NULLS FIRST, cit.ring ASC NULLS LAST
    LIMIT p_count
  LOOP
    PERFORM net.http_post(
      url := v_function_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_service_key),
      body := jsonb_build_object(
        'rep_id', p_rep_id, 'keyword_slot','fill_dirt',
        'city', c.city, 'state', LOWER(c.st),
        'date', CURRENT_DATE::text, 'source','emergency'
      ),
      timeout_milliseconds := 60000
    );
    v_dispatched := v_dispatched + 1;
  END LOOP;

  -- Resolve any open empty_queue alerts for this rep
  UPDATE public.rep_content_alerts
  SET resolved_at = now()
  WHERE rep_id = p_rep_id AND alert_type = 'empty_queue' AND resolved_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'rep_id', p_rep_id, 'dispatched', v_dispatched);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fdnm_emergency_generate_for_rep(text,int) TO service_role;

COMMIT;
