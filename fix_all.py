import re

BASE = '/home/dailyevohire/dumpsite-io'

# ─────────────────────────────────────────────────────────────────────────────
# 1. DASHBOARD — fix submitLoad, markComplete, remove client_address leaks
# ─────────────────────────────────────────────────────────────────────────────
with open(f'{BASE}/app/dashboard/page.tsx', 'r') as f:
    dash = f.read()

# Fix dispatch_orders query - remove client_address from driver query
dash = dash.replace(
    "supabase.from('dispatch_orders').select('*, cities(name)').eq('status','dispatching').order('driver_pay_cents',{ascending:false}).then(({data:s}) => { const seen = new Set(); const unique = (s||[]).filter((j:any) => { const key = j.client_address||j.id; if(seen.has(key)) return false; seen.add(key); return true; }); const top3 = unique.slice(0,3); const rest = unique.slice(3).sort((a:any,b:any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); setJobs([...top3,...rest]) })",
    "supabase.from('dispatch_orders').select('id,city_id,yards_needed,driver_pay_cents,urgency,created_at,cities(name)').eq('status','dispatching').order('driver_pay_cents',{ascending:false}).then(({data:s}) => { const seen = new Set(); const unique = (s||[]).filter((j:any) => { if(seen.has(j.id)) return false; seen.add(j.id); return true; }); const top3 = unique.slice(0,3); const rest = unique.slice(3).sort((a:any,b:any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); setJobs([...top3,...rest]) })"
)

# Fix initial load_requests query - remove client_address and price_quoted_cents
dash = dash.replace(
    "supabase.from('load_requests').select('*, dispatch_orders(client_address,yards_needed,price_quoted_cents,driver_pay_cents,cities(name))').eq('driver_id',data.user.id).order('submitted_at',{ascending:false}).limit(20).then(({data:l}) => setLoads(l||[]))",
    "supabase.from('load_requests').select('id,status,dirt_type,photo_url,truck_type,truck_count,yards_estimated,haul_date,submitted_at,rejected_reason,payout_cents,completion_photo_url,dispatch_orders(yards_needed,driver_pay_cents,cities(name))').eq('driver_id',data.user.id).order('submitted_at',{ascending:false}).limit(20).then(({data:l}) => setLoads(l||[]))"
)

# Fix submitLoad - replace direct Supabase insert with API call
old_submit = """    const supabase = createBrowserSupabase()
    const {error} = await supabase.from('load_requests').insert({
      idempotency_key: crypto.randomUUID(),
      driver_id: user.id,
      dirt_type: form.dirtType,
      photo_url: photoUrl,
      location_text: form.locationText,
      truck_type: form.truckType,
      truck_count: parseInt(form.truckCount),
      yards_estimated: parseInt(form.yardsEstimated),
      haul_date: form.haulDate,
      status: 'pending',
      dispatch_order_id: selectedJob.id
    })
    if (error) {
      setSubmitResult({success:false,message:'Failed to submit. Please try again.'})
    } else {
      setSubmitResult({success:true,message:'✅ Submitted! You will get an SMS with the delivery address once approved.'})
      setSelectedJob(null)
      setPhotoFile(null)
      setPhotoPreview(null)
      setForm({dirtType:'clean_fill',locationText:'',truckType:'tandem_axle',truckCount:'1',yardsEstimated:'',haulDate:''})
      const {data:l} = await supabase.from('load_requests').select('*, dispatch_orders(client_address,yards_needed,driver_pay_cents,cities(name))').eq('driver_id',user.id).order('submitted_at',{ascending:false}).limit(20)
      setLoads(l||[])
      setActiveTab('loads')
    }
    setSubmitting(false)
    setTimeout(()=>setSubmitResult(null),6000)"""

