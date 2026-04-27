-- update_driver_company RPC for the GETTING_COMPANY brain state.
-- driver_profiles.company_name column already exists (nullable text);
-- this RPC is the single write path used by lib/services/brain.service.ts
-- handleGettingCompany. Kept separate from create_sms_driver because that
-- function's source is not in this repo (drift) and a blind rewrite would
-- be unsafe.
--
-- APPLY MANUALLY in the Supabase dashboard for dumpsite-production. Do NOT
-- run via supabase db push or MCP apply_migration without a maintenance
-- window — production migrations on this project are applied by hand.

CREATE OR REPLACE FUNCTION public.update_driver_company(
  p_phone TEXT,
  p_company_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE driver_profiles
  SET company_name = p_company_name,
      updated_at   = NOW()
  WHERE phone = p_phone;
END;
$$;

REVOKE ALL ON FUNCTION public.update_driver_company(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_driver_company(TEXT, TEXT) TO service_role;
