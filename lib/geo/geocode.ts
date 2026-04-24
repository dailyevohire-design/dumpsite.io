import { createAdminSupabase } from "../supabase"

// ─────────────────────────────────────────────────────────
// GEOCODE
// Extracted from lib/services/customer-brain.service.ts in Stage 2 so the
// internal /api/internal/geocode endpoint (used by the rep-portal manual
// order flow) and Sarah's brain share one canonical implementation.
// Behavior preserved exactly: geocode_cache lookup → Google Maps → Nominatim
// fallback → null. Never throws. Returns { lat, lng, city } or null.
// ─────────────────────────────────────────────────────────
export async function geocode(address: string): Promise<{ lat: number; lng: number; city: string } | null> {
  // Cache lookup (geocode_cache table — see migration 027)
  const addressKey = address.trim().toLowerCase().replace(/\s+/g, " ")
  try {
    const sb = createAdminSupabase()
    const { data: cached } = await sb
      .from("geocode_cache")
      .select("lat, lng, city")
      .eq("address_key", addressKey)
      .maybeSingle()
    if (cached) {
      // Bump usage stats async — don't await
      sb.from("geocode_cache")
        .update({ last_used_at: new Date().toISOString(), hits: ((cached as any).hits || 0) + 1 })
        .eq("address_key", addressKey)
        .then(() => {}, () => {})
      return { lat: cached.lat, lng: cached.lng, city: cached.city || "" }
    }
  } catch {}

  const cacheResult = async (lat: number, lng: number, city: string, source: string) => {
    try {
      await createAdminSupabase().from("geocode_cache").upsert({
        address_key: addressKey, raw_address: address, lat, lng, city, source,
      }, { onConflict: "address_key" })
    } catch {}
  }

  const key = process.env.GOOGLE_MAPS_API_KEY
  // Try Google Maps first
  if (key) {
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`)
      const d = await r.json()
      if (d.status === "OK" && d.results[0]) {
        const loc = d.results[0].geometry.location
        const city = d.results[0].address_components?.find((c: any) => c.types.includes("locality"))?.long_name || ""
        await cacheResult(loc.lat, loc.lng, city, "google")
        return { lat: loc.lat, lng: loc.lng, city }
      }
    } catch (err) {
      console.error("[customer geocode] Google Maps error:", err)
    }
  }
  // Fallback: Nominatim (city-level)
  try {
    await new Promise(r => setTimeout(r, 300))
    // Don't assume Texas — check if address already has a state, otherwise leave as-is
    const hasState = /\b(Texas|TX|Colorado|CO|Denver)\b/i.test(address)
    const q = encodeURIComponent(hasState ? address : `${address} USA`)
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`
    const r = await fetch(url, { headers: { "User-Agent": "DumpSite.io/1.0" } })
    const data = await r.json()
    if (data?.[0]) {
      const city = data[0].display_name?.split(",")[0] || ""
      const lat = parseFloat(data[0].lat), lng = parseFloat(data[0].lon)
      await cacheResult(lat, lng, city, "nominatim")
      return { lat, lng, city }
    }
  } catch (err) {
    console.error("[customer geocode] Nominatim fallback error:", err)
  }
  return null
}
