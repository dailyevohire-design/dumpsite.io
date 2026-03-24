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
  'Godley': { lat: 32.4493, lng: -97.5275 },
  'Burleson': { lat: 32.5421, lng: -97.3208 },
  'Weatherford': { lat: 32.7593, lng: -97.7973 },
  'Waxahachie': { lat: 32.3866, lng: -96.8483 },
  'Cedar Hill': { lat: 32.5885, lng: -96.9561 },
  'Southlake': { lat: 32.9412, lng: -97.1342 },
  'Keller': { lat: 32.9346, lng: -97.2295 },
  'Grapevine': { lat: 32.9343, lng: -97.0781 },
  'Lewisville': { lat: 33.0462, lng: -96.9942 },
  'Flower Mound': { lat: 33.0146, lng: -97.0970 },
  'Azle': { lat: 32.8951, lng: -97.5456 },
  'Crowley': { lat: 32.5790, lng: -97.3625 },
  'Granbury': { lat: 32.4419, lng: -97.7942 },
  'Mineral Wells': { lat: 32.8085, lng: -98.1128 },
  'Ennis': { lat: 32.3293, lng: -96.6253 },
  'Wylie': { lat: 33.0151, lng: -96.5389 },
  'Allen': { lat: 33.1032, lng: -96.6706 },
  'Prosper': { lat: 33.2362, lng: -96.8011 },
  'Celina': { lat: 33.3248, lng: -96.7844 },
  'Forney': { lat: 32.7481, lng: -96.4719 },
  'Terrell': { lat: 32.7360, lng: -96.2753 },
  'Saginaw': { lat: 32.8601, lng: -97.3639 },
  'Benbrook': { lat: 32.6732, lng: -97.4606 },
  'White Settlement': { lat: 32.7598, lng: -97.4584 },
  'Haltom City': { lat: 32.7996, lng: -97.2692 },
  'North Richland Hills': { lat: 32.8343, lng: -97.2289 },
  'Bedford': { lat: 32.8440, lng: -97.1431 },
  'Euless': { lat: 32.8371, lng: -97.0820 },
  'Hurst': { lat: 32.8235, lng: -97.1706 },
  'Colleyville': { lat: 32.8810, lng: -97.1550 },
  'Coppell': { lat: 32.9546, lng: -97.0150 },
  'Lancaster': { lat: 32.5921, lng: -96.7561 },
  'DeSoto': { lat: 32.5899, lng: -96.8570 },
  'Duncanville': { lat: 32.6518, lng: -96.9083 },
  'Kennedale': { lat: 32.6468, lng: -97.2259 },
  'Alvarado': { lat: 32.4068, lng: -97.2117 },
  'Venus': { lat: 32.4335, lng: -97.1025 },
  'Maypearl': { lat: 32.3126, lng: -97.0106 },
  'Italy': { lat: 32.1841, lng: -96.8847 },
  'Red Oak': { lat: 32.5176, lng: -96.8044 },
  'Glenn Heights': { lat: 32.5482, lng: -96.8567 },
  'Hutchins': { lat: 32.6496, lng: -96.7131 },
  'Wilmer': { lat: 32.5890, lng: -96.6853 },
}

/**
 * Geocode any location string. Returns coords or null.
 * Used when stored coords and CITY_COORDS both miss.
 */
export async function geocodeLocation(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'DumpSite.io/1.0' }, signal: controller.signal }
    )
    clearTimeout(timeout)
    const data = await res.json()
    if (data?.[0]) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    }
  } catch {}
  return null
}
