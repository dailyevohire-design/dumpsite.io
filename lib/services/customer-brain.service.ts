import Anthropic from "@anthropic-ai/sdk"
import { createAdminSupabase } from "../supabase"
import twilio from "twilio"

const anthropic = new Anthropic()
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const CUSTOMER_TWILIO_FROM = process.env.CUSTOMER_TWILIO_NUMBER!
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")
const LARGE_ORDER_YARDS = 500

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────
interface IncomingSMS {
  from: string; body: string; messageSid: string
  numMedia: number; mediaUrl?: string
}

// ─────────────────────────────────────────────────────────
// PRICING ENGINE — matches your Excel exactly
// ─────────────────────────────────────────────────────────
const YARDS = [
  { name: "Dallas", lat: 32.7767, lng: -96.797 },
  { name: "Fort Worth", lat: 32.7555, lng: -97.3308 },
  { name: "Denver", lat: 39.7392, lng: -104.9903 },
]

const ZONES = [
  { zone: "A", minMi: 0, maxMi: 20, basePerYard: 2200 },   // $22/yd in cents
  { zone: "B", minMi: 20, maxMi: 40, basePerYard: 2500 },  // $25/yd
  { zone: "C", minMi: 40, maxMi: 60, basePerYard: 3000 },  // $30/yd
]

const MATERIAL_SURCHARGE: Record<string, number> = {
  "fill_dirt": 0,
  "screened_topsoil": 500,    // +$5/yd
  "structural_fill": 800,     // +$8/yd
  "sand": 600,                // +$6/yd
}

const MIN_YARDS = 10

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function findNearestYard(lat: number, lng: number): { yard: typeof YARDS[0]; miles: number } {
  let best = YARDS[0], bestDist = Infinity
  for (const y of YARDS) {
    const d = haversine(lat, lng, y.lat, y.lng)
    if (d < bestDist) { best = y; bestDist = d }
  }
  return { yard: best, miles: Math.round(bestDist * 10) / 10 }
}

function getZone(miles: number): typeof ZONES[0] | null {
  for (const z of ZONES) { if (miles >= z.minMi && miles < z.maxMi) return z }
  return null
}

function calculateQuote(miles: number, materialType: string, yards: number): {
  zone: string; pricePerYardCents: number; totalCents: number; billableYards: number
} | null {
  const z = getZone(miles)
  if (!z) return null
  const surcharge = MATERIAL_SURCHARGE[materialType] || 0
  const pricePerYard = z.basePerYard + surcharge
  const billableYards = Math.max(yards, MIN_YARDS)
  return { zone: z.zone, pricePerYardCents: pricePerYard, totalCents: billableYards * pricePerYard, billableYards }
}

function cubicYards(lengthFt: number, widthFt: number, depthFt: number): number {
  return Math.ceil((lengthFt * widthFt * depthFt) / 27)
}

// ─────────────────────────────────────────────────────────
// MATERIAL RECOMMENDATION (code-based, no AI needed for common cases)
// ─────────────────────────────────────────────────────────
function recommendMaterial(purpose: string): { material: string; materialKey: string; explanation: string } | null {
  const p = purpose.toLowerCase()
  if (/pool|swimming/i.test(p)) return { material: "Structural Fill", materialKey: "structural_fill", explanation: "structural fill is best for pool fills since it compacts well and provides a stable base" }
  if (/foundation|slab|footin|footing|concrete pad/i.test(p)) return { material: "Structural Fill", materialKey: "structural_fill", explanation: "structural fill compacts properly under foundations and slabs" }
  if (/driveway|road|parking/i.test(p)) return { material: "Structural Fill", materialKey: "structural_fill", explanation: "structural fill is what you want for driveways and roads since it compacts and drains well" }
  if (/garden|flower|plant|landscap|sod|grass|lawn/i.test(p)) return { material: "Screened Topsoil", materialKey: "screened_topsoil", explanation: "screened topsoil is perfect for that since its nutrient-rich and great for growing" }
  if (/raised bed|planter/i.test(p)) return { material: "Screened Topsoil", materialKey: "screened_topsoil", explanation: "screened topsoil works great for raised beds" }
  if (/level|grading|grade|low spot|fill.*hole|hole|uneven|slope/i.test(p)) return { material: "Fill Dirt", materialKey: "fill_dirt", explanation: "clean fill dirt is perfect for leveling and grading" }
  if (/backfill|retaining|wall/i.test(p)) return { material: "Fill Dirt", materialKey: "fill_dirt", explanation: "fill dirt works great for backfill behind retaining walls" }
  if (/sandbox|play.*area|play.*ground/i.test(p)) return { material: "Sand", materialKey: "sand", explanation: "clean sand is what you need for that" }
  if (/erosion|drainage|drain/i.test(p)) return { material: "Fill Dirt", materialKey: "fill_dirt", explanation: "fill dirt works well for erosion control and drainage correction" }
  if (/septic/i.test(p)) return { material: "Sand", materialKey: "sand", explanation: "sand is typically what you need around septic systems" }
  return null // Unknown — let Sonnet handle
}