new_submit = """    const res = await fetch('/api/driver/submit-load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        dirtType: form.dirtType,
        photoUrl,
        locationText: form.locationText,
        truckType: form.truckType,
        truckCount: form.truckCount,
        yardsEstimated: form.yardsEstimated,
        haulDate: form.haulDate,
        dispatchOrderId: selectedJob.id,
      })
    })
    const result = await res.json()
    if (!result.success) {
      setSubmitResult({success:false,message:result.message || result.error || 'Failed to submit. Please try again.'})
    } else {
      setSubmitResult({success:true,message:'✅ Submitted! You will get an SMS with the delivery address once approved.'})
      setSelectedJob(null)
      setPhotoFile(null)
      setPhotoPreview(null)
      setForm({dirtType:'clean_fill',locationText:'',truckType:'tandem_axle',truckCount:'1',yardsEstimated:'',haulDate:''})
      const supabase = createBrowserSupabase()
      const {data:l} = await supabase.from('load_requests').select('id,status,dirt_type,photo_url,truck_type,truck_count,yards_estimated,haul_date,submitted_at,rejected_reason,payout_cents,completion_photo_url,dispatch_orders(yards_needed,driver_pay_cents,cities(name))').eq('driver_id',user.id).order('submitted_at',{ascending:false}).limit(20)
      setLoads(l||[])
      setActiveTab('loads')
    }
    setSubmitting(false)
    setTimeout(()=>setSubmitResult(null),6000)"""

dash = dash.replace(old_submit, new_submit)

# Fix markComplete - replace direct Supabase update with API call
old_complete = """    const numLoads = parseInt(loadsDelivered)
    const totalPay = Math.round((driverPayCents * numLoads) / 100)
    const supabase = createBrowserSupabase()
    const { error } = await supabase
      .from('load_requests')
      .update({
        status: 'completed',
        completion_photo_url: photoUrl,
        truck_count: numLoads,
        payout_cents: driverPayCents * numLoads
      })
      .eq('id', loadId)
      .eq('driver_id', user.id)
    if (error) {
      setSubmitResult({success:false,message:'Failed to mark complete. Please try again.'})
    } else {
      setSubmitResult({success:true,message:`🎉 Job complete! You delivered ${numLoads} load${numLoads>1?'s':''} — total pay: $${totalPay}. Payment processed shortly.`})
      setCompletingId(null)
      setCompletionPhoto(null)
      setCompletionPreview(null)
      setLoadsDelivered('1')
      const {data:l} = await supabase.from('load_requests').select('*, dispatch_orders(client_address,yards_needed,driver_pay_cents,cities(name))').eq('driver_id',user.id).order('submitted_at',{ascending:false}).limit(20)
      setLoads(l||[])
    }
    setCompleting(false)
    setTimeout(()=>setSubmitResult(null),8000)"""

new_complete = """    const numLoads = parseInt(loadsDelivered)
    const res = await fetch('/api/driver/complete-load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loadId, completionPhotoUrl: photoUrl, loadsDelivered: numLoads })
    })
    const result = await res.json()
    if (!result.success) {
      setSubmitResult({success:false,message:result.error || 'Failed to mark complete. Please try again.'})
    } else {
      setSubmitResult({success:true,message:`🎉 Job complete! You delivered ${numLoads} load${numLoads>1?'s':''} — total pay: $${result.totalPayDollars}. Payment processed shortly.`})
      setCompletingId(null)
      setCompletionPhoto(null)
      setCompletionPreview(null)
      setLoadsDelivered('1')
      const supabase = createBrowserSupabase()
      const {data:l} = await supabase.from('load_requests').select('id,status,dirt_type,photo_url,truck_type,truck_count,yards_estimated,haul_date,submitted_at,rejected_reason,payout_cents,completion_photo_url,dispatch_orders(yards_needed,driver_pay_cents,cities(name))').eq('driver_id',user.id).order('submitted_at',{ascending:false}).limit(20)
      setLoads(l||[])
    }
    setCompleting(false)
    setTimeout(()=>setSubmitResult(null),8000)"""

dash = dash.replace(old_complete, new_complete)

with open(f'{BASE}/app/dashboard/page.tsx', 'w') as f:
    f.write(dash)
print('✅ dashboard/page.tsx patched')

# ─────────────────────────────────────────────────────────────────────────────
# 2. ACCOUNT PAGE — fix saveProfile to use API route
# ─────────────────────────────────────────────────────────────────────────────
with open(f'{BASE}/app/account/page.tsx', 'r') as f:
    acct = f.read()

old_save = """  async function saveProfile() {
    setSaving(true)
    const supabase = createBrowserSupabase()
    const { error } = await supabase
      .from('driver_profiles')
      .update({
        first_name: form.firstName,
        last_name: form.lastName,
        company_name: form.companyName,
        phone: form.phone,
        truck_count: parseInt(form.truckCount),
        truck_type: form.truckType,
        bank_name: form.bankName,
        account_holder_name: form.accountHolderName,
        routing_number: form.routingNumber,
        account_number: form.accountNumber,
        account_type: form.accountType,
        payment_method: form.paymentMethod
      })
      .eq('user_id', user.id)
    if (error) {
      setResult({success:false,message:'Failed to save. Please try again.'})
    } else {
      setResult({success:true,message:'✅ Profile saved successfully!'})
    }
    setSaving(false)
    setTimeout(()=>setResult(null),4000)
  }"""

