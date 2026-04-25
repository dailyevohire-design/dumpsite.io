-- ============================================================================
-- 032_sms_consent_add_facebook.sql
-- Target: Supabase project agsjodzzjrnqdopysjbb (dumpsite-production)
-- Apply by: Supabase SQL Editor. Paste, run once.
-- Date: 2026-04-24
--
-- Stage 3.1 polish — add 'facebook' to the sms_consent.source CHECK enum.
-- Reps will select "Facebook" from the rep-portal consent-source dropdown
-- when the customer's consent was obtained via a Facebook Marketplace DM or
-- comment thread.
-- ============================================================================

BEGIN;

ALTER TABLE sms_consent DROP CONSTRAINT IF EXISTS sms_consent_source_check;
ALTER TABLE sms_consent ADD CONSTRAINT sms_consent_source_check
  CHECK (source IN (
    'inbound_call',
    'web_form',
    'in_person_quote',
    'referral_confirmed',
    'existing_customer',
    'facebook',
    'other'
  ));

COMMIT;
