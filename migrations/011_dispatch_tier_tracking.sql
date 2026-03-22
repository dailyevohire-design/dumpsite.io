ALTER TABLE dispatch_orders ADD COLUMN IF NOT EXISTS elite_notified_count int DEFAULT 0;
ALTER TABLE dispatch_orders ADD COLUMN IF NOT EXISTS pro_notified_count int DEFAULT 0;
ALTER TABLE dispatch_orders ADD COLUMN IF NOT EXISTS hauler_notified_count int DEFAULT 0;
ALTER TABLE dispatch_orders ADD COLUMN IF NOT EXISTS trial_notified_count int DEFAULT 0;
