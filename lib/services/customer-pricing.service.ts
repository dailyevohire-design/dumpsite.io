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
  const zone = ZONES.find(z => nearestMiles >= z.min && nearestMiles < z.max)
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

  let formatted = ""
  let formattedEs = ""

  if (priority && priority.perYardCents > standard.perYardCents) {
    // Different prices — show both options
    formatted = `${firstName} ${billable} yards of ${matName} to ${deliveryCity}\n\nStandard delivery: ${fmt$(standard.totalCents)} (${fmt$(standard.perYardCents)}/yard) 3-5 business days\nPriority delivery: ${fmt$(priority.totalCents)} (${fmt$(priority.perYardCents)}/yard) guaranteed by ${priority.guaranteedDate}\n\nWhich works better for you`

    formattedEs = `${firstName} ${billable} yardas de ${matName} a ${deliveryCity}\n\nEntrega estandar: ${fmt$(standard.totalCents)} (${fmt$(standard.perYardCents)}/yarda) 3-5 dias habiles\nEntrega prioritaria: ${fmt$(priority.totalCents)} (${fmt$(priority.perYardCents)}/yarda) garantizada para ${priority.guaranteedDate}\n\nCual te funciona mejor`
  } else {
    // Prices are close or same — just show one price
    formatted = `${firstName} ${billable} yards of ${matName} to ${deliveryCity} comes to ${fmt$(standard.totalCents)} (${fmt$(standard.perYardCents)}/yard). Delivery within 3-5 business days, we can also lock in a specific date if you need it. Want me to get that set up`

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
