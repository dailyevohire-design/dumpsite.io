// ═══════════════════════════════════════════════════════════════
// FillDirtNearMe — Pricing Engine
// Standard zone-based pricing + future priority (quarry) pricing
// ═══════════════════════════════════════════════════════════════

export const MIN_YARDS = 10

export const SOURCE_YARDS = [
  { name: "Dallas", lat: 32.7767, lng: -96.797 },
  { name: "Fort Worth", lat: 32.7555, lng: -97.3308 },
  { name: "Denver", lat: 39.7392, lng: -104.9903 },
]

// Zone pricing — base cents per yard for fill dirt
export const ZONES = [
  { zone: "A", min: 0, max: 20, baseCents: 1200 },  // $12/yd
  { zone: "B", min: 20, max: 40, baseCents: 1500 },  // $15/yd
  { zone: "C", min: 40, max: 60, baseCents: 1800 },  // $18/yd
]

// Material surcharges (added to zone base)
export const SURCHARGE_CENTS: Record<string, number> = {
  fill_dirt: 0,
  screened_topsoil: 500,   // +$5
  structural_fill: 800,    // +$8
  sand: 600,               // +$6
}

// ─────────────────────────────────────────────────────
// MATH
// ─────────────────────────────────────────────────────
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function nearestYard(lat: number, lng: number) {
  let best = SOURCE_YARDS[0], dist = Infinity
  for (const y of SOURCE_YARDS) {
    const d = haversine(lat, lng, y.lat, y.lng)
    if (d < dist) { best = y; dist = d }
  }
  return { yard: best, miles: Math.round(dist * 10) / 10 }
}

// ─────────────────────────────────────────────────────
// FORMATTING
// ─────────────────────────────────────────────────────
export function fmt$(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("en-US")
}

export function fmtMaterial(k: string): string {
  return ({
    fill_dirt: "fill dirt",
    screened_topsoil: "screened topsoil",
    structural_fill: "structural fill",
    sand: "sand",
  } as Record<string, string>)[k] || k.replace(/_/g, " ")
}

// ─────────────────────────────────────────────────────
// STANDARD QUOTE — zone-based pricing
// ─────────────────────────────────────────────────────
export interface StandardQuote {
  zone: string
  perYardCents: number
  totalCents: number
  billableYards: number
  material: string
  deliveryEstimate: string
}

export function calcStandardQuote(
  miles: number,
  material: string,
  yards: number,
): StandardQuote | null {
  const z = ZONES.find(z => miles >= z.min && miles < z.max)
  if (!z) return null // Outside service area (60+ miles)

  const surcharge = SURCHARGE_CENTS[material] || 0
  const perYardCents = z.baseCents + surcharge
  const billableYards = Math.max(yards, MIN_YARDS)

  return {
    zone: z.zone,
    perYardCents,
    totalCents: billableYards * perYardCents,
    billableYards,
    material,
    deliveryEstimate: "3-5 business days",
  }
}

// ─────────────────────────────────────────────────────
// PRIORITY QUOTE — real quarry cost + drive time markup
// Data from separate Supabase project (quarry/supplier DB)
// ─────────────────────────────────────────────────────
const QUARRY_SUPABASE_URL = "https://hnohikjuvxnszyffqqfq.supabase.co"
const QUARRY_SUPABASE_KEY = process.env.QUARRY_SUPABASE_KEY || ""

// Truck economics for delivery cost calculation
const TRUCK_HOURLY_RATE_CENTS = 12500  // $125/hr loaded truck + driver
const MARGIN_PER_YARD_CENTS = 600      // $6/yard profit margin
const AVG_SPEED_MPH = 35               // Average DFW/Denver metro driving speed

// Map our material keys to quarry DB canonical names
const MATERIAL_TO_QUARRY: Record<string, string[]> = {
  fill_dirt: ["Fill Dirt"],
  structural_fill: ["Structural Fill"],
  screened_topsoil: ["Screened Topsoil", "Topsoil"],
  sand: ["Sand", "Fill Sand", "Concrete Sand", "Masonry Sand"],
}

export interface PriorityQuote {
  perYardCents: number
  totalCents: number
  billableYards: number
  material: string
  quarryName: string
  quarryCity: string
  materialCostPerYardCents: number
  deliveryCostPerYardCents: number
  driveMiles: number
  driveMinutes: number
  deliveryEstimate: string
}

interface QuarryLocation {
  id: string
  name: string
  supplierName: string
  city: string
  lat: number
  lng: number
  priceCentsPerYard: number
}

