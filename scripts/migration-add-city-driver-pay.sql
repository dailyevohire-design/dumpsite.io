-- Migration: Add default_driver_pay_cents to cities table
-- Run this in Supabase SQL Editor → https://supabase.com/dashboard/project/YOUR_PROJECT/sql
--
-- This column lets you update driver pay rates per city from the DB
-- without redeploying code. The dispatch service checks this column first,
-- then falls back to the config in lib/driver-pay-rates.ts.

ALTER TABLE cities ADD COLUMN IF NOT EXISTS default_driver_pay_cents integer NOT NULL DEFAULT 4000;

-- Populate rates for cities that have specific rates
UPDATE cities SET default_driver_pay_cents = 6500 WHERE LOWER(name) IN ('azle', 'burleson', 'mckinney', 'plano');
UPDATE cities SET default_driver_pay_cents = 5000 WHERE LOWER(name) IN ('colleyville', 'dallas', 'denton', 'everman', 'sherman');
UPDATE cities SET default_driver_pay_cents = 4500 WHERE LOWER(name) IN ('bonham', 'carrollton', 'carthage', 'covington', 'denison', 'farmersville', 'godley', 'joshua', 'kaufman', 'little elm', 'matador', 'princeton', 'rockwall', 'sachse', 'terrell', 'venus');
UPDATE cities SET default_driver_pay_cents = 3000 WHERE LOWER(name) = 'gordonville';
-- All other cities default to 4000 ($40/load) via the DEFAULT constraint

COMMENT ON COLUMN cities.default_driver_pay_cents IS 'Flat driver pay rate in cents for this city. Used by dispatch service — never shows customer quote to drivers.';
