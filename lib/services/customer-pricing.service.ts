import { createAdminSupabase } from "../supabase"

// ─────────────────────────────────────────────────────────
// STANDARD PRICING — from Juan's zone tables
// ─────────────────────────────────────────────────────────
const ZONES = [
  { zone: "A", min: 0, max: 20, baseCents: 1200 },   // $12/yd
  { zone: "B", min: 20, max: 40, baseCents: 1500 },  // $15/yd
  { zone: "C", min: 40, max: 60, baseCents: 1800 },  // $18/yd
]

const SURCHARGE_CENTS: Record<string, number> = {
  fill_dirt: 0,
  screened_topsoil: 500,    // +$5
  structural_fill: 800,     // +$8
  sand: 600,                // +$6
}

const MIN_YARDS = 10
const MARGIN_PER_YARD_CENTS = 600  // $6/yard on priority

// Truck specs
const TRUCKS = {
  tandem:    { capacity: 10, rateCents: 10000 },  // $100/hr
  triaxle:   { capacity: 16, rateCents: 10000 },  // $100/hr
  wheeler18: { capacity: 20, rateCents: 12500 },  // $125/hr
}

const LOAD_TIME_MIN = 15
const DUMP_TIME_MIN = 10

// Source yards for standard pricing distance calc
const SOURCE_YARDS = [
  { name: "Dallas", lat: 32.7767, lng: -96.797 },
  { name: "Fort Worth", lat: 32.7555, lng: -97.3308 },
  { name: "Denver", lat: 39.7392, lng: -104.9903 },
]

// Material mapping: our types → quarry database material names
const QUARRY_MATERIAL_MAP: Record<string, string[]> = {
  fill_dirt: ["Fill Dirt", "Select Fill"],
  screened_topsoil: ["Screened Topsoil", "Topsoil"],
  structural_fill: ["Structural Fill", "Select Fill", "Fill Dirt"],
  sand: ["Sand", "Concrete Sand", "Masonry Sand", "Washed Sand"],
}

// ─────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function fmt$(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })
}

function fmtMaterial(key: string): string {
  return ({ fill_dirt: "fill dirt", screened_topsoil: "screened topsoil", structural_fill: "structural fill", sand: "sand" })[key] || key.replace(/_/g, " ")
}

