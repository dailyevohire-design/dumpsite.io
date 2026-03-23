/**
 * City center coordinates for DFW metro area.
 * Used as fallback when exact address geocoding is unavailable.
 */
export const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  'Dallas': { lat: 32.7767, lng: -96.7970 },
  'Fort Worth': { lat: 32.7555, lng: -97.3308 },
  'Arlington': { lat: 32.7357, lng: -97.1081 },
  'Plano': { lat: 33.0198, lng: -96.6989 },
  'Irving': { lat: 32.8140, lng: -96.9489 },
  'Garland': { lat: 32.9126, lng: -96.6389 },
  'McKinney': { lat: 33.1972, lng: -96.6397 },
  'Mesquite': { lat: 32.7668, lng: -96.5992 },
  'Denton': { lat: 33.2148, lng: -97.1331 },
  'Carrollton': { lat: 32.9537, lng: -96.8903 },
  'Grand Prairie': { lat: 32.7460, lng: -96.9978 },
  'Frisco': { lat: 33.1507, lng: -96.8236 },
  'Midlothian': { lat: 32.4818, lng: -96.9942 },
  'Cleburne': { lat: 32.3512, lng: -97.3864 },
  'Mansfield': { lat: 32.5632, lng: -97.1417 },
  'Everman': { lat: 32.6293, lng: -97.2836 },
  'Little Elm': { lat: 33.1629, lng: -96.9375 },
}