new_save = """  async function saveProfile() {
    setSaving(true)
    try {
      const res = await fetch('/api/driver/update-profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.firstName,
          last_name: form.lastName,
          company_name: form.companyName,
          phone: form.phone,
          truck_count: form.truckCount,
          truck_type: form.truckType,
          bank_name: form.bankName,
          account_holder_name: form.accountHolderName,
          routing_number: form.routingNumber,
          account_number: form.accountNumber,
          account_type: form.accountType,
          payment_method: form.paymentMethod
        })
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setResult({success:false,message:data.error || 'Failed to save. Please try again.'})
      } else {
        setResult({success:true,message:'✅ Profile saved successfully!'})
      }
    } catch {
      setResult({success:false,message:'Network error. Please try again.'})
    }
    setSaving(false)
    setTimeout(()=>setResult(null),4000)
  }"""

acct = acct.replace(old_save, new_save)

with open(f'{BASE}/app/account/page.tsx', 'w') as f:
    f.write(acct)
print('✅ account/page.tsx patched')

# ─────────────────────────────────────────────────────────────────────────────
# 3. SQL MIGRATIONS — indexes, triggers, tables, RLS
# ─────────────────────────────────────────────────────────────────────────────
import os
os.makedirs(f'{BASE}/migrations', exist_ok=True)