// ─────────────────────────────────────────────────────────
// GOOGLE MAPS DRIVE TIME
// ─────────────────────────────────────────────────────────
async function getDriveTimeMinutes(
  originLat: number, originLng: number,
  destLat: number, destLng: number
): Promise<number> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) {
    // Fallback: estimate from straight-line distance
    const miles = haversine(originLat, originLng, destLat, destLng)
    return Math.round((miles / 35) * 60) // 35mph average fallback
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLng}&destinations=${destLat},${destLng}&departure_time=now&key=${key}`
    const res = await fetch(url)
    const data = await res.json()

    if (data.status === "OK" && data.rows?.[0]?.elements?.[0]?.status === "OK") {
      const el = data.rows[0].elements[0]
      // Use duration_in_traffic if available, otherwise duration
      const seconds = el.duration_in_traffic?.value || el.duration?.value || 0
      return Math.round(seconds / 60)
    }
  } catch (e) {
    console.error("[Drive time API]", e)
  }

  // Fallback
  const miles = haversine(originLat, originLng, destLat, destLng)
  return Math.round((miles / 35) * 60)
}

// ─────────────────────────────────────────────────────────
// STANDARD QUOTE — zone-based from pricing tables
// ─────────────────────────────────────────────────────────
export interface StandardQuote {
  type: "standard"
  zone: string
  perYardCents: number
  totalCents: number
  billableYards: number
  estimatedDelivery: string
}

export function calcStandardQuote(
  customerLat: number, customerLng: number,
  materialType: string, yards: number,
): StandardQuote | null {
  // Find nearest source yard
  let nearestMiles = Infinity
  for (const y of SOURCE_YARDS) {
    const d = haversine(customerLat, customerLng, y.lat, y.lng)
    if (d < nearestMiles) nearestMiles = d
  }

  // Get zone
  const zone = ZONES.find(z => nearestMiles >= z.min && (nearestMiles < z.max || (z.zone === "C" && nearestMiles <= z.max)))
  if (!zone) return null // Outside service area

  const surcharge = SURCHARGE_CENTS[materialType] || 0
  const perYard = zone.baseCents + surcharge
  const billable = Math.max(yards, MIN_YARDS)
  const total = billable * perYard

  return {
    type: "standard",
    zone: zone.zone,
    perYardCents: perYard,
    totalCents: total,
    billableYards: billable,
    estimatedDelivery: "3-5 business days",
  }
}

// ─────────────────────────────────────────────────────────
// STANDARD-WINDOW DETECTOR
// ─────────────────────────────────────────────────────────
// Standard delivery is 3-5 business days. If the customer's requested date
// falls within that window, we should NOT attempt priority/quarry pricing —
// we can just use the standard zone quote and confirm the date with them.
//
// Only TRULY urgent dates (today, tomorrow, day-after-tomorrow, ASAP) need
// the priority quarry path. Everything else (Friday from Mon/Tue, next week,
// end of month, in 2 weeks, etc.) is standard.
//
// This is what stops the brain from spamming admin with MANUAL_PRIORITY
// alerts for dates we can already meet with standard delivery.
export function isWithinStandardWindow(dateText: string, today: Date = new Date()): boolean {
  const t = (dateText || "").toLowerCase().trim()
  if (!t) return true // no date given → flexible → standard

  // Hard urgent — definitely NOT within standard window
  if (/\b(today|hoy|right away|same day|same.?day|asap|as soon as|urgent|lo antes|cuanto antes)\b/.test(t)) return false
  if (/\b(tomorrow|manana|mañana)\b/.test(t)) return false
  if (/\b(day after tomorrow|in (a |1 )?day|next day|in 24 hours|tonight)\b/.test(t)) return false

  // Flexible signals — definitely within standard window
  if (/\b(flexible|whenever|no rush|no hurry|not urgent|when.?ever|no specific|any.?time|any day|doesn.?t matter|don.?t care|up to you)\b/.test(t)) return true
  if (/\b(this week|next week|this weekend|next weekend|next month|in (a|two|three|few|several|2|3|4|5|6) (weeks?|months?|days?)|end of (the )?(week|month))\b/.test(t)) return true

  // Day-of-week names: figure out how many days until that day
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
  }
  const dayMatch = t.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/)
  if (dayMatch) {
    const targetIdx = dayMap[dayMatch[1]]
    const todayIdx = today.getDay()
    let daysUntil = (targetIdx - todayIdx + 7) % 7
    if (daysUntil === 0) daysUntil = 7 // "Friday" said on Friday → assume next Friday
    // 3+ days out → standard window, 0-2 days out → urgent
    return daysUntil >= 3
  }

  // Numeric date M/D — parse and check business-days delta
  const numDate = t.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/)
  if (numDate) {
    const month = parseInt(numDate[1], 10) - 1
    const day = parseInt(numDate[2], 10)
    const target = new Date(today.getFullYear(), month, day)
    if (target < today) target.setFullYear(today.getFullYear() + 1) // already passed → next year
    const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return diffDays >= 3
  }

  // "April 15" / "apr 15"
  const monthDate = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})\b/)
  if (monthDate) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]
    const m = months.indexOf(monthDate[1])
    const d = parseInt(monthDate[2], 10)
    if (m >= 0 && d > 0) {
      const target = new Date(today.getFullYear(), m, d)
      if (target < today) target.setFullYear(today.getFullYear() + 1)
      const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      return diffDays >= 3
    }
  }

  // Default: if we can't tell and it's not clearly urgent, treat as standard.
  // The brain will still present standard pricing — better than spamming
  // admin with priority-confirm alerts on dates we can already meet.
  return true
}

// ─────────────────────────────────────────────────────────
// SAFE FALLBACK QUOTE — never returns null
// ─────────────────────────────────────────────────────────
// Used by the customer brain when:
//   • geocoding failed (no coords)
//   • address is outside the 60-mile service zone
//   • getDualQuote crashed for any reason
//
// The point: the customer ALWAYS gets a number they can react to. We never
// say "having a little trouble pulling up pricing" — that's the stuck signal
// that breaks the conversation. Instead we present a transparent estimate
// based on the published zone table, mark it as needs-manual-confirmation,
// and alert admin so a human can lock in the exact figure within the hour.
export interface FallbackQuote extends StandardQuote {
  isFallback: true
  reason: "no_coordinates" | "outside_service_area" | "pricing_engine_error"
}

export function safeFallbackQuote(
  materialType: string,
  yards: number,
  reason: FallbackQuote["reason"],
  distanceMilesHint?: number,
): FallbackQuote {
  // Pick a zone:
  //  - if we have a distance hint, use the matching zone (this happens when
  //    geocoding succeeded but quarry pricing later failed)
  //  - otherwise default to zone B ($15/yd) — middle of the table, fair both
  //    to the customer and to us. NEVER zone C, NEVER zone A by default.
  let zone = ZONES[1] // zone B default
  if (typeof distanceMilesHint === "number" && distanceMilesHint >= 0) {
    const found = ZONES.find(z => distanceMilesHint >= z.min && (distanceMilesHint < z.max || (z.zone === "C" && distanceMilesHint <= z.max)))
    if (found) zone = found
  }
  const surcharge = SURCHARGE_CENTS[materialType] || 0
  const perYard = zone.baseCents + surcharge
  const billable = Math.max(yards, MIN_YARDS)
  const total = billable * perYard
  return {
    type: "standard",
    zone: zone.zone,
    perYardCents: perYard,
    totalCents: total,
    billableYards: billable,
    estimatedDelivery: "3-5 business days",
    isFallback: true,
    reason,
  }
}

// ─────────────────────────────────────────────────────────
// PRIORITY QUOTE — quarry + real drive time + delivery cost
// ─────────────────────────────────────────────────────────
export interface QuarryOption {
  quarryName: string
  quarryCity: string
  quarryLat: number
  quarryLng: number
  materialCostPerYardCents: number
  distanceMiles: number
}

export interface PriorityQuote {
  type: "priority"
  quarryName: string
  quarryCity: string
  materialCostCents: number
  deliveryCostCents: number
  marginCents: number
  totalCents: number
  perYardCents: number
  billableYards: number
  loads: number
  truckType: string
  totalHours: number
  driveTimeMinutes: number
  guaranteedDate: string
}

export async function calcPriorityQuote(
  customerLat: number, customerLng: number,
  materialType: string, yards: number,
  accessType: string,
  standardPerYardCents: number, // to enforce priority >= standard
  requestedDate?: string,
): Promise<PriorityQuote | null> {
  // KILLSWITCH: priority quoting requires the public_prices quarry table.
  // If it isn't seeded yet, return null cleanly so the brain falls through
  // to standard-only pricing instead of spamming admin with MANUAL_PRIORITY
  // alerts. Set PRIORITY_QUARRY_ENABLED=true in env once the quarry data
  // is in place.
  if (process.env.PRIORITY_QUARRY_ENABLED !== "true") {
    return null
  }
  // ── Step 1: Find quarries within 60 miles with matching material ──
  const materialNames = QUARRY_MATERIAL_MAP[materialType] || ["Fill Dirt"]
  const sb = createAdminSupabase()

  // Query all matching quarries — we filter by distance in code
  // because Supabase doesn't have PostGIS distance functions easily
  const { data: rawQuarries, error } = await sb
    .from("public_prices")
    .select(`
      price_per_cy,
      material_canonical,
      location:locations!inner (
        latitude,
        longitude,
        city,
        state,
        supplier:suppliers!inner (
          name
        )
      )
    `)
    .in("material_canonical", materialNames)
    .eq("is_current", true)
    .gt("price_per_cy", 0)
    .lt("price_per_cy", 80) // filter obvious bad data

  if (error || !rawQuarries?.length) {
    console.error("[Quarry query]", error?.message || "no results")
    return null
  }

  // ── Step 2: Filter by distance and find all options ──
  const options: QuarryOption[] = []

  for (const q of rawQuarries) {
    const loc = q.location as any
    if (!loc?.latitude || !loc?.longitude) continue

    const dist = haversine(loc.latitude, loc.longitude, customerLat, customerLng)
    if (dist > 60) continue // Outside service area

    options.push({
      quarryName: loc.supplier?.name || "Unknown",
      quarryCity: loc.city || "",
      quarryLat: loc.latitude,
      quarryLng: loc.longitude,
      materialCostPerYardCents: Math.round(q.price_per_cy * 100),
      distanceMiles: Math.round(dist * 10) / 10,
    })
  }

  if (options.length === 0) return null

  // ── Step 3: Calculate total cost for each quarry option ──
  // Pick truck based on access type and order size
  let truck = TRUCKS.tandem
  let truckLabel = "dump truck"
  const billable = Math.max(yards, MIN_YARDS)

  if (accessType === "dump_truck_and_18wheeler" && billable > 16) {
    truck = TRUCKS.wheeler18
    truckLabel = "18-wheeler"
  } else if (billable > 10) {
    truck = TRUCKS.triaxle
    truckLabel = "dump truck"
  }

  const loads = Math.ceil(billable / truck.capacity)

  // Calculate delivery cost for top 5 closest quarries (limit API calls)
  const sorted = options.sort((a, b) => {
    // Sort by estimated total cost (material + rough distance)
    const costA = a.materialCostPerYardCents * billable + a.distanceMiles * 500
    const costB = b.materialCostPerYardCents * billable + b.distanceMiles * 500
    return costA - costB
  }).slice(0, 5)

  let bestOption: PriorityQuote | null = null
  let bestTotal = Infinity

  for (const quarry of sorted) {
    // Get real drive time from Google Maps
    const driveMin = await getDriveTimeMinutes(
      quarry.quarryLat, quarry.quarryLng,
      customerLat, customerLng
    )

    // Calculate total delivery time
    // Each load: loading (15min) + drive there + dump (10min) + drive back
    // Last load: no return trip
    const cycleMin = LOAD_TIME_MIN + driveMin + DUMP_TIME_MIN + driveMin
    const lastLoadMin = LOAD_TIME_MIN + driveMin + DUMP_TIME_MIN
    const totalMin = (loads > 1) ? (loads - 1) * cycleMin + lastLoadMin : lastLoadMin
    const totalHours = totalMin / 60

    // Costs in cents
    const deliveryCost = Math.round(totalHours * truck.rateCents)
    const materialCost = quarry.materialCostPerYardCents * billable
    const margin = MARGIN_PER_YARD_CENTS * billable
    let total = materialCost + deliveryCost + margin

    // Enforce: priority per-yard must be >= standard per-yard
    const perYard = Math.round(total / billable)
    if (perYard < standardPerYardCents) {
      // Bump to match standard + small premium ($2/yd)
      const bumpedPerYard = standardPerYardCents + 200
      total = bumpedPerYard * billable
    }

    if (total < bestTotal) {
      bestTotal = total
      bestOption = {
        type: "priority",
        quarryName: quarry.quarryName,
        quarryCity: quarry.quarryCity,
        materialCostCents: materialCost,
        deliveryCostCents: deliveryCost,
        marginCents: margin,
        totalCents: total,
        perYardCents: Math.round(total / billable),
        billableYards: billable,
        loads,
        truckType: truckLabel,
        totalHours: Math.round(totalHours * 10) / 10,
        driveTimeMinutes: driveMin,
        guaranteedDate: requestedDate || "your requested date",
      }
    }
  }

  return bestOption
}

// ─────────────────────────────────────────────────────────
// COMBINED QUOTE — both options formatted for Sarah
// ─────────────────────────────────────────────────────────
export interface DualQuote {
  standard: StandardQuote
  priority: PriorityQuote | null
  formatted: string
  formattedEs: string
}

export async function getDualQuote(
  customerName: string,
  customerLat: number, customerLng: number,
  deliveryCity: string,
  materialType: string, yards: number,
  accessType: string,
  requestedDate?: string,
): Promise<DualQuote | null> {
  const standard = calcStandardQuote(customerLat, customerLng, materialType, yards)
  if (!standard) return null

  const priority = await calcPriorityQuote(
    customerLat, customerLng,
    materialType, yards, accessType,
    standard.perYardCents,
    requestedDate,
  )

  const firstName = (customerName || "").split(/\s+/)[0] || ""
  const matName = fmtMaterial(materialType)
  const billable = standard.billableYards
  const cityLabel = deliveryCity || "your location"

  let formatted = ""
  let formattedEs = ""

  if (priority && priority.perYardCents > standard.perYardCents) {
    // Different prices — show both options
    formatted = `${firstName} ${billable} yards of ${matName} to ${cityLabel}\n\nStandard delivery: ${fmt$(standard.totalCents)} (${fmt$(standard.perYardCents)}/yard) 3-5 business days\nPriority delivery: ${fmt$(priority.totalCents)} (${fmt$(priority.perYardCents)}/yard) guaranteed by ${priority.guaranteedDate}\n\nWhich works better for you`

    formattedEs = `${firstName} ${billable} yardas de ${matName} a ${deliveryCity}\n\nEntrega estandar: ${fmt$(standard.totalCents)} (${fmt$(standard.perYardCents)}/yarda) 3-5 dias habiles\nEntrega prioritaria: ${fmt$(priority.totalCents)} (${fmt$(priority.perYardCents)}/yarda) garantizada para ${priority.guaranteedDate}\n\nCual te funciona mejor`
  } else {
    // Prices are close or same — just show one price
    formatted = `${firstName} ${billable} yards of ${matName} to ${cityLabel} comes to ${fmt$(standard.totalCents)} (${fmt$(standard.perYardCents)}/yard). Delivery within 3-5 business days, we can also lock in a specific date if you need it. Want me to get that set up`

    formattedEs = `${firstName} ${billable} yardas de ${matName} a ${deliveryCity} sale en ${fmt$(standard.totalCents)} (${fmt$(standard.perYardCents)}/yarda). Entrega en 3-5 dias habiles, tambien podemos garantizar fecha especifica si lo necesitas. Quieres que lo programe`
  }

  return { standard, priority, formatted, formattedEs }
}

// ─────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────
export {
  fmt$,
  fmtMaterial,
  haversine,
  MIN_YARDS,
  SOURCE_YARDS,
  ZONES,
  SURCHARGE_CENTS,
  getDriveTimeMinutes,
}
