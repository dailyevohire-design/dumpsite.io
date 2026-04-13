/**
 * DRIVER PAY RATES BY CITY
 *
 * This is the SINGLE SOURCE OF TRUTH for what drivers are paid per load.
 * When a dispatch is created, the driver pay is ALWAYS looked up from here —
 * never from the customer quote or admin input.
 *
 * To update a rate: change it here and redeploy, OR update the
 * default_driver_pay_cents column on the cities table (DB takes priority).
 *
 * Default: $40/load (4000 cents) for any city not listed.
 */

export const DEFAULT_DRIVER_PAY_CENTS = 4000

/**
 * City name (lowercase) → driver pay in cents.
 * DB column `cities.default_driver_pay_cents` overrides these values.
 */
export const CITY_DRIVER_PAY_CENTS: Record<string, number> = {
  'azle': 6500,
  'bonham': 4500,
  'burleson': 6500,
  'carrollton': 4500,
  'carthage': 4500,
  'colleyville': 5000,
  'covington': 4500,
  'dallas': 5000,
  'denison': 4500,
  'denton': 5000,
  'everman': 5000,
  'farmersville': 4500,
  'godley': 4500,
  'gordonville': 3000,
  'joshua': 4500,
  'kaufman': 4500,
  'little elm': 4500,
  'matador': 4500,
  'mckinney': 6500,
  'plano': 6500,
  'princeton': 4500,
  'rockwall': 4500,
  'sachse': 4500,
  'sherman': 5000,
  'terrell': 4500,
  'venus': 4500,
}

/**
 * Look up the driver pay for a city.
 * Priority: DB column > config map > default.
 */
export function getDriverPayCents(cityName: string, dbPayCents?: number | null): number {
  // DB column takes priority if set and non-zero
  if (dbPayCents && dbPayCents > 0) return dbPayCents

  const key = cityName.toLowerCase().trim()
  return CITY_DRIVER_PAY_CENTS[key] ?? DEFAULT_DRIVER_PAY_CENTS
}

// Negotiation ceiling — the absolute max Jesse can offer a driver per load
export const NEGOTIATION_CEILING_CENTS = 5000