async function findNearestQuarries(
  deliveryLat: number,
  deliveryLng: number,
  material: string,
): Promise<QuarryLocation[]> {
  if (!QUARRY_SUPABASE_KEY) return []

  const canonicalNames = MATERIAL_TO_QUARRY[material]
  if (!canonicalNames) return []

  try {
    // Get all active locations with their prices for this material
    const orFilter = canonicalNames.map(n => `material_canonical.eq.${n}`).join(",")
    const resp = await fetch(
      `${QUARRY_SUPABASE_URL}/rest/v1/public_prices?is_current=eq.true&or=(${orFilter})&select=price_per_cy,location_id,material_canonical,locations(id,name,city,latitude,longitude,supplier_id,is_active,suppliers(name))`,
      {
        headers: {
          "apikey": QUARRY_SUPABASE_KEY,
          "Authorization": `Bearer ${QUARRY_SUPABASE_KEY}`,
        },
      }
    )
    if (!resp.ok) return []
    const prices: any[] = await resp.json()

    // Build location list with best price per location
    const locationMap = new Map<string, QuarryLocation>()
    for (const p of prices) {
      const loc = p.locations
      if (!loc?.is_active || !loc.latitude || !loc.longitude) continue
      const priceCents = Math.round((p.price_per_cy || 0) * 100)
      if (priceCents <= 0 || priceCents > 20000) continue // Skip bad data ($0 or >$200/yd)

      const existing = locationMap.get(loc.id)
      if (!existing || priceCents < existing.priceCentsPerYard) {
        locationMap.set(loc.id, {
          id: loc.id,
          name: loc.name,
          supplierName: loc.suppliers?.name || "",
          city: loc.city || "",
          lat: loc.latitude,
          lng: loc.longitude,
          priceCentsPerYard: priceCents,
        })
      }
    }

    // Sort by distance to delivery address
    const locations = [...locationMap.values()].map(l => ({
      ...l,
      distance: haversine(deliveryLat, deliveryLng, l.lat, l.lng),
    })).sort((a, b) => a.distance - b.distance)

    return locations.slice(0, 5)
  } catch (e) {
    console.error("[quarry pricing]", e)
    return []
  }
}

export async function calcPriorityQuote(
  deliveryLat: number,
  deliveryLng: number,
  material: string,
  yards: number,
): Promise<PriorityQuote | null> {
  const quarries = await findNearestQuarries(deliveryLat, deliveryLng, material)
  if (!quarries.length) return null

  // Use nearest quarry with valid pricing
  const quarry = quarries[0]
  const distance = haversine(deliveryLat, deliveryLng, quarry.lat, quarry.lng)
  const driveMinutes = Math.round((distance * 1.3 / AVG_SPEED_MPH) * 60) // 1.3x for road vs straight line
  const roundTripMinutes = driveMinutes * 2

  // Delivery cost: truck time for round trip
  const deliveryCostPerYardCents = Math.round((roundTripMinutes / 60) * TRUCK_HOURLY_RATE_CENTS / Math.max(yards, MIN_YARDS))

  // Total: material + delivery + margin
  const perYardCents = quarry.priceCentsPerYard + deliveryCostPerYardCents + MARGIN_PER_YARD_CENTS
  const billableYards = Math.max(yards, MIN_YARDS)

  return {
    perYardCents,
    totalCents: billableYards * perYardCents,
    billableYards,
    material,
    quarryName: quarry.supplierName || quarry.name,
    quarryCity: quarry.city,
    materialCostPerYardCents: quarry.priceCentsPerYard,
    deliveryCostPerYardCents,
    driveMiles: Math.round(distance * 10) / 10,
    driveMinutes,
    deliveryEstimate: "1-2 business days",
  }
}

// ─────────────────────────────────────────────────────
// DUAL QUOTE — standard + priority side by side
// ─────────────────────────────────────────────────────
export interface DualQuote {
  standard: StandardQuote
  priority: PriorityQuote | null
  formatted: string // Human-readable for Sarah to present
}

export async function getDualQuote(
  customerName: string,
  deliveryLat: number | null,
  deliveryLng: number | null,
  deliveryCity: string,
  material: string,
  yards: number,
  accessType: string,
  deliveryDate?: string,
): Promise<DualQuote | null> {
  if (!deliveryLat || !deliveryLng) return null

  const nearest = nearestYard(deliveryLat, deliveryLng)
  const standard = calcStandardQuote(nearest.miles, material, yards)
  if (!standard) return null // Outside service area

  let priority = await calcPriorityQuote(deliveryLat, deliveryLng, material, yards)
  // Priority must never be cheaper than standard — bump to standard + 20% if so
  if (priority && priority.perYardCents < standard.perYardCents) {
    priority.perYardCents = Math.round(standard.perYardCents * 1.2)
    priority.totalCents = priority.billableYards * priority.perYardCents
  }

  const firstName = (customerName || "").split(/\s+/)[0] || "there"
  const materialName = fmtMaterial(material)
  const stdTotal = fmt$(standard.totalCents)
  const stdPerYd = fmt$(standard.perYardCents)

  let formatted: string
  if (priority) {
    const priTotal = fmt$(priority.totalCents)
    const priPerYd = fmt$(priority.perYardCents)
    formatted = `${firstName}, ${standard.billableYards} yards of ${materialName} to ${deliveryCity} comes to ${stdTotal} (${stdPerYd}/yard) with delivery in ${standard.deliveryEstimate}. If you need it faster, we can do guaranteed ${priority.deliveryEstimate} delivery for ${priTotal} (${priPerYd}/yard). Which works better for your timeline`
  } else {
    formatted = `${firstName}, ${standard.billableYards} yards of ${materialName} to ${deliveryCity} comes to ${stdTotal} (${stdPerYd}/yard) with delivery in ${standard.deliveryEstimate}. Want to get that scheduled`
  }

  return { standard, priority, formatted }
}