// ─────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^1/, "")
}

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]
}

function formatDollars(cents: number): string {
  return "$" + (cents / 100).toFixed(0)
}

function formatMaterial(key: string): string {
  const map: Record<string,string> = {
    fill_dirt: "fill dirt", screened_topsoil: "screened topsoil",
    structural_fill: "structural fill", sand: "sand",
  }
  return map[key] || key.replace(/_/g, " ")
}

// ─────────────────────────────────────────────────────────
// GEOCODE — uses Google Maps API
// ─────────────────────────────────────────────────────────
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number; city: string } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`
    const res = await fetch(url)
    const data = await res.json()
    if (data.status === "OK" && data.results[0]) {
      const loc = data.results[0].geometry.location
      const city = data.results[0].address_components?.find((c: any) => c.types.includes("locality"))?.long_name || ""
      return { lat: loc.lat, lng: loc.lng, city }
    }
  } catch (e) { console.error("[geocode]", e) }
  return null
}

// ─────────────────────────────────────────────────────────
// DB HELPERS
// ─────────────────────────────────────────────────────────
async function getConv(phone: string): Promise<any> {
  const sb = createAdminSupabase()
  const { data } = await sb.from("customer_conversations").select("*").eq("phone", phone).maybeSingle()
  return data || { state: "NEW" }
}

async function saveConv(phone: string, u: Record<string, any>): Promise<void> {
  const sb = createAdminSupabase()
  await sb.rpc("upsert_customer_conversation", {
    p_phone: phone,
    p_state: u.state ?? null,
    p_customer_name: u.customer_name ?? null,
    p_customer_email: u.customer_email ?? null,
    p_delivery_address: u.delivery_address ?? null,
    p_delivery_city: u.delivery_city ?? null,
    p_delivery_lat: u.delivery_lat ?? null,
    p_delivery_lng: u.delivery_lng ?? null,
    p_material_purpose: u.material_purpose ?? null,
    p_material_type: u.material_type ?? null,
    p_yards_needed: u.yards_needed ?? null,
    p_dimensions_raw: u.dimensions_raw ?? null,
    p_access_type: u.access_type ?? null,
    p_delivery_date: u.delivery_date ?? null,
    p_zone: u.zone ?? null,
    p_distance_miles: u.distance_miles ?? null,
    p_price_per_yard_cents: u.price_per_yard_cents ?? null,
    p_total_price_cents: u.total_price_cents ?? null,
    p_payment_method: u.payment_method ?? null,
    p_payment_account: u.payment_account ?? null,
    p_payment_status: u.payment_status ?? null,
    p_dispatch_order_id: u.dispatch_order_id ?? null,
    p_follow_up_at: u.follow_up_at ?? null,
    p_follow_up_count: u.follow_up_count ?? null,
  })
}

async function isDuplicate(sid: string): Promise<boolean> {
  const sb = createAdminSupabase()
  const { data } = await sb.rpc("check_customer_message", { p_sid: sid })
  return !data
}

async function getHistory(phone: string): Promise<{ role: "user"|"assistant"; content: string }[]> {
  const sb = createAdminSupabase()
  const { data } = await sb.from("customer_sms_logs").select("body, direction")
    .eq("phone", phone).order("created_at", { ascending: false }).limit(20)
  if (!data) return []
  return data.reverse().map((m: any) => ({
    role: (m.direction === "inbound" ? "user" : "assistant") as "user"|"assistant",
    content: (m.body || "").trim(),
  })).filter(m => m.content.length > 0)
}

async function logMsg(phone: string, body: string, dir: "inbound"|"outbound", sid: string): Promise<void> {
  try {
    const sb = createAdminSupabase()
    await sb.from("customer_sms_logs").insert({ phone, body, direction: dir, message_sid: sid })
  } catch {}
}

async function sendSMS(to: string, body: string, sid: string): Promise<void> {
  const msg = await twilioClient.messages.create({ body, from: CUSTOMER_TWILIO_FROM, to: `+1${to.replace(/\D/g,"").replace(/^1/,"")}` })
  await logMsg(to.replace(/\D/g,"").replace(/^1/,""), body, "outbound", msg.sid || `out_${sid}`)
}

async function notifyAdmin(message: string, sid: string): Promise<void> {
  try { await sendSMS(ADMIN_PHONE, message, `admin_${sid}`) } catch {}
}

// ─────────────────────────────────────────────────────────
// CREATE DISPATCH ORDER — connects customer to driver system
// ─────────────────────────────────────────────────────────
async function createDispatchOrder(conv: any, phone: string): Promise<string | null> {
  const sb = createAdminSupabase()
  try {
    const { data, error } = await sb.from("dispatch_orders").insert({
      client_phone: phone,
      client_name: conv.customer_name || "Customer",
      client_address: conv.delivery_address,
      yards_needed: conv.yards_needed,
      price_quoted_cents: conv.total_price_cents,
      driver_pay_cents: Math.round((conv.price_per_yard_cents || 0) * 0.5 * (conv.yards_needed || 10)), // 50% margin placeholder
      status: "open",
      notes: `${formatMaterial(conv.material_type)} - ${conv.access_type || "dump truck"} access - Delivery: ${conv.delivery_date || "ASAP"}`,
    }).select("id").single()
    if (error) { console.error("[dispatch create]", error); return null }
    return data?.id || null
  } catch (e) { console.error("[dispatch create]", e); return null }
}

// ─────────────────────────────────────────────────────────
// SONNET CALL — only for material recommendation & off-topic
// ─────────────────────────────────────────────────────────
const SARAH_PROMPT = `You are Sarah from Fill Dirt Near Me. Professional, warm, helpful. You help customers get the right dirt delivered.

