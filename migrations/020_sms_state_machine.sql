
CREATE TABLE IF NOT EXISTS conversations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'DISCOVERY',
  job_state text DEFAULT 'NONE',
  active_order_id uuid REFERENCES dispatch_orders(id) ON DELETE SET NULL,
  extracted_city text,
  extracted_yards numeric,
  extracted_truck_type text,
  extracted_material text,
  photo_storage_path text,
  photo_public_url text,
  reservation_id uuid,
  pending_approval_order_id uuid REFERENCES dispatch_orders(id) ON DELETE SET NULL,
  last_message_sid text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  approval_sent_at timestamptz,
  voice_call_made boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS site_reservations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES dispatch_orders(id) ON DELETE CASCADE,
  driver_phone text NOT NULL,
  driver_user_id uuid,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservations_order ON site_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_reservations_expires ON site_reservations(expires_at);
CREATE TABLE IF NOT EXISTS material_photos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_phone text NOT NULL,
  order_id uuid REFERENCES dispatch_orders(id),
  storage_path text NOT NULL,
  public_url text,
  twilio_media_url text,
  approved boolean,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS escalation_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_phone text NOT NULL,
  order_id uuid REFERENCES dispatch_orders(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  admin_response text,
  approval_code text UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_escalation_code ON escalation_queue(approval_code);
CREATE TABLE IF NOT EXISTS processed_messages (
  message_sid text PRIMARY KEY,
  processed_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS event_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL,
  conversation_id text,
  job_id text,
  contact_id text,
  payload jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log(created_at DESC);
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "service_role_conversations" ON conversations FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "service_role_reservations" ON site_reservations FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "service_role_photos" ON material_photos FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "service_role_escalation" ON escalation_queue FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "service_role_dedup" ON processed_messages FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "service_role_event_log" ON event_log FOR ALL TO service_role USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE OR REPLACE FUNCTION claim_dispatch_order(p_order_id uuid, p_driver_phone text, p_driver_user_id uuid, p_expires_at timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE v_reservation_id uuid; v_active_count int;
BEGIN
  SELECT COUNT(*) INTO v_active_count FROM site_reservations WHERE order_id = p_order_id AND status = 'active' AND expires_at > now();
  IF v_active_count > 0 THEN RETURN NULL; END IF;
  INSERT INTO site_reservations (order_id, driver_phone, driver_user_id, status, expires_at) VALUES (p_order_id, p_driver_phone, p_driver_user_id, 'active', p_expires_at) RETURNING id INTO v_reservation_id;
  RETURN v_reservation_id;
END; $fn$;
CREATE OR REPLACE FUNCTION get_conversation(p_phone text) RETURNS TABLE(id uuid, phone text, state text, job_state text, active_order_id uuid, extracted_city text, extracted_yards numeric, extracted_truck_type text, extracted_material text, photo_storage_path text, photo_public_url text, reservation_id uuid, pending_approval_order_id uuid, approval_sent_at timestamptz, voice_call_made boolean, last_message_sid text) LANGUAGE plpgsql SECURITY DEFINER AS $fn$
BEGIN RETURN QUERY SELECT c.id, c.phone, c.state, c.job_state, c.active_order_id, c.extracted_city, c.extracted_yards, c.extracted_truck_type, c.extracted_material, c.photo_storage_path, c.photo_public_url, c.reservation_id, c.pending_approval_order_id, c.approval_sent_at, c.voice_call_made, c.last_message_sid FROM conversations c WHERE c.phone = p_phone LIMIT 1; END; $fn$;
CREATE OR REPLACE FUNCTION upsert_conversation(p_phone text, p_state text, p_job_state text DEFAULT NULL, p_active_order_id uuid DEFAULT NULL, p_extracted_city text DEFAULT NULL, p_extracted_yards numeric DEFAULT NULL, p_extracted_truck_type text DEFAULT NULL, p_extracted_material text DEFAULT NULL, p_photo_storage_path text DEFAULT NULL, p_photo_public_url text DEFAULT NULL, p_reservation_id uuid DEFAULT NULL, p_pending_approval_order_id uuid DEFAULT NULL, p_approval_sent_at timestamptz DEFAULT NULL, p_voice_call_made boolean DEFAULT NULL, p_last_message_sid text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $fn$
BEGIN
  INSERT INTO conversations (phone, state, job_state, active_order_id, extracted_city, extracted_yards, extracted_truck_type, extracted_material, photo_storage_path, photo_public_url, reservation_id, pending_approval_order_id, approval_sent_at, voice_call_made, last_message_sid, updated_at) VALUES (p_phone, p_state, p_job_state, p_active_order_id, p_extracted_city, p_extracted_yards, p_extracted_truck_type, p_extracted_material, p_photo_storage_path, p_photo_public_url, p_reservation_id, p_pending_approval_order_id, p_approval_sent_at, COALESCE(p_voice_call_made, false), p_last_message_sid, now())
  ON CONFLICT (phone) DO UPDATE SET state = p_state, job_state = COALESCE(p_job_state, conversations.job_state), active_order_id = COALESCE(p_active_order_id, conversations.active_order_id), extracted_city = COALESCE(p_extracted_city, conversations.extracted_city), extracted_yards = COALESCE(p_extracted_yards, conversations.extracted_yards), extracted_truck_type = COALESCE(p_extracted_truck_type, conversations.extracted_truck_type), extracted_material = COALESCE(p_extracted_material, conversations.extracted_material), photo_storage_path = COALESCE(p_photo_storage_path, conversations.photo_storage_path), photo_public_url = COALESCE(p_photo_public_url, conversations.photo_public_url), reservation_id = COALESCE(p_reservation_id, conversations.reservation_id), pending_approval_order_id = COALESCE(p_pending_approval_order_id, conversations.pending_approval_order_id), approval_sent_at = COALESCE(p_approval_sent_at, conversations.approval_sent_at), voice_call_made = COALESCE(p_voice_call_made, conversations.voice_call_made), last_message_sid = COALESCE(p_last_message_sid, conversations.last_message_sid), updated_at = now();
END; $fn$;
CREATE OR REPLACE FUNCTION check_and_mark_message(p_sid text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $fn$
BEGIN INSERT INTO processed_messages (message_sid) VALUES (p_sid); RETURN true; EXCEPTION WHEN unique_violation THEN RETURN false; END; $fn$;