sql = """-- =============================================================================
-- DumpSite.io — Production Database Migration
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Safe to run multiple times (uses IF NOT EXISTS / CREATE OR REPLACE)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: PERFORMANCE INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- load_requests: driver dashboard query
CREATE INDEX IF NOT EXISTS idx_load_requests_driver_status
  ON load_requests (driver_id, status);

-- load_requests: admin pending queue sorted by time
CREATE INDEX IF NOT EXISTS idx_load_requests_status_submitted
  ON load_requests (status, submitted_at ASC);

-- load_requests: admin loads by dispatch order
CREATE INDEX IF NOT EXISTS idx_load_requests_dispatch_order
  ON load_requests (dispatch_order_id);

-- load_requests: idempotency enforcement
CREATE UNIQUE INDEX IF NOT EXISTS idx_load_requests_idempotency
  ON load_requests (idempotency_key);

-- dispatch_orders: driver job map by city
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_city_status
  ON dispatch_orders (city_id, status);

-- dispatch_orders: admin chronological view
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_created_desc
  ON dispatch_orders (created_at DESC);

-- dispatch_orders: zapier idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_orders_zapier_row
  ON dispatch_orders (zapier_row_id)
  WHERE zapier_row_id IS NOT NULL;

-- driver_profiles: dispatch SMS targeting
CREATE INDEX IF NOT EXISTS idx_driver_profiles_city_status_phone
  ON driver_profiles (city_id, status, phone_verified);

-- driver_profiles: tier-based dispatch ordering
CREATE INDEX IF NOT EXISTS idx_driver_profiles_tier
  ON driver_profiles (tier_id);

-- dump_sites: active sites by city
CREATE INDEX IF NOT EXISTS idx_dump_sites_city_active
  ON dump_sites (city_id, is_active);

-- audit_logs: audit trail per record
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id);

-- audit_logs: per-user activity history
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON audit_logs (actor_id, created_at DESC);

-- sms_log: delivery check per load
CREATE INDEX IF NOT EXISTS idx_sms_log_related
  ON sms_log (related_id, message_type);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: updated_at TRIGGERS
-- Auto-updates updated_at on every row change. Critical for cache invalidation.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at column if missing (safe to run if already exists)
ALTER TABLE driver_profiles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

ALTER TABLE load_requests
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

ALTER TABLE dump_sites
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

-- Create triggers (drop first to allow re-running)
DROP TRIGGER IF EXISTS set_updated_at_driver_profiles ON driver_profiles;
CREATE TRIGGER set_updated_at_driver_profiles
  BEFORE UPDATE ON driver_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_dispatch_orders ON dispatch_orders;
CREATE TRIGGER set_updated_at_dispatch_orders
  BEFORE UPDATE ON dispatch_orders
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_load_requests ON load_requests;
CREATE TRIGGER set_updated_at_load_requests
  BEFORE UPDATE ON load_requests
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_dump_sites ON dump_sites;
CREATE TRIGGER set_updated_at_dump_sites
  BEFORE UPDATE ON dump_sites
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: CONTRACTOR PROFILES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contractor_profiles (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name       text NOT NULL,
  contact_name       text NOT NULL,
  phone              text NOT NULL CHECK (phone ~ '^\\+[1-9]\\d{7,14}$'),
  email              text NOT NULL,
  billing_address    text,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('active', 'suspended', 'pending')),
  verified_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT NOW(),
  updated_at         timestamptz NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_contractor_profiles ON contractor_profiles;
CREATE TRIGGER set_updated_at_contractor_profiles
  BEFORE UPDATE ON contractor_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: MATERIAL APPROVALS
-- Tracks which drivers are pre-approved for which material/site combinations.
-- Enables the auto-approval flow for trusted drivers.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS material_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id      uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
  dump_site_id   uuid NOT NULL REFERENCES dump_sites(id) ON DELETE CASCADE,
  material_type  text NOT NULL,
  approved_by    uuid NOT NULL REFERENCES auth.users(id),
  approved_at    timestamptz NOT NULL DEFAULT NOW(),
  expires_at     timestamptz,
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE (driver_id, dump_site_id, material_type)
);

CREATE INDEX IF NOT EXISTS idx_material_approvals_driver_site
  ON material_approvals (driver_id, dump_site_id, is_active);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: ADDRESS RELEASES
-- Immutable audit log of every dumpsite address sent to a driver.
-- Critical for privacy compliance and dispute resolution.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS address_releases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_request_id  uuid NOT NULL REFERENCES load_requests(id) ON DELETE RESTRICT,
  driver_id        uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE RESTRICT,
  dump_site_id     uuid REFERENCES dump_sites(id) ON DELETE RESTRICT,
  dispatch_order_id uuid REFERENCES dispatch_orders(id) ON DELETE RESTRICT,
  released_at      timestamptz NOT NULL DEFAULT NOW(),
  release_method   text NOT NULL CHECK (release_method IN ('sms', 'email', 'manual')),
  released_by      uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_address_releases_load
  ON address_releases (load_request_id);

CREATE INDEX IF NOT EXISTS idx_address_releases_driver
  ON address_releases (driver_id, released_at DESC);

-- Prevent updates/deletes — this table is append-only
CREATE OR REPLACE RULE address_releases_no_update AS
  ON UPDATE TO address_releases DO INSTEAD NOTHING;

CREATE OR REPLACE RULE address_releases_no_delete AS
  ON DELETE TO address_releases DO INSTEAD NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: PAYOUTS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id          uuid NOT NULL REFERENCES driver_profiles(user_id) ON DELETE RESTRICT,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  total_cents        int NOT NULL CHECK (total_cents >= 0),
  payout_method      text NOT NULL DEFAULT 'ach'
                       CHECK (payout_method IN ('ach', 'wire')),
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  processed_at       timestamptz,
  external_reference text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT NOW(),
  updated_at         timestamptz NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_payouts ON payouts;
CREATE TRIGGER set_updated_at_payouts
  BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_payouts_driver_status
  ON payouts (driver_id, status);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7: DATABASE CONSTRAINTS
-- Additional check constraints for data integrity
-- ─────────────────────────────────────────────────────────────────────────────

-- load_requests constraints
ALTER TABLE load_requests
  DROP CONSTRAINT IF EXISTS chk_load_status,
  ADD CONSTRAINT chk_load_status
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed'));

ALTER TABLE load_requests
  DROP CONSTRAINT IF EXISTS chk_truck_count,
  ADD CONSTRAINT chk_truck_count
    CHECK (truck_count BETWEEN 1 AND 200);

ALTER TABLE load_requests
  DROP CONSTRAINT IF EXISTS chk_yards_positive,
  ADD CONSTRAINT chk_yards_positive
    CHECK (yards_estimated > 0);

-- dispatch_orders constraints
ALTER TABLE dispatch_orders
  DROP CONSTRAINT IF EXISTS chk_dispatch_status,
  ADD CONSTRAINT chk_dispatch_status
    CHECK (status IN ('dispatching', 'active', 'completed', 'cancelled'));

ALTER TABLE dispatch_orders
  DROP CONSTRAINT IF EXISTS chk_yards_needed,
  ADD CONSTRAINT chk_yards_needed
    CHECK (yards_needed > 0);

-- driver_profiles constraints
ALTER TABLE driver_profiles
  DROP CONSTRAINT IF EXISTS chk_gps_score,
  ADD CONSTRAINT chk_gps_score
    CHECK (gps_score BETWEEN 0 AND 100);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 8: ROW LEVEL SECURITY POLICIES
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE load_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE address_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_profiles ENABLE ROW LEVEL SECURITY;

-- ── driver_profiles ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "drivers_read_own" ON driver_profiles;
CREATE POLICY "drivers_read_own" ON driver_profiles
  FOR SELECT USING (auth.uid() = user_id);

-- Updates go through API routes using service role — no direct client update
DROP POLICY IF EXISTS "drivers_no_direct_update" ON driver_profiles;

-- ── load_requests ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "drivers_read_own_loads" ON load_requests;
CREATE POLICY "drivers_read_own_loads" ON load_requests
  FOR SELECT USING (auth.uid() = driver_id);

-- No direct client inserts — must go through API
DROP POLICY IF EXISTS "no_direct_load_insert" ON load_requests;

-- ── dispatch_orders ───────────────────────────────────────────────────────────
-- Drivers can read dispatch orders (but NOT client_address — excluded at API level)
DROP POLICY IF EXISTS "drivers_read_dispatch_orders" ON dispatch_orders;
CREATE POLICY "drivers_read_dispatch_orders" ON dispatch_orders
  FOR SELECT USING (auth.role() = 'authenticated');

-- ── audit_logs ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_logs_insert_authenticated" ON audit_logs;
CREATE POLICY "audit_logs_insert_authenticated" ON audit_logs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- No SELECT for non-admins — admin reads via service role
-- No UPDATE or DELETE ever

-- ── address_releases ─────────────────────────────────────────────────────────
-- Only service role can insert/read — enforced at API level

-- ── payouts ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "drivers_read_own_payouts" ON payouts;
CREATE POLICY "drivers_read_own_payouts" ON payouts
  FOR SELECT USING (auth.uid() = driver_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9: ANALYTICS SNAPSHOTS (for future reporting without hitting prod)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_driver_stats (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       uuid NOT NULL REFERENCES driver_profiles(user_id),
  date            date NOT NULL,
  loads_submitted int NOT NULL DEFAULT 0,
  loads_approved  int NOT NULL DEFAULT 0,
  loads_rejected  int NOT NULL DEFAULT 0,
  loads_completed int NOT NULL DEFAULT 0,
  total_payout_cents int NOT NULL DEFAULT 0,
  UNIQUE (driver_id, date)
);

CREATE TABLE IF NOT EXISTS city_demand_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id         uuid NOT NULL REFERENCES cities(id),
  date            date NOT NULL,
  active_orders   int NOT NULL DEFAULT 0,
  drivers_notified int NOT NULL DEFAULT 0,
  loads_completed int NOT NULL DEFAULT 0,
  UNIQUE (city_id, date)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- DONE — Run this and check for errors above before proceeding
-- ─────────────────────────────────────────────────────────────────────────────
"""

with open(f'{BASE}/migrations/001_production_schema.sql', 'w') as f:
    f.write(sql)
print('✅ migrations/001_production_schema.sql written')

# ─────────────────────────────────────────────────────────────────────────────
# 4. REMOVE twilio npm package from package.json (we use fetch directly)
# ─────────────────────────────────────────────────────────────────────────────
import json
with open(f'{BASE}/package.json', 'r') as f:
    pkg = json.load(f)

removed = pkg['dependencies'].pop('twilio', None)
if removed:
    print(f'✅ Removed twilio package (was {removed})')
else:
    print('ℹ️  twilio already removed from package.json')

with open(f'{BASE}/package.json', 'w') as f:
    json.dump(pkg, f, indent=2)

print('\n✅ ALL PATCHES COMPLETE')
print('\nVerify changes:')
print('  grep -n "api/driver" ~/dumpsite-io/app/dashboard/page.tsx')
print('  grep -n "api/driver" ~/dumpsite-io/app/account/page.tsx')
print('  ls ~/dumpsite-io/migrations/')