RULES:
- 1-2 sentences max. Friendly but efficient.
- No bullet points, no lists, no menus.
- Use customer's name when you have it.
- You know dirt: fill dirt, structural fill, screened topsoil, sand.
- Recommend the right material based on what they're doing.
- If they ask about pricing, tell them you need their delivery address first to give an accurate quote.
- Never admit to being AI. You are Sarah.
- If they ask something off-topic, answer briefly and steer back to helping with their dirt delivery.

MATERIAL KNOWLEDGE:
- Pool fill / foundation / slab / driveway → Structural Fill (compacts, stable)
- Garden / landscaping / sod / lawn → Screened Topsoil (nutrient-rich)
- Leveling / grading / backfill / fill holes → Fill Dirt (clean, affordable)
- Sandbox / play area / septic → Sand
- General construction → Structural Fill

CUBIC YARD FORMULA: Length(ft) × Width(ft) × Depth(ft) ÷ 27

OUTPUT: JSON only
{"response":"text to send customer","recommendedMaterial":"fill_dirt|screened_topsoil|structural_fill|sand|null"}`

async function callSonnet(
  body: string, conv: any, history: { role: "user"|"assistant"; content: string }[],
  instruction: string,
): Promise<{ response: string; recommendedMaterial?: string }> {
  try {
    const ctx = [
      `Customer: ${conv.customer_name || "unknown"}`,
      `State: ${conv.state}`,
      `Address: ${conv.delivery_address || "not yet"}`,
      `Purpose: ${conv.material_purpose || "not yet"}`,
      `Material: ${conv.material_type ? formatMaterial(conv.material_type) : "not yet"}`,
      `Yards: ${conv.yards_needed || "not yet"}`,
      "",
      `INSTRUCTION: ${instruction}`,
      "",
      `Customer said: ${body}`,
    ].join("\n")

    const messages = [...history.slice(-12), { role: "user" as const, content: ctx }]
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      system: SARAH_PROMPT,
      messages,
    })
    const raw = resp.content[0].type === "text" ? resp.content[0].text.trim() : ""
    const cleaned = raw.replace(/^```json\s*/i,"").replace(/```\s*$/i,"").trim()
    return JSON.parse(cleaned)
  } catch (e) {
    console.error("[Sonnet]", e)
    return { response: "Give me just a moment, checking on that for you" }
  }
}

// ─────────────────────────────────────────────────────────
// RESPONSE VALIDATOR — catches anything unprofessional
// ─────────────────────────────────────────────────────────
function validate(r: string): string {
  // Block AI admission
  for (const p of ["i am an ai","i'm an ai","language model","claude","anthropic","i am a bot"]) {
    if (r.toLowerCase().includes(p)) return "This is Sarah with Fill Dirt Near Me, how can I help"
  }
  // Block too long
  if (r.length > 300) {
    const first = r.split(/[.!?\n]/).filter(s => s.trim().length > 5).slice(0, 2).join(". ")
    r = first || r.slice(0, 290)
  }
  return r.trim() || "Give me just a moment"
}

// ─────────────────────────────────────────────────────────
// MAIN HANDLER — Templates control flow, Sonnet writes words
// ─────────────────────────────────────────────────────────
export async function handleCustomerSMS(sms: IncomingSMS): Promise<string> {
  const phone = normalizePhone(sms.from)
  const body = (sms.body || "").trim()
  const lower = body.toLowerCase().trim()
  const sid = sms.messageSid

  // SAFETY NET — entire function wrapped
  try {

  // Dedup
  if (await isDuplicate(sid)) return ""
  await logMsg(phone, body || "[empty]", "inbound", sid)

  // STOP/START
  if (lower === "stop" || lower === "unsubscribe") {
    const sb = createAdminSupabase()
    try { await sb.from("customer_conversations").update({ opted_out: true }).eq("phone", phone) } catch {}
    return ""
  }
  if (lower === "start") {
    const sb = createAdminSupabase()
    try { await sb.from("customer_conversations").update({ opted_out: false }).eq("phone", phone) } catch {}
    const reply = "Hey you're back on, how can I help you with your dirt delivery"
    await logMsg(phone, reply, "outbound", `start_${sid}`)
    return reply
  }

  // Load conversation
  const conv = await getConv(phone)
  if (conv.opted_out) return ""
  const state = conv.state || "NEW"
  const name = conv.customer_name || ""
  const history = await getHistory(phone)

  let reply = ""
  const updates: Record<string, any> = {}

  // ═══════════════════════════════════════════════════
  // STATE MACHINE — templates for every step
  // ═══════════════════════════════════════════════════

  switch (state) {

    case "NEW": {
      reply = "Hey this is Sarah with Fill Dirt Near Me, whats your name"
      updates.state = "ASKING_NAME"
      break
    }

    case "ASKING_NAME": {
      const nameParts = body.trim().split(/\s+/)
      const firstName = nameParts[0] || "there"
      updates.customer_name = body.trim()
      updates.state = "ASKING_ADDRESS"
      reply = `${firstName} nice to meet you, whats the delivery address`
      break
    }

    case "ASKING_ADDRESS": {
      // Try to geocode
      const geo = await geocodeAddress(body)
      if (geo) {
        updates.delivery_address = body.trim()
        updates.delivery_city = geo.city
        updates.delivery_lat = geo.lat
        updates.delivery_lng = geo.lng
        const nearest = findNearestYard(geo.lat, geo.lng)
        updates.distance_miles = nearest.miles
        const zone = getZone(nearest.miles)
        updates.zone = zone?.zone || null
        updates.state = "ASKING_PURPOSE"
        reply = `Got it. What are you going to be using the material for? This helps me make sure we bring you the right stuff`
      } else {
        // Could not geocode — ask again more specifically
        reply = `${name || "Hey"} I need the full delivery address with city and state so I can give you an accurate quote`
      }
      break
    }

    case "ASKING_PURPOSE": {
      updates.material_purpose = body.trim()
      updates.state = "RECOMMENDING"

      // Try code-based recommendation first
      const rec = recommendMaterial(body)
      if (rec) {
        updates.material_type = rec.materialKey
        updates.state = "ASKING_YARDS"
        const firstName = (name || "").split(/\s+/)[0] || ""
        reply = `${firstName} for that ${rec.explanation}. How many cubic yards do you need? If you're not sure I can help you figure it out`
      } else {
        // Unknown purpose — ask Sonnet
        const sonnet = await callSonnet(body, { ...conv, material_purpose: body }, history,
          "Customer told you what they need the dirt for. Recommend the right material type and ask how many cubic yards. If you're not sure, ask a clarifying question.")
        if (sonnet.recommendedMaterial) {
          updates.material_type = sonnet.recommendedMaterial
          updates.state = "ASKING_YARDS"
        }
        reply = validate(sonnet.response)
      }
      break
    }

    case "RECOMMENDING": {
      // Fallback if somehow stuck here
      const rec = recommendMaterial(conv.material_purpose || body)
      if (rec) {
        updates.material_type = rec.materialKey
        updates.state = "ASKING_YARDS"
        reply = `I'd recommend ${rec.material} for that. How many cubic yards do you need`
      } else {
        updates.state = "ASKING_YARDS"
        updates.material_type = "fill_dirt"
        reply = "How many cubic yards do you need? If you're not sure I can help you figure it out"
      }
      break
    }

    case "ASKING_YARDS": {
      // Check for "I don't know" / dimension request
      if (/don.?t know|not sure|no idea|no se|how much|how do i|figure|calculate|dimensions/i.test(lower)) {
        updates.state = "ASKING_DIMENSIONS"
        reply = "No problem, what are the dimensions of the area? Just give me the length, width and depth in feet"
        break
      }

      // Check for "let me get back to you" / follow up
      if (/get back|think about|later|not sure yet|maybe|let me check|call you back/i.test(lower)) {
        updates.state = "FOLLOW_UP"
        updates.follow_up_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        updates.follow_up_count = 0
        const firstName = (name || "").split(/\s+/)[0] || ""
        reply = `No problem ${firstName}, take your time. I'll check back with you tomorrow. Just text me when you're ready`
        break
      }

      // Parse yards
      const yardMatch = body.match(/(\d+)/i)
      if (yardMatch) {
        const yards = parseInt(yardMatch[1])
        if (yards > 0) {
          updates.yards_needed = yards
          updates.state = "ASKING_ACCESS"
          if (yards < MIN_YARDS) {
            reply = `Just so you know we have a ${MIN_YARDS} yard minimum on deliveries. Does your property have access for dump trucks and 18 wheelers or just dump trucks`
          } else {
            reply = "Does your property have access for dump trucks and 18 wheelers or just dump trucks"
          }
          break
        }
      }
      reply = "How many cubic yards do you need? Just the number is fine"
      break
    }

    case "ASKING_DIMENSIONS": {
      // Parse dimensions: "20 x 40 x 6", "20 by 40 by 6", "20ft 40ft 6ft", etc
      const nums = body.match(/(\d+\.?\d*)/g)
      if (nums && nums.length >= 3) {
        const l = parseFloat(nums[0]), w = parseFloat(nums[1]), d = parseFloat(nums[2])
        const yards = cubicYards(l, w, d)
        updates.yards_needed = yards
        updates.dimensions_raw = body.trim()
        updates.state = "ASKING_ACCESS"
        reply = `That comes out to about ${yards} cubic yards. Does your property have access for dump trucks and 18 wheelers or just dump trucks`
      } else if (nums && nums.length === 2) {
        reply = "I need three measurements — length, width and depth in feet. Whats the depth"
      } else {
        reply = "Just give me the length, width and depth in feet, like 20 x 40 x 6"
      }
      break
    }

    case "ASKING_ACCESS": {
      if (/18|eighteen|wheeler|semi|both|all|either/i.test(lower)) {
        updates.access_type = "dump_truck_and_18wheeler"
      } else {
        updates.access_type = "dump_truck_only"
      }
      updates.state = "ASKING_DATE"
      reply = "When do you need delivery"
      break
    }

    case "ASKING_DATE": {
      updates.delivery_date = body.trim()

      // Calculate quote
      const miles = conv.distance_miles || 0
      const material = conv.material_type || "fill_dirt"
      const yards = conv.yards_needed || MIN_YARDS
      const quote = calculateQuote(miles, material, yards)

      if (quote) {
        updates.price_per_yard_cents = quote.pricePerYardCents
        updates.total_price_cents = quote.totalCents
        updates.zone = quote.zone
        updates.state = "QUOTING"

        const firstName = (name || "").split(/\s+/)[0] || ""
        const city = conv.delivery_city || ""
        const materialName = formatMaterial(material)
        reply = `${firstName} based on your location, ${quote.billableYards} yards of ${materialName} delivered${city ? " to " + city : ""} comes to ${formatDollars(quote.totalCents)} thats ${formatDollars(quote.pricePerYardCents)} per yard. Want me to get that scheduled`
      } else {
        // Outside service area
        reply = `Unfortunately that delivery address is outside our current service area. We cover up to 60 miles from our yards in Dallas, Fort Worth and Denver. Is there another address we can deliver to`
        updates.state = "ASKING_ADDRESS"
      }
      break
    }

    case "QUOTING": {
      const isYes = /^(yes|yeah|yep|sure|ok|okay|lets do it|sounds good|perfect|go ahead|book it|set it up|schedule|please|absolutely|definitely|si|dale)$/i.test(lower)
      const isNo = /^(no|nah|nope|too much|expensive|pass|never mind|cancel)$/i.test(lower)

      if (isYes) {
        updates.state = "ASKING_EMAIL"
        reply = "Whats your email so we can send the receipt"
      } else if (isNo) {
        updates.state = "FOLLOW_UP"
        updates.follow_up_at = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
        const firstName = (name || "").split(/\s+/)[0] || ""
        reply = `No worries ${firstName}. If you change your mind or want to adjust the order just text me back`
      } else if (/get back|think|later/i.test(lower)) {
        updates.state = "FOLLOW_UP"
        updates.follow_up_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        reply = "Take your time, I'll follow up tomorrow. Just text me when you're ready"
      } else {
        // Off-topic or question — let Sonnet handle
        const sonnet = await callSonnet(body, conv, history,
          "Customer was quoted a price. They said something other than yes/no. Respond naturally and ask if they want to proceed with the order.")
        reply = validate(sonnet.response)
      }
      break
    }

    case "ASKING_EMAIL": {
      // Validate email
      if (/@/.test(body) && /\./.test(body)) {
        updates.customer_email = body.trim().toLowerCase()
        updates.state = "ASKING_PAYMENT_METHOD"
        reply = "For payment we accept zelle or venmo only. Our drivers are independently insured so we cant accept cash or check at the time of delivery. Which works better for you"
      } else {
        reply = "I need your email address for the receipt, whats the best email"
      }
      break
    }

    case "ASKING_PAYMENT_METHOD": {
      if (/zelle/i.test(lower)) {
        updates.payment_method = "zelle"
        updates.state = "ASKING_PAYMENT_ACCOUNT"
        const total = formatDollars(conv.total_price_cents || 0)
        reply = `Send ${total} via Zelle to support@filldirtnearme.net. Text me once its sent and we'll get your delivery confirmed`
      } else if (/venmo/i.test(lower)) {
        updates.payment_method = "venmo"
        updates.state = "ASKING_PAYMENT_ACCOUNT"
        const total = formatDollars(conv.total_price_cents || 0)
        reply = `Send ${total} via Venmo to @FillDirtNearMe. Text me once its sent and we'll get your delivery confirmed`
      } else if (/cash|check|cheque/i.test(lower)) {
        reply = "Sorry we can only accept Zelle or Venmo. Our drivers are independently insured so cash and check arent an option at delivery. Which works for you, zelle or venmo"
      } else {
        reply = "We accept Zelle or Venmo, which works better for you"
      }
      break
    }

    case "ASKING_PAYMENT_ACCOUNT": {
      // Customer confirming they sent payment
      if (/sent|paid|done|confirmed|just sent|payment sent/i.test(lower)) {
        updates.payment_status = "confirming"
        updates.state = "ORDER_PLACED"

        // Create dispatch order
        const orderId = await createDispatchOrder({ ...conv, ...updates }, phone)
        if (orderId) {
          updates.dispatch_order_id = orderId

          // Notify admin
          const yards = conv.yards_needed || MIN_YARDS
          if (yards >= LARGE_ORDER_YARDS) {
            await notifyAdmin(`Large customer order: ${name} — ${yards} yds ${formatMaterial(conv.material_type || "fill_dirt")} to ${conv.delivery_city} — ${formatDollars(conv.total_price_cents || 0)}`, sid)
          }
          await notifyAdmin(`New customer order: ${name} — ${yards} yds to ${conv.delivery_city} — ${formatDollars(conv.total_price_cents || 0)} — ${conv.payment_method}`, sid)
        }

        const firstName = (name || "").split(/\s+/)[0] || ""
        reply = `Payment received ${firstName}, your delivery is confirmed for ${conv.delivery_date || "soon"}. You'll get a text when your driver is on the way. Thanks for choosing Fill Dirt Near Me`
      } else {
        const total = formatDollars(conv.total_price_cents || 0)
        reply = `Just text me once you've sent the ${total} payment and I'll get everything confirmed`
      }
      break
    }

    case "ORDER_PLACED": {
      // Customer texting after order placed
      if (/cancel|refund/i.test(lower)) {
        await notifyAdmin(`Customer ${name} (${phone}) requesting cancellation`, sid)
        reply = "Let me check on that for you. Someone from our team will reach out shortly"
      } else if (/when|status|update|where|driver|delivery/i.test(lower)) {
        reply = "Your order is confirmed and we're working on scheduling your driver. You'll get a text as soon as they're on the way"
      } else {
        const sonnet = await callSonnet(body, conv, history,
          "Customer already has a confirmed order. Answer their question helpfully and briefly.")
        reply = validate(sonnet.response)
      }
      break
    }

    case "FOLLOW_UP": {
      // Customer came back after saying "let me think"
      const firstName = (name || "").split(/\s+/)[0] || ""
      if (/yes|ready|lets do it|go ahead|ok|sure/i.test(lower)) {
        if (conv.total_price_cents) {
          updates.state = "ASKING_EMAIL"
          reply = `${firstName} glad to have you back. Whats your email so we can send the receipt`
        } else {
          updates.state = "ASKING_ADDRESS"
          reply = `${firstName} welcome back. Whats the delivery address`
        }
      } else {
        // Treat as fresh continuation
        const sonnet = await callSonnet(body, conv, history,
          "Customer previously said they'd get back to you. They're texting again. Respond warmly and help them continue where they left off.")
        reply = validate(sonnet.response)
      }
      break
    }

    default: {
      // Unknown state — try to figure out what they need
      const sonnet = await callSonnet(body, conv, history,
        "Customer texted. Figure out what they need and help them. If they want dirt delivery, start the qualification process.")
      reply = validate(sonnet.response)
      updates.state = "ASKING_NAME"
    }
  }

  // Save conversation state
  await saveConv(phone, { ...conv, ...updates })

  // Validate and send
  reply = validate(reply)
  await logMsg(phone, reply, "outbound", `out_${sid}`)
  return reply

  } catch (err: any) {
    // SAFETY NET — never go silent
    console.error("[CUSTOMER BRAIN CRASH]", err?.message || err)
    const fallback = "Give me just a moment, checking on that for you"
    try { await logMsg(phone, fallback, "outbound", `safety_${sms.messageSid}`) } catch {}
    return fallback
  }
}
