-- 20260415_earth_command_v4.sql
-- Earth Command v4 schema adds. Safe + idempotent — re-runnable.

-- ─── conversations.mode (driver/Jesse side) ──────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'mode'
  ) THEN
    ALTER TABLE conversations ADD COLUMN mode TEXT DEFAULT 'AI_ACTIVE'
      CHECK (mode IN ('AI_ACTIVE', 'HUMAN_ACTIVE'));
  END IF;
END $$;

-- ─── customer_conversations.mode (customer/Sarah side) ───────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customer_conversations' AND column_name = 'mode'
  ) THEN
    ALTER TABLE customer_conversations ADD COLUMN mode TEXT DEFAULT 'AI_ACTIVE'
      CHECK (mode IN ('AI_ACTIVE', 'HUMAN_ACTIVE'));
  END IF;
END $$;

-- ─── dispatch_orders.photo_verified ──────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dispatch_orders' AND column_name = 'photo_verified'
  ) THEN
    ALTER TABLE dispatch_orders ADD COLUMN photo_verified BOOLEAN DEFAULT false;
  END IF;
END $$;

-- ─── dispatch_orders.customer_confirmed ──────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dispatch_orders' AND column_name = 'customer_confirmed'
  ) THEN
    ALTER TABLE dispatch_orders ADD COLUMN customer_confirmed BOOLEAN DEFAULT false;
  END IF;
END $$;

-- ─── dispatch_orders.delivery_photo_url ──────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dispatch_orders' AND column_name = 'delivery_photo_url'
  ) THEN
    ALTER TABLE dispatch_orders ADD COLUMN delivery_photo_url TEXT;
  END IF;
END $$;

-- ─── admin_takeover_log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_takeover_log (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_phone TEXT NOT NULL,
  conversation_type  TEXT NOT NULL CHECK (conversation_type IN ('driver', 'customer')),
  admin_message      TEXT NOT NULL,
  twilio_sid         TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_takeover_log_phone_created
  ON admin_takeover_log (conversation_phone, created_at DESC);

-- ─── platform_iq_snapshots ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_iq_snapshots (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  iq_score          INTEGER NOT NULL,
  sarah_close_rate  NUMERIC,
  jesse_accept_rate NUMERIC,
  quote_speed_score NUMERIC,
  confirm_rate      NUMERIC,
  snapshot_week     TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_iq_snapshots_created
  ON platform_iq_snapshots (created_at ASC);

-- ─── Performance indexes ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_status
  ON dispatch_orders (status);
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_updated
  ON dispatch_orders (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_mode
  ON conversations (mode);
CREATE INDEX IF NOT EXISTS idx_customer_conversations_mode
  ON customer_conversations (mode);
