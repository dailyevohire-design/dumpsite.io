import Anthropic from "@anthropic-ai/sdk"
import { createAdminSupabase } from "../supabase"
import { getDualQuote } from "./customer-pricing.service"
import { createDispatchOrder as systemDispatch } from "./dispatch.service"
import { createCustomerPaymentCheckout, checkPaymentStatus } from "./payment.service"
import twilio from "twilio"

const anthropic = new Anthropic()
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const CUSTOMER_FROM = process.env.CUSTOMER_TWILIO_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")
const ADMIN_PHONE_2 = (process.env.ADMIN_PHONE_2 || "").replace(/\D/g, "")
const LARGE_ORDER = 500

// ─────────────────────────────────────────────────────────
// SALES AGENT LOOKUP — maps Twilio numbers to agents
// Cached in memory for 5 minutes to avoid DB hit on every SMS
// ─────────────────────────────────────────────────────────
type SalesAgent = { id: string; name: string; twilio_number: string; personal_number: string; commission_rate: number }
let agentCache: { agents: SalesAgent[]; loadedAt: number } = { agents: [], loadedAt: 0 }
const AGENT_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function loadAgents(): Promise<SalesAgent[]> {
  if (Date.now() - agentCache.loadedAt < AGENT_CACHE_TTL && agentCache.agents.length > 0) return agentCache.agents
  const sb = createAdminSupabase()
  const { data, error } = await sb.from("sales_agents").select("id, name, twilio_number, personal_number, commission_rate").eq("active", true)
  if (error) {
    console.error("[sales agents] Failed to load:", error.message)
    return agentCache.agents // Return stale cache on error
  }
  agentCache = { agents: data || [], loadedAt: Date.now() }
  return agentCache.agents
}

async function lookupAgent(sourceNumber: string): Promise<SalesAgent | null> {
  if (!sourceNumber) return null
  const agents = await loadAgents()
  // Match by digits — sourceNumber is already normalized (no +1 prefix)
  return agents.find(a => a.twilio_number === sourceNumber) || null
}

async function notifyAgent(agent: SalesAgent, msg: string, sid: string) {
  if (!agent.personal_number) return
  // Send from admin number (not from the agent's Twilio number — that would confuse the customer webhook)
  const adminFrom = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
  if (!adminFrom) { console.error("[notifyAgent] No admin FROM number configured"); return }
  try {
    await twilioClient.messages.create({ body: msg, from: adminFrom, to: `+1${agent.personal_number}` })
    console.log(`[notifyAgent] Notified ${agent.name} at ${agent.personal_number}`)
  } catch (e) {
    console.error(`[notifyAgent] FAILED to notify ${agent.name}:`, (e as any)?.message)
    // Log to DB so we have a record
    try { await createAdminSupabase().from("customer_sms_logs").insert({ phone: "system", body: `AGENT NOTIFY FAILED: ${agent.name} — ${msg.slice(0, 300)}`, direction: "error", message_sid: `agent_notify_fail_${sid}` }) } catch {}
  }
}

// ─────────────────────────────────────────────────────────
// PRICING ENGINE — exact match to your Excel
// ─────────────────────────────────────────────────────────
const SOURCE_YARDS = [
  { name: "Dallas", lat: 32.7767, lng: -96.797 },
  { name: "Fort Worth", lat: 32.7555, lng: -97.3308 },
  { name: "Denver", lat: 39.7392, lng: -104.9903 },
]
const ZONES = [
  { zone: "A", min: 0, max: 20, base: 1200 },
  { zone: "B", min: 20, max: 40, base: 1500 },
  { zone: "C", min: 40, max: 60, base: 1800 },
]
const SURCHARGE: Record<string, number> = {
  fill_dirt: 0, screened_topsoil: 500, structural_fill: 800, sand: 600,
}
const MIN_YARDS = 10

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function nearestYard(lat: number, lng: number) {
  let best = SOURCE_YARDS[0], dist = Infinity
  for (const y of SOURCE_YARDS) { const d = haversine(lat, lng, y.lat, y.lng); if (d < dist) { best = y; dist = d } }
  return { yard: best, miles: Math.round(dist * 10) / 10 }
}

function calcQuote(miles: number, material: string, yards: number) {
  const z = ZONES.find(z => miles >= z.min && (miles < z.max || (z.zone === "C" && miles <= z.max)))
  if (!z) return null
  const perYard = z.base + (SURCHARGE[material] || 0)
  const billable = Math.max(yards, MIN_YARDS)
  return { zone: z.zone, perYardCents: perYard, totalCents: billable * perYard, billable }
}

function cubicYards(l: number, w: number, d: number): number { return Math.ceil((l * w * d) / 27) }

// Convert depth to feet — handles explicit units and bare numbers
// Context: depths > 3ft are extremely rare in dirt delivery (pools are wide, not deep)
// Common depths: 4in, 6in, 1ft, 2ft, 3ft — bare "6" is ambiguous but likely inches
function depthToFeet(value: number, text: string): number {
  // Explicit feet → use as-is
  if (/\b(feet|ft|foot)\b/i.test(text)) return value
  // Explicit inches → convert
  if (/\b(inch|inches|in)\b|"/i.test(text)) return value / 12
  // No unit specified — heuristic:
  // 1-3 is ambiguous (could be feet or inches) — assume FEET (1-3ft depths are common for leveling/grading)
  // 4-12 assume inches (4-12 inches is typical slab/leveling depth)
  // >12 assume inches (nobody does a 13-foot-deep fill)
  if (value >= 1 && value <= 3) return value // assume feet
  return value / 12 // assume inches
}
function fmt$(cents: number): string { return "$" + (cents/100).toLocaleString("en-US", { maximumFractionDigits: 0 }) }
function fmtMaterial(k: string): string { return ({ fill_dirt:"fill dirt", screened_topsoil:"screened topsoil", structural_fill:"structural fill", sand:"sand" })[k] || k.replace(/_/g," ") }

// ─────────────────────────────────────────────────────────
// GEOCODE
// ─────────────────────────────────────────────────────────
async function geocode(address: string): Promise<{ lat: number; lng: number; city: string } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  // Try Google Maps first
  if (key) {
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`)
      const d = await r.json()
      if (d.status === "OK" && d.results[0]) {
        const loc = d.results[0].geometry.location
        const city = d.results[0].address_components?.find((c: any) => c.types.includes("locality"))?.long_name || ""
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
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), city }
    }
  } catch (err) {
    console.error("[customer geocode] Nominatim fallback error:", err)
  }
  return null
}

// ─────────────────────────────────────────────────────────
// CODE-BASED EXTRACTION — AI never sets these fields
// ─────────────────────────────────────────────────────────
function extractYards(text: string, allowBareNumber: boolean = true): number | null {
  // First try explicit yards mention: "20 yards", "100 cy", "50 cubic yards"
  const explicit = text.match(/(\d+)\s*(cubic\s*)?(yards?|yds?|cy)\b/i)
  if (explicit) return parseInt(explicit[1])
  // "about/around/roughly/maybe/probably/like N" — common casual patterns
  const approx = text.match(/\b(?:about|around|roughly|maybe|probably|like|need|want|thinking)\s+(\d+)\b/i)
  if (approx && allowBareNumber) return parseInt(approx[1])
  // Bare number (e.g. "100") — only when we're expecting yards
  if (allowBareNumber) {
    const bare = text.match(/^\s*(\d+)\s*$/)
    if (bare) return parseInt(bare[1])
  }
  return null
}

function extractDimensions(text: string): { l: number; w: number; d: number } | null {
  // Require dimension-like patterns (x/by separators or unit mentions), not just 3 random numbers
  // This prevents "100 yards at 123 Main St apt 4" from being treated as dimensions
  const hasDimSeparator = /\d+\s*[x×]\s*\d+/i.test(text) || /\d+\s*by\s*\d+/i.test(text) || /\d+\s*ft?\s*[x×]\s*\d+/i.test(text)
  if (!hasDimSeparator) return null
  const nums = text.match(/(\d+\.?\d*)/g)
  if (nums && nums.length >= 3) return { l: parseFloat(nums[0]), w: parseFloat(nums[1]), d: parseFloat(nums[2]) }
  return null
}

function extractEmail(text: string): string | null {
  const m = text.match(/[\w.-]+@[\w.-]+\.\w+/)
  return m ? m[0].toLowerCase() : null
}

function extractMaterialFromPurpose(purpose: string): { key: string; name: string } | null {
  const p = purpose.toLowerCase()
  // Check explicit material names FIRST (customer confirming a recommendation)
  if (/\bstructural\s*fill\b/i.test(p)) return { key: "structural_fill", name: "structural fill" }
  if (/\btopsoil\b|\bscreened\s*topsoil\b/i.test(p)) return { key: "screened_topsoil", name: "screened topsoil" }
  if (/\bfill\s*dirt\b/i.test(p)) return { key: "fill_dirt", name: "fill dirt" }
  if (/\bsand\b/i.test(p) && !/thousand|grand/i.test(p)) return { key: "sand", name: "sand" }
  // Then check purpose keywords
  if (/pool|foundation|slab|footing|driveway|road|parking|pad|concrete|patio|sidewalk|compac/i.test(p)) return { key: "structural_fill", name: "structural fill" }
  if (/garden|flower|plant|landscap|sod|grass|lawn|raised bed|planter|grow|organic|mulch/i.test(p)) return { key: "screened_topsoil", name: "screened topsoil" }
  if (/sandbox|play.*area|play.*ground|septic|volleyball/i.test(p)) return { key: "sand", name: "sand" }
  if (/level|grad|fill|hole|low spot|uneven|slope|backfill|retaining|erosion|drain|trench|pipe/i.test(p)) return { key: "fill_dirt", name: "fill dirt" }
  return null
}

function looksLikeAddress(text: string): boolean {
  // Require street number + street name + street suffix as a WHOLE WORD (not embedded in "driveway", "topsoil", etc.)
  const streetPattern = /\d+\s+\w+.*\b(st|ave|blvd|dr|rd|ln|ct|pkwy|hwy|street|avenue|drive|road|lane|circle|trail|place|expy|way)\b/i.test(text)
  // "way" embedded in "driveway" or "freeway" is NOT an address — require "way" at end or followed by comma/space+word
  if (streetPattern && /\bway\b/i.test(text) && !/\d+\s+\w+.*\bway\b\s*($|,|\d)/i.test(text)) {
    // Check if "way" is actually part of a street name vs "driveway"
    if (/driveway|freeway|hallway|pathway|gateway|doorway|runway|subway|highway/i.test(text)) return false
  }
  // Exclude common false positives: messages about yards/dirt that happen to contain numbers
  if (/\b(yards?|yds?|dirt|fill|topsoil|sand|gravel|material|delivery|truck|dump|load)\b/i.test(text) && !streetPattern) return false
  return streetPattern || /^\d{5}(-\d{4})?$/.test(text.trim())
}

function looksLikeFollowUp(text: string): boolean {
  const t = text.toLowerCase()
  // Don't match "not sure how many" or "not sure what I need" — those are help requests, not delays
  if (/not sure (how|what|which|about the)/i.test(t)) return false
  // Don't match "get back to my house/property" — they're giving info
  if (/get back to (my|the|our)/i.test(t)) return false
  return /\b(think about it|get back to you|later|maybe later|let me think|call you back|hold off|not ready yet|give me a (day|few|minute|bit|week)|need to (talk|ask|check with)|ask my (husband|wife|boss|partner))\b/i.test(t)
}

// ─────────────────────────────────────────────────────────
// DB HELPERS
// ─────────────────────────────────────────────────────────
function normalizePhone(raw: string): string { return raw.replace(/\D/g, "").replace(/^1/, "") }

async function getConv(phone: string): Promise<{ conv: any; readAt: string | undefined }> {
  const sb = createAdminSupabase()
  const { data, error } = await sb.from("customer_conversations").select("*").eq("phone", phone).maybeSingle()
  if (error) {
    console.error("[CRITICAL] getConv FAILED:", error.message, "| phone:", phone)
    await notifyAdmin(`GETCONV FAILED: ${error.message} | Phone: ${phone}. Customer may be treated as NEW incorrectly.`, `getconv_fail_${Date.now()}`)
  }
  return { conv: data || { state: "NEW" }, readAt: data?.updated_at }
}

async function saveConv(phone: string, u: Record<string, any>, readAt?: string): Promise<void> {
  const sb = createAdminSupabase()

  // Race condition guard: if the row was modified after we read it, another request
  // wrote in between. COALESCE handles most cases (null=keep existing), but log a
  // warning so we can detect conflicting state changes.
  if (readAt) {
    const { data: current } = await sb.from("customer_conversations").select("updated_at, state").eq("phone", phone).maybeSingle()
    if (current && current.updated_at && current.updated_at > readAt) {
      console.warn(`[RACE] saveConv for ${phone}: row modified since read (read at ${readAt}, now ${current.updated_at}, DB state: ${current.state}, our state: ${u.state || "unchanged"}). COALESCE will merge safely but state may conflict.`)
      // If the DB already has a more advanced state, don't regress it
      const STATE_ORDER: Record<string, number> = { NEW: 0, COLLECTING: 1, ASKING_DIMENSIONS: 2, QUOTING: 3, ORDER_PLACED: 4, AWAITING_PAYMENT: 5, AWAITING_PRIORITY_PAYMENT: 5, DELIVERED: 6, CLOSED: 7, FOLLOW_UP: 3 }
      if (u.state && current.state && (STATE_ORDER[current.state] || 0) > (STATE_ORDER[u.state] || 0)) {
        console.warn(`[RACE] Preventing state regression: DB has ${current.state}, we wanted ${u.state}. Keeping DB state.`)
        u.state = null // Don't overwrite — let COALESCE keep the existing state
      }
    }
  }

  const { error } = await sb.rpc("upsert_customer_conversation", {
    p_phone: phone, p_state: u.state ?? null,
    p_customer_name: u.customer_name ?? null, p_customer_email: u.customer_email ?? null,
    p_delivery_address: u.delivery_address ?? null, p_delivery_city: u.delivery_city ?? null,
    p_delivery_lat: u.delivery_lat ?? null, p_delivery_lng: u.delivery_lng ?? null,
    p_material_purpose: u.material_purpose ?? null, p_material_type: u.material_type ?? null,
    p_yards_needed: u.yards_needed ?? null, p_dimensions_raw: u.dimensions_raw ?? null,
    p_access_type: u.access_type ?? null, p_delivery_date: u.delivery_date ?? null,
    p_zone: u.zone ?? null, p_distance_miles: u.distance_miles ?? null,
    p_price_per_yard_cents: u.price_per_yard_cents ?? null, p_total_price_cents: u.total_price_cents ?? null,
    p_payment_method: u.payment_method ?? null, p_payment_account: u.payment_account ?? null,
    p_payment_status: u.payment_status ?? null, p_dispatch_order_id: u.dispatch_order_id ?? null,
    p_follow_up_at: u.follow_up_at ?? null, p_follow_up_count: u.follow_up_count ?? null,
    p_source_number: u.source_number ?? null, p_agent_id: u.agent_id ?? null,
  })
  if (error) {
    console.error("[CRITICAL] saveConv FAILED:", error.message, "| phone:", phone, "| state:", u.state)
    await notifyAdmin(`SAVECONV FAILED: ${error.message} | Phone: ${phone} | State: ${u.state || "?"}. Customer conversation is NOT being saved.`, `saveconv_fail_${Date.now()}`)
  }
}

async function savePriorityFields(phone: string, fields: Record<string, any>): Promise<void> {
  const sb = createAdminSupabase()
  const { error } = await sb.from("customer_conversations").update(fields).eq("phone", phone)
  if (error) {
    console.error("[CRITICAL] savePriorityFields FAILED:", error.message, "| phone:", phone)
    await notifyAdmin(`SAVE PRIORITY FAILED: ${error.message} | Phone: ${phone}. Priority fields NOT saved.`, `priority_fail_${Date.now()}`)
  }
}

async function isDupe(sid: string): Promise<boolean> {
  const sb = createAdminSupabase()
  const { data, error } = await sb.rpc("check_customer_message", { p_sid: sid })
  if (error) {
    // CRITICAL: If dedup check fails, DO NOT drop the message. Process it.
    // Worst case is a duplicate response. That's better than silence.
    console.error("[CRITICAL] isDupe RPC FAILED:", error.message, "| sid:", sid)
    return false // NOT a dupe — process the message
  }
  return !data
}

async function getHistory(phone: string) {
  const sb = createAdminSupabase()
  const { data } = await sb.from("customer_sms_logs").select("body, direction").eq("phone", phone).in("direction", ["inbound", "outbound"]).order("created_at", { ascending: false }).limit(24)
  if (!data) return []
  return data.reverse().map((m: any) => ({ role: (m.direction === "inbound" ? "user" : "assistant") as "user"|"assistant", content: (m.body || "").trim() })).filter(m => m.content.length > 0)
}

async function logMsg(phone: string, body: string, dir: "inbound"|"outbound"|"error", sid: string) {
  try {
    const { error } = await createAdminSupabase().from("customer_sms_logs").insert({ phone, body, direction: dir, message_sid: sid })
    if (error) console.error("[logMsg] insert failed:", error.message, "| phone:", phone, "| dir:", dir)
  } catch (e) {
    console.error("[logMsg] threw:", (e as any)?.message, "| phone:", phone, "| dir:", dir)
  }
}

async function sendSMS(to: string, body: string, sid: string) {
  const msg = await twilioClient.messages.create({ body, from: CUSTOMER_FROM, to: `+1${normalizePhone(to)}` })
  await logMsg(normalizePhone(to), body, "outbound", msg.sid || `out_${sid}`)
}

const ADMIN_FROM = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""

async function notifyAdmin(msg: string, sid: string) {
  if (process.env.PAUSE_ADMIN_SMS === "true") { console.log(`[SMS PAUSED] Admin: ${msg.slice(0, 80)}`); return }
  // Use driver number for admin alerts so replies don't hit customer webhook
  try {
    await twilioClient.messages.create({ body: msg, from: ADMIN_FROM, to: `+1${ADMIN_PHONE}` })
    await logMsg(ADMIN_PHONE, msg, "outbound", `adm_${sid}`)
  } catch (e) {
    console.error("[notifyAdmin] FAILED to send to primary:", (e as any)?.message)
    // DB fallback — at least log it somewhere
    try { await createAdminSupabase().from("customer_sms_logs").insert({ phone: "system", body: `ADMIN ALERT UNSENT: ${msg.slice(0, 400)}`, direction: "error", message_sid: `admin_fail_${sid}` }) } catch {}
  }
  if (ADMIN_PHONE_2) {
    try {
      await twilioClient.messages.create({ body: msg, from: ADMIN_FROM, to: `+1${ADMIN_PHONE_2}` })
    } catch (e) {
      console.error("[notifyAdmin] FAILED to send to secondary:", (e as any)?.message)
    }
  }
}

async function createDispatchOrder(conv: any, phone: string): Promise<string | null> {
  try {
    const sb = createAdminSupabase()

    // Resolve city_id from delivery_city — this ensures correct region dispatch
    // DFW orders → DFW drivers, Denver orders → Denver drivers
    let cityId: string | null = null
    if (conv.delivery_city) {
      const { data: city } = await sb
        .from("cities")
        .select("id")
        .ilike("name", `%${conv.delivery_city.trim()}%`)
        .eq("is_active", true)
        .maybeSingle()
      cityId = city?.id || null
    }

    if (!cityId) {
      // City not in system — notify admin for manual handling but still create order
      console.error(`[customer dispatch] City not found: ${conv.delivery_city}`)
      await notifyAdmin(`Customer order needs manual city assignment — "${conv.delivery_city}" not in cities table. Customer: ${conv.customer_name} (${phone}) ${conv.yards_needed}yds to ${conv.delivery_address}`, `city_miss_${Date.now()}`)
      // Fallback: insert directly so order isn't lost
      const { data } = await sb.from("dispatch_orders").insert({
        client_phone: phone, client_name: conv.customer_name || "Customer",
        client_address: conv.delivery_address, yards_needed: conv.yards_needed || MIN_YARDS,
        price_quoted_cents: conv.total_price_cents, driver_pay_cents: 4000,
        status: "dispatching", source: "web_form",
        delivery_latitude: conv.delivery_lat || null, delivery_longitude: conv.delivery_lng || null,
        notes: `${fmtMaterial(conv.material_type || "fill_dirt")} | ${conv.access_type || "dump truck"} access | ${conv.delivery_date || "Flexible"} | Source: FillDirtNearMe SMS | NEEDS MANUAL CITY ASSIGNMENT`,
      }).select("id").single()
      return data?.id || null
    }

    // Use the REAL dispatch service — handles driver pay rates, SMS notifications,
    // tier-based dispatch, and ensures drivers are only notified in their own city
    const truckType = conv.access_type === "dump_truck_and_18wheeler" ? "end_dump" : "tandem_axle"
    const result = await systemDispatch({
      clientName: conv.customer_name || "Customer",
      clientPhone: phone,
      clientAddress: conv.delivery_address,
      cityId,
      yardsNeeded: conv.yards_needed || MIN_YARDS,
      priceQuotedCents: conv.total_price_cents || 0,
      truckTypeNeeded: truckType,
      notes: `${fmtMaterial(conv.material_type || "fill_dirt")} | ${conv.access_type || "dump truck"} access | ${conv.delivery_date || "Flexible"} | Source: FillDirtNearMe SMS`,
      urgency: "standard",
      source: "web_form",
    })

    if (result.success && result.dispatchId) {
      console.log(`[customer dispatch] Order ${result.dispatchId} — ${result.driversNotified} drivers notified in ${result.cityName}`)
      return result.dispatchId
    }
    console.error("[customer dispatch] Failed:", result.error)
    return null
  } catch (e) { console.error("[dispatch]", e); return null }
}

// ─────────────────────────────────────────────────────────
// THE BRAIN — Sonnet generates EVERY response
// Code decides what Sonnet should do. Sonnet decides how to say it.
// ─────────────────────────────────────────────────────────
const SARAH_SYSTEM = `You are Sarah. You work for Fill Dirt Near Me. You help people get the right dirt delivered for their projects. You are a real person texting from your phone. You are NOT AI and will never admit to being AI.

YOUR PERSONALITY:
You genuinely care about helping people with their projects. You're the friend who knows everything about dirt and construction. You're warm but efficient. You explain things simply without being condescending. You're patient with people who don't know what they need — most of your customers are homeowners doing something for the first time.

You don't sound like a saleswoman. You sound like someone who wants to help them get the right result. You ask about their project because you're interested and because it matters — wrong material ruins a project. You guide them to the right decision.

HOW YOU TEXT:
- 1-3 sentences. Natural, conversational. Complete thoughts.
- Use their name occasionally but not every message.
- No bullet points, no lists, no menus, no "Reply X" EVER.
- No periods at end of last sentence.
- No dashes (—), no em dashes, no en dashes. Use commas instead.
- No exclamation marks. Ever. Real people texting dont use them.
- NEVER apologize. You have nothing to be sorry for. No "sorry", "my bad", "oops", "apologies".
- NEVER start a message with "Ha", "Haha", "Lol", or any laughing opener.
- NEVER say "I'm Sarah" or introduce yourself after the first message. They already know who you are.
- Match their energy — casual customer gets casual Sarah, professional contractor gets professional Sarah.
- Ask one thing at a time. Never stack questions.
- If they tell you something unexpected, respond to THAT before moving forward.
- If they ask a question, ANSWER IT before asking your next question.

TRUCK ACCESS — CRITICAL:
- A standard dump truck (tandem, triaxle, quad axle, super dump) can get ANYWHERE a regular vehicle can go. These are your standard delivery trucks.
- An 18-wheeler (end dump, semi) is much bigger and needs a wider road and room to turn around. NOT every property can fit one.
- When asking about access, you are ONLY asking about 18-wheelers. Never ask "can a dump truck get to your property" because dump trucks go everywhere.
- The correct question is: "can an 18-wheeler get to your property or should we use standard dump trucks"

WHAT YOU KNOW ABOUT DIRT:
- Fill Dirt: clean, general purpose. Leveling, grading, filling holes, backfill behind retaining walls, general site prep. Most affordable. $12-18/yard depending on distance.
- Structural Fill: engineered to compact. Foundations, slabs, driveways, pool fills, anything that needs a solid stable base underneath. Slightly more at $20-26/yard.
- Screened Topsoil: nutrient-rich, great for growing things. Gardens, landscaping, sod prep, raised beds, lawn repair. $17-23/yard.
- Sand: play areas, sandboxes, septic systems, drainage. $18-24/yard.
- Minimum delivery is 10 cubic yards (about one tandem dump truck load).
- Tandem dump truck = 10 yards, tri-axle = 16 yards, end dump = 18 yards.
- Cubic yard formula: Length(ft) × Width(ft) × Depth(ft) ÷ 27.
- A typical pool fill is 150-300 cubic yards depending on size.
- A typical yard leveling job is 10-50 cubic yards.
- We deliver same day to 5 business days depending on availability and area.
- We cover Dallas/Fort Worth metro and Denver metro, up to 60 miles from our yards.
- We do NOT spread or grade — delivery only. We drop it where you want it.
- We do NOT deliver on top of septic systems or in areas where trucks might sink.
- Dump trucks weigh 25-30 tons loaded. Driveways can handle them but soft ground cannot.
- Rain can delay delivery — we won't deliver if the truck will get stuck.
- All our material is screened and clean. No debris, no trash, no contaminants.

PAYMENT RULES:
- Payment is collected AFTER delivery, not before.
- We accept Venmo, Zelle, or online invoice (credit/debit card with a 3.5% processing fee).
- NO cash. NO check. Reason: Our drivers are independently insured contractors. For insurance and liability purposes we cannot accept cash or check.
- When discussing payment methods during quoting, just mention the options. Do NOT share actual Venmo handle or Zelle email yet. That comes after delivery.
- After delivery is confirmed, we follow up to collect payment with actual account details.

WHEN CUSTOMER ASKS FOR ORDER STATUS:
- If they have an active order: "Your delivery is scheduled, you'll get a text as soon as your driver is heading your way"
- If we don't have drivers in their area yet: "We're not currently hauling in your area but as soon as we are you'll be the first to know"
- If order is pending payment: "Just need that payment confirmed and we'll get you on the schedule"

WHEN CUSTOMER WANTS TO CANCEL:
- "Let me get someone from our team to help with that" → system notifies admin

WHEN CUSTOMER ASKS ABOUT TIMING:
- Explain delivery is typically 1-5 business days depending on area and availability
- Ask if they need it by a specific date or if they're flexible — this matters for scheduling

AD LEADS (CRAIGSLIST, FACEBOOK, ETC):
- Most customers found you through a Craigslist or Facebook ad. They were auto-replied with something like "about to step into a meeting, text me at this number" or "heading to lunch, shoot me a text."
- They think they're texting the person from the ad. DO NOT break that illusion. DO NOT introduce yourself as Sarah. DO NOT say "this is Fill Dirt Near Me" or any company name. Just respond naturally like you're the person they expect.
- They may say things like "I saw your ad", "texting about the dirt", "someone told me to text this number" — just roll with it. You already know they came from an ad. Don't explain it.
- Some customers will text once, get busy, and text again hours or days later from the same number. That's totally normal. The system remembers their conversation. Pick up where you left off, don't restart from scratch. If they seem confused, just say "hey we were chatting earlier" and continue.

CRITICAL RULES — NEVER BREAK:
- NEVER say "I'll get back to you", "let me check and get back", "I'll follow up", or any promise to proactively text them later. You CANNOT initiate texts. If you say this, the customer waits forever and nobody follows up.
- NEVER give price ranges or estimates from your general knowledge. Only share exact prices when the system gives you a specific quote to present. If you don't have a quote yet, say "let me get you the exact number" and ask the next question to complete the quote.
- ALWAYS follow the task instruction. The >>> YOUR TASK <<< section tells you exactly what to say. Do that FIRST, then add personality. Don't ignore the task to talk about something else.

SELF-CHECK BEFORE RESPONDING:
1. Did I follow the TASK instruction above?
2. Did I answer their question FIRST before asking mine?
3. Is my response under 3 sentences?
4. Does it sound like a real person texting, not a customer service bot?
5. Am I asking only ONE thing?
6. Did I avoid promising to "get back to them" or "check on something"?

OUTPUT FORMAT: JSON only, no markdown
{"response":"your text to the customer","extractedData":{}}`

async function callSarah(
  body: string, conv: any, history: { role: "user"|"assistant"; content: string }[],
  instruction: string,
): Promise<{ response: string; extractedData?: any }> {
  try {
    // Build context — tells Sonnet exactly what we know and what to do
    const has = (v: any) => v !== null && v !== undefined && v !== ""
    const collected: string[] = []
    if (has(conv.customer_name)) collected.push(`Name: ${conv.customer_name}`)
    if (has(conv.delivery_address)) collected.push(`Address: ${conv.delivery_address} (${conv.delivery_city || ""}, ${conv.distance_miles || "?"}mi, Zone ${conv.zone || "?"})`)
    if (has(conv.material_purpose)) collected.push(`Purpose: ${conv.material_purpose}`)
    if (has(conv.material_type)) collected.push(`Material: ${fmtMaterial(conv.material_type)}`)
    if (has(conv.yards_needed)) collected.push(`Yards: ${conv.yards_needed}`)
    if (has(conv.access_type)) collected.push(`Access: ${conv.access_type}`)
    if (has(conv.delivery_date)) collected.push(`Delivery: ${conv.delivery_date}`)
    if (has(conv.customer_email)) collected.push(`Email: ${conv.customer_email}`)
    if (has(conv.payment_method)) collected.push(`Payment: ${conv.payment_method}`)
    if (has(conv.total_price_cents)) collected.push(`Quote: ${fmt$(conv.total_price_cents)} (${fmt$(conv.price_per_yard_cents || 0)}/yd)`)
    if (has(conv.dispatch_order_id)) collected.push(`Order: CONFIRMED`)

    const ctx = [
      "CONVERSATION STATE:",
      collected.length > 0 ? collected.join(" | ") : "New customer, nothing collected yet",
      "",
      `>>> YOUR TASK: ${instruction} <<<`,
      "",
      `Customer said: ${body}`,
      "",
      "Respond as Sarah. JSON only.",
    ].join("\n")

    const attemptSarah = async () => {
      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 250,
        system: SARAH_SYSTEM,
        messages: [...history.slice(-16), { role: "user" as const, content: ctx }],
      })
      const raw = resp.content[0].type === "text" ? resp.content[0].text.trim() : ""
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
      return JSON.parse(cleaned)
    }

    try {
      return await attemptSarah()
    } catch (firstErr) {
      console.error("[Sarah brain] attempt 1 failed, retrying in 2s:", firstErr)
      await new Promise(r => setTimeout(r, 2000))
      return await attemptSarah()
    }
  } catch (e) {
    console.error("[Sarah brain] both attempts failed:", e)
    // Notify admin via sms_logs AND SMS
    const sb = createAdminSupabase()
    try { await sb.from("customer_sms_logs").insert({ phone: "system", body: `SARAH BRAIN DOWN: ${(e as any)?.message || "unknown error"}. Conv state: ${conv?.state || "unknown"}`, direction: "error", message_sid: `err_${Date.now()}` }) } catch {}
    try { await notifyAdmin(`SONNET DOWN: Sarah brain failed twice. Customer state: ${conv?.state || "unknown"}. Error: ${(e as any)?.message || "unknown"}`, `sonnet_down_${Date.now()}`) } catch {}
    // Context-aware fallback based on conversation state
    const state = conv?.state || "NEW"
    const fallbacks: Record<string, string> = {
      NEW: "Hey whats your name",
      COLLECTING: !conv?.customer_name ? "Hey whats your name" : !conv?.delivery_address ? "Whats the delivery address" : !conv?.material_purpose ? "What are you using the dirt for" : "Let me pull up those numbers, one sec",
      QUOTING: "Let me pull up those numbers, one sec",
      ASKING_DIMENSIONS: "What are the dimensions you're working with, length width and depth in feet",
      AWAITING_PAYMENT: "Just following up on payment, Venmo Zelle or invoice works for us",
      AWAITING_PRIORITY_PAYMENT: "Just checking in on that payment link, let me know if you need it resent",
      ORDER_PLACED: "Your order is in, you'll get a text when your driver is heading your way",
      CLOSED: "Hey how can I help",
    }
    return { response: fallbacks[state] || "Give me one sec, let me check on that" }
  }
}

// ─────────────────────────────────────────────────────────
// VALIDATOR
// ─────────────────────────────────────────────────────────
function validate(r: string, lastOutbound: string): string {
  // Block AI admissions
  for (const p of ["i am an ai","i'm an ai","language model","claude","anthropic","i am a bot","i'm a bot","as an ai","artificial intelligence"]) {
    if (r.toLowerCase().includes(p)) return "This is Sarah with Fill Dirt Near Me, how can I help"
  }
  // Strip em dashes, en dashes — replace with comma or nothing
  r = r.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").trim()
  // Strip exclamation marks — real people texting don't use these
  r = r.replace(/!/g, "")
  // Strip "Ha " / "Haha " / "Lol " openers — sounds fake
  r = r.replace(/^(ha|haha|hehe|lol|oops|sorry|my bad|apologies)\s*,?\s*/i, "").trim()
  // Never apologize — Sarah has nothing to be sorry for
  r = r.replace(/\b(sorry about that|my apologies|I apologize|sorry for)\b/gi, "").replace(/\s{2,}/g, " ").trim()
  // Truncate if too long
  if (r.length > 320) r = r.split(/[.?\n]/).filter(s => s.trim().length > 5).slice(0, 3).join(". ").trim()
  // Remove trailing period
  r = r.replace(/\.\s*$/, "").trim()
  // Capitalize first letter if needed
  if (r.length > 0) r = r[0].toUpperCase() + r.slice(1)
  // Dedup — don't send exact same message (use varied responses to avoid loops)
  if (r.toLowerCase() === lastOutbound.toLowerCase() && r.length > 10) {
    const dedupResponses = [
      "Let me know if you have any other questions",
      "Anything else I can help with",
      "Just text me if you need anything",
      "Im here if you need me",
    ]
    r = dedupResponses[Math.floor(Math.random() * dedupResponses.length)]
  }
  return r || "Give me one sec"
}

// ─────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────
export async function handleCustomerSMS(sms: { from: string; body: string; messageSid: string; numMedia: number; mediaUrl?: string; sourceNumber?: string }): Promise<string> {
  const phone = normalizePhone(sms.from)
  let body = (sms.body || "").trim()
  let lower = body.toLowerCase().trim()
  const sid = sms.messageSid
  const sourceNumber = sms.sourceNumber || ""

  try {

  if (await isDupe(sid)) return ""
  await logMsg(phone, body || (sms.numMedia > 0 ? "[photo]" : "[empty]"), "inbound", sid)

  // ── SALES AGENT ATTRIBUTION ──
  // Look up which agent's Twilio number was texted. Store on conversation for commission tracking.
  // Agent is set ONCE on first contact and preserved via COALESCE on subsequent messages.
  const agent = await lookupAgent(sourceNumber)

  // ── RAPID-FIRE CONCATENATION ──
  // If customer sent multiple messages in quick succession WITHOUT Sarah replying,
  // concatenate them into one message so Sarah sees the full context.
  // The FIRST message in a burst gets delayed (5s webhook delay). Later messages
  // in the burst are the ones that arrive here while the first is still pending.
  // Strategy: if this is a later message in a burst, skip it — but STORE the body
  // so the first message's handler can fetch and concatenate all burst messages.
  const sb_debounce = createAdminSupabase()
  const tenSecAgo = new Date(Date.now() - 10000).toISOString()
  const { data: recentMsgs } = await sb_debounce
    .from("customer_sms_logs")
    .select("direction, body, created_at")
    .eq("phone", phone)
    .in("direction", ["inbound", "outbound"])
    .gt("created_at", tenSecAgo)
    .order("created_at", { ascending: false })
    .limit(8)
  if (recentMsgs && recentMsgs.length >= 2) {
    let consecutiveInbound = 0
    for (const m of recentMsgs) {
      if (m.direction === "inbound") consecutiveInbound++
      else break
    }
    if (consecutiveInbound >= 2) {
      // This is a later message in a burst — it's already logged above.
      // The first message's handler will pick it up via getRecentInbound below.
      console.log(`[customer SMS] Burst message ${consecutiveInbound} from ${phone}, stored for concatenation`)
      return ""
    }
  }

  // If this is the FIRST message (or no burst), check if there are recent
  // inbound messages that were part of a burst we need to concatenate
  let concatenatedBody = body
  if (recentMsgs) {
    const burstBodies: string[] = []
    for (const m of recentMsgs) {
      if (m.direction === "inbound" && m.body && m.body !== body && m.body !== "[photo]" && m.body !== "[empty]") {
        burstBodies.push(m.body)
      } else if (m.direction === "outbound") break
    }
    if (burstBodies.length > 0) {
      // burstBodies is newest-first, reverse to get chronological order
      // Current body is the newest, burst bodies are older messages
      concatenatedBody = [...burstBodies.reverse(), body].join(" ")
      console.log(`[customer SMS] Concatenated ${burstBodies.length + 1} burst messages for ${phone}: "${concatenatedBody.slice(0, 100)}"`)
    }
  }

  // Apply concatenated body for all processing below
  body = concatenatedBody
  lower = body.toLowerCase().trim()

  // Empty body with photo — acknowledge it (but check opt-out first)
  if (sms.numMedia > 0 && !body) {
    const { conv: photoConv } = await getConv(phone)
    if (photoConv.opted_out) return ""
    // Persist agent attribution even on photo-only first contact
    if (agent && !photoConv.agent_id) {
      await saveConv(phone, { source_number: sourceNumber, agent_id: agent.id }, photoConv.updated_at)
    }
    const s = await callSarah("[Customer sent a photo]", photoConv, await getHistory(phone), "Customer sent a photo. Acknowledge it naturally, like 'thanks for the pic' or 'got the photo'. Then continue with whatever question you need to ask next based on what info is still missing")
    const r = validate(s.response, "")
    await logMsg(phone, r, "outbound", `photo_${sid}`)
    return r
  }

  // STOP/START
  if (lower === "stop" || lower === "unsubscribe") {
    try { await createAdminSupabase().from("customer_conversations").update({ opted_out: true }).eq("phone", phone) } catch {}
    return ""
  }
  if (lower === "start") {
    try { await createAdminSupabase().from("customer_conversations").update({ opted_out: false }).eq("phone", phone) } catch {}
    const r = "Hey you're back on. How can I help with your project"
    await logMsg(phone, r, "outbound", `start_${sid}`); return r
  }

  const { conv, readAt } = await getConv(phone)
  if (conv.opted_out) return ""
  const state = conv.state || "NEW"
  const history = await getHistory(phone)
  const lastOut = history.filter(h => h.role === "assistant").slice(-1)[0]?.content || ""
  const updates: Record<string, any> = {}
  let reply = ""

  // Set agent attribution — only on first contact (COALESCE preserves existing values)
  if (agent && !conv.agent_id) {
    updates.source_number = sourceNumber
    updates.agent_id = agent.id
  }

  // ═══════════════════════════════════════════════════════
  // CODE DETERMINES WHAT TO DO → SONNET DECIDES HOW TO SAY IT
  // ═══════════════════════════════════════════════════════

  // ── INLINE EXTRACTION (code always does this, not AI) ──
  // Only accept bare numbers as yards if we're past material collection (otherwise "100" could be anything)
  const hasMaterialContext = conv.material_type != null && conv.material_type !== "" || conv.material_purpose != null && conv.material_purpose !== ""
  const inlineYards = extractYards(body, hasMaterialContext)
  const inlineDims = extractDimensions(body)
  const inlineEmail = extractEmail(body)
  const inlineMaterial = extractMaterialFromPurpose(body)
  const isAddress = looksLikeAddress(body)
  const isFollowUp = looksLikeFollowUp(lower)

  // ── ACCESS TYPE EXTRACTION ──
  const inlineAccess = (() => {
    if (/\b(18.?wheel|big rig|semi|tractor|wide open|plenty of room|lots of room|big truck|any size|all good|both|end dump|large|biggest)\b/i.test(lower)) return "dump_truck_and_18wheeler"
    if (/\b(just dump|dump truck only|no.*(18|semi|big)|tight|narrow|small street|residential|driveway only|only dump|regular|standard|normal|tandem|small(er)?(\s+truck)?|basic|just a dump|regular dump|standard dump|regular size|normal size)\b/i.test(lower)) return "dump_truck_only"
    return null
  })()

  // ── DELIVERY DATE EXTRACTION ──
  const inlineDate = (() => {
    if (/\b(today|hoy)\b/i.test(lower)) return "Today"
    if (/\b(tomorrow|manana|mañana)\b/i.test(lower)) return "Tomorrow"
    if (/\b(asap|as soon as|right away|urgent|lo antes|cuanto antes)\b/i.test(lower)) return "ASAP"
    if (/\b(this week)\b/i.test(lower)) return "This week"
    if (/\b(next week)\b/i.test(lower)) return "Next week"
    if (/\b(flexible|whenever|no rush|no hurry|not urgent|when.?ever)\b/i.test(lower)) return "Flexible"
    // Try to match a date like "April 5" or "4/5" or "monday"
    const dateMatch = body.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
    if (dateMatch) return dateMatch[0]
    const numDate = body.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/)
    if (numDate) return `${numDate[1]}/${numDate[2]}`
    const monthDate = body.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})\b/i)
    if (monthDate) return `${monthDate[1]} ${monthDate[2]}`
    return null
  })()
  // Flexible yes/no — match at start or as the whole message. Allows trailing words like "yes please do it"
  const isYes = /^(yes|yeah|yep|sure|ok|okay|si|dale|absolutely|definitely|perfect|ready)\b/i.test(lower) || /\b(lets do it|let's do it|sounds good|go ahead|book it|schedule it|set it up|do it|im down|i'm down|im in|i'm in|lets go|let's go|sure thing|sounds great|sounds perfect|that works|works for me|go for it|lock it in)\b/i.test(lower)
  const isNo = /^(no|nah|nope|pass|never mind|not now|not interested)\b/i.test(lower) || /\b(too much|too expensive|way too much|too high|cant afford|can't afford|out of my budget|too pricey|hard pass|no way|no thanks|no thank you|nah im good|nah i'm good|not right now|maybe later|ill pass|i'll pass)\b/i.test(lower)
  // Must be an actual cancellation REQUEST, not a question about cancellation policy
  const isCancel = /\b(i want to cancel|cancel (my|the|this) (order|delivery)|please cancel|need to cancel|cancel it|refund|money back|want my money)\b/i.test(lower)
  const isStatus = /\b(status|tracking|eta|update)\b|where.*(my|is my|the).*(order|delivery|driver|truck)|when.*(my|is my|the).*(order|delivery|driver|truck|arriving|coming|getting here)|how long.*(until|till|before|for)|any.*(update|news|word)|what.*(happening|going on).*order|check.*(on|my).*(order|delivery)/i.test(lower)
  // Must clearly indicate they made a payment, not just casual "done" or "sent" in other context
  const isPaymentConfirm = /\b(just sent|payment sent|i sent it|i paid|just paid|i transferred|just transferred|sent the payment|sent it|paid it|payment done|its paid|it's paid|sent the money|money sent|sent via|paid via)\b/i.test(lower)

  // Determine what info is missing
  const has = (v: any) => v !== null && v !== undefined && v !== ""
  // Detect correction language — customer wants to change previously given info
  // "actually" alone is too common in casual speech ("I actually need fill dirt") — require it with correction context
  const isCorrection = /\b(wrong|change it|correction|not that|meant to say|instead of|I meant|should be|typo|oops|mistake|scratch that|wait no|no wait|let me fix|hold on|my bad)\b/i.test(lower) || (/\bactually\b/i.test(lower) && /\b(it's|its|should|is|was|meant|wrong|not|change|different)\b/i.test(lower))
  const needName = !has(conv.customer_name) || (isCorrection && /\b(name|call me|im actually|i'm actually)\b/i.test(lower))
  const needAddress = !has(conv.delivery_address) || (isCorrection && isAddress)
  const needPurpose = !has(conv.material_purpose)
  const needMaterial = !has(conv.material_type) || (isCorrection && inlineMaterial != null)
  const needYards = !has(conv.yards_needed) || (isCorrection && inlineYards != null)
  const needAccess = !has(conv.access_type)
  const needDate = !has(conv.delivery_date) || (isCorrection && inlineDate != null)
  const needEmail = !has(conv.customer_email)
  const needPayment = !has(conv.payment_method)
  const hasQuote = has(conv.total_price_cents)
  const hasOrder = has(conv.dispatch_order_id)

  // ── HANDLE SPECIAL STATES FIRST ──

  // Cancel request — any state
  if (isCancel) {
    await notifyAdmin(`Customer ${conv.customer_name || phone} requesting cancellation | State: ${state} | Order: ${conv.dispatch_order_id || "none"}`, sid)
    updates.state = "CLOSED"
    const s = await callSarah(body, conv, history, "Customer wants to cancel. Say you'll have someone from the team reach out to help with that. Be empathetic but dont push")
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates }, readAt)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // Order status — any state with an order
  if (isStatus && hasOrder) {
    const sb = createAdminSupabase()
    const { data: order } = await sb.from("dispatch_orders").select("status, drivers_notified, created_at").eq("id", conv.dispatch_order_id).maybeSingle()
    const orderStatus = order?.status || "open"
    const driversNotified = order?.drivers_notified || 0
    const isPriority = conv.order_type === "priority"
    const daysSinceOrder = order?.created_at ? Math.round((Date.now() - new Date(order.created_at).getTime()) / (1000*60*60*24)) : 0
    let statusInstruction = ""
    if (orderStatus === "completed") {
      statusInstruction = "Tell customer their delivery has been completed. Ask if everything looks good"
    } else if (orderStatus === "active") {
      statusInstruction = "Tell customer their driver has been assigned and they'll get a text when they're heading out"
    } else if (isPriority) {
      statusInstruction = `Their priority order is confirmed for ${conv.priority_guaranteed_date || "their requested date"}. They'll get a text when their driver is heading their way`
    } else if (driversNotified > 0 && daysSinceOrder <= 2) {
      statusInstruction = "Their order is in the system and we've reached out to drivers in their area. They'll get a text as soon as a driver is heading their way. Standard delivery is 3-5 business days"
    } else if (driversNotified === 0 || daysSinceOrder > 2) {
      // Honest: no drivers in the area yet
      statusInstruction = "Be honest with the customer. We don't have drivers hauling in their area right now, but as soon as we do they'll be the first to know. We appreciate their patience and we're actively working on getting coverage out there. If their timeline is urgent, let them know about our priority delivery option which sources material from a local quarry with a guaranteed date"
    } else {
      statusInstruction = "Their order is confirmed and we're working on scheduling. They'll get a text when their driver is heading their way"
    }
    const s = await callSarah(body, conv, history, statusInstruction)
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates }, readAt)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // Status request but no order
  if (isStatus && !hasOrder) {
    const s = await callSarah(body, conv, history, "Customer asking about an order but they don't have one yet. We're not currently hauling in their area but as soon as we are they'll be the first to know. If they want to place an order, help them get started")
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates }, readAt)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // Follow-up return
  if (state === "FOLLOW_UP" && !isFollowUp) {
    const firstName = (conv.customer_name || "").split(/\s+/)[0] || ""
    const instruction = hasQuote
      ? `${firstName} is back after saying they'd think about it. Their quote was ${fmt$(conv.total_price_cents)} for ${conv.yards_needed} yards of ${fmtMaterial(conv.material_type||"")} to ${conv.delivery_city}. Welcome them back warmly and ask if they're ready to move forward`
      : `${firstName} is back. Welcome them warmly and pick up where you left off. Figure out what they still need`
    const s = await callSarah(body, conv, history, instruction)
    updates.state = hasQuote ? "QUOTING" : needAddress ? "COLLECTING" : "COLLECTING"
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates }, readAt)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── POST-DELIVERY PAYMENT COLLECTION ──
  if (state === "AWAITING_PAYMENT") {
    if (isPaymentConfirm) {
      updates.payment_status = "confirming"
      updates.state = "DELIVERED"
      const s = await callSarah(body, conv, history, `Payment confirmed. Thank them and let them know we appreciate their business. If they ever need more material, just text us`)
      reply = validate(s.response, lastOut)
      await notifyAdmin(`PAYMENT CONFIRMED: ${conv.customer_name} | ${fmt$(conv.total_price_cents||0)} | ${conv.payment_method}`, sid)
      // Notify sales agent
      const payAgent = agent || (conv.agent_id ? (await loadAgents()).find(a => a.id === conv.agent_id) : null)
      if (payAgent) await notifyAgent(payAgent, `Payment confirmed: ${conv.customer_name} | ${fmt$(conv.total_price_cents||0)} | ${conv.payment_method || "unknown method"}`, sid)
      await saveConv(phone, { ...conv, ...updates }, readAt)
      await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
    }
    if (/zelle/i.test(lower)) {
      updates.payment_method = "zelle"
      const total = fmt$(conv.total_price_cents || 0)
      const s = await callSarah(body, conv, history, `They chose Zelle. Tell them to send ${total} to support@filldirtnearme.net via Zelle. Once sent, text you back`)
      reply = validate(s.response, lastOut)
      await saveConv(phone, { ...conv, ...updates }, readAt)
      await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
    }
    if (/venmo/i.test(lower)) {
      updates.payment_method = "venmo"
      const total = fmt$(conv.total_price_cents || 0)
      const s = await callSarah(body, conv, history, `They chose Venmo. Tell them to send ${total} to @FillDirtNearMe on Venmo. Once sent, text you back`)
      reply = validate(s.response, lastOut)
      await saveConv(phone, { ...conv, ...updates }, readAt)
      await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
    }
    if (/invoice|card|credit|debit|online/i.test(lower)) {
      updates.payment_method = "invoice"
      if (has(conv.customer_email)) {
        // Already have email — send invoice
        const s = await callSarah(body, conv, history, `They chose card. Let them know we'll send the invoice to ${conv.customer_email}. There's a 3.5% processing fee for card payments. Once they pay, text you back`)
        reply = validate(s.response, lastOut)
        await notifyAdmin(`INVOICE NEEDED: ${conv.customer_name} | ${conv.customer_email} | ${fmt$(conv.total_price_cents||0)}`, sid)
      } else {
        // Need email first
        updates.state = "ASKING_EMAIL"
        const s = await callSarah(body, conv, history, `They want to pay by card. There's a 3.5% processing fee. Ask for their email so you can send the invoice`)
        reply = validate(s.response, lastOut)
      }
      await saveConv(phone, { ...conv, ...updates }, readAt)
      await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
    }
    if (/cash|check|cheque/i.test(lower)) {
      const s = await callSarah(body, conv, history, "They want cash or check. Explain we cant accept those, our drivers are independently insured contractors so for liability reasons we can only do Venmo, Zelle, or online invoice (card with 3.5% fee). Ask which works")
      reply = validate(s.response, lastOut)
      await saveConv(phone, { ...conv, ...updates }, readAt)
      await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
    }
    // General question while waiting for payment
    const s = await callSarah(body, conv, history, `Delivery is complete, waiting on payment of ${fmt$(conv.total_price_cents||0)}. Answer their question, then remind them we accept Venmo, Zelle, or online invoice (card with 3.5% fee). Which works for them`)
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates }, readAt)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── AWAITING PRIORITY PAYMENT — Stripe link sent, waiting for payment ──
  if (state === "AWAITING_PRIORITY_PAYMENT") {
    if (isPaymentConfirm) {
      // Customer says they paid — verify with Stripe
      if (conv.stripe_session_id) {
        const { paid, paymentIntentId } = await checkPaymentStatus(conv.stripe_session_id)
        if (paid) {
          updates.state = "ORDER_PLACED"
          updates.payment_status = "paid"
          updates.payment_method = "stripe"
          await savePriorityFields(phone, { stripe_payment_intent_id: paymentIntentId || null })
          const orderId = await createDispatchOrder({ ...conv, ...updates, total_price_cents: conv.priority_total_cents }, phone)
          if (orderId) {
            updates.dispatch_order_id = orderId
            await notifyAdmin(`PRIORITY PAID: ${conv.customer_name} | ${fmt$(conv.priority_total_cents||0)} | ${conv.yards_needed}yds ${fmtMaterial(conv.material_type||"fill_dirt")} | ${conv.delivery_city} | Guaranteed ${conv.priority_guaranteed_date}`, sid)
            // Notify sales agent
            const prioAgent = agent || (conv.agent_id ? (await loadAgents()).find(a => a.id === conv.agent_id) : null)
            if (prioAgent) await notifyAgent(prioAgent, `Priority order PAID: ${conv.customer_name} | ${fmt$(conv.priority_total_cents||0)} | ${conv.yards_needed}yds ${fmtMaterial(conv.material_type||"fill_dirt")} to ${conv.delivery_city} | Guaranteed ${conv.priority_guaranteed_date}`, sid)
          }
          const s = await callSarah(body, conv, history, `Payment confirmed. Tell them their priority delivery is locked in for ${conv.priority_guaranteed_date}. They'll get a text when their driver is heading their way`)
          reply = validate(s.response, lastOut)
        } else {
          const s = await callSarah(body, conv, history, `Customer says they paid but we haven't received it yet. Ask them to double check that the payment went through on their end. If they're having trouble, they can text back and you'll help sort it out`)
          reply = validate(s.response, lastOut)
        }
      } else {
        const s = await callSarah(body, conv, history, "Customer says they paid but we can't verify right now. Let them know you'll have someone check on it and get back to them shortly")
        reply = validate(s.response, lastOut)
        await notifyAdmin(`Customer ${conv.customer_name} (${phone}) says they paid for priority order but no stripe_session_id — check manually`, sid)
      }
    } else if (/link|url|pay|how|where/i.test(lower)) {
      // Customer asking about payment link — resend it
      if (conv.stripe_session_id) {
        // Can't retrieve URL from session — create a new one
        const yards = conv.yards_needed || MIN_YARDS
        const material = fmtMaterial(conv.material_type || "fill_dirt")
        const checkout = await createCustomerPaymentCheckout({
          phone,
          customerName: conv.customer_name || "Customer",
          amountCents: conv.priority_total_cents || 0,
          description: `${yards} yards ${material} - guaranteed ${conv.priority_guaranteed_date}`,
          guaranteedDate: conv.priority_guaranteed_date || "",
        })
        if (checkout.success && checkout.url) {
          updates.stripe_session_id = checkout.sessionId
          await savePriorityFields(phone, { stripe_session_id: checkout.sessionId })
          const s = await callSarah(body, conv, history, `Customer needs the payment link again. Here it is: ${checkout.url} — work it into the message naturally`)
          reply = validate(s.response, lastOut)
        } else {
          const s = await callSarah(body, conv, history, "Having trouble generating the payment link. Tell them you'll have someone from the team reach out to help")
          reply = validate(s.response, lastOut)
          await notifyAdmin(`STRIPE LINK RESEND FAILED for ${conv.customer_name} (${phone}) — needs manual handling`, sid)
        }
      } else {
        const s = await callSarah(body, conv, history, "Tell them you'll send the payment link again shortly. Something on your end")
        reply = validate(s.response, lastOut)
        await notifyAdmin(`Customer ${conv.customer_name} (${phone}) needs priority payment link but no session stored — manual handling needed`, sid)
      }
    } else {
      // General question while waiting for payment
      const s = await callSarah(body, conv, history, `Customer has a priority order pending payment of ${fmt$(conv.priority_total_cents||0)} for ${conv.yards_needed} yards of ${fmtMaterial(conv.material_type||"")} guaranteed by ${conv.priority_guaranteed_date}. Answer their question, then remind them to complete payment to lock in their delivery date`)
      reply = validate(s.response, lastOut)
    }
    await saveConv(phone, { ...conv, ...updates }, readAt)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── CLOSED — customer cancelled or completed. Let them restart fresh. ──
  if (state === "CLOSED") {
    const s = await callSarah(body, conv, history, "This customer had a previous order that's now closed. If they want to place a new order, help them get started fresh. Ask what they need")
    // Clear old order data so they can start over — keep name and phone only
    updates.state = "COLLECTING"
    updates.delivery_address = ""
    updates.delivery_city = ""
    updates.delivery_lat = 0
    updates.delivery_lng = 0
    updates.material_purpose = ""
    updates.material_type = ""
    updates.yards_needed = 0
    updates.dimensions_raw = ""
    updates.access_type = ""
    updates.delivery_date = ""
    updates.zone = ""
    updates.distance_miles = 0
    updates.price_per_yard_cents = 0
    updates.total_price_cents = 0
    updates.payment_method = ""
    updates.payment_status = "pending"
    updates.dispatch_order_id = ""
    updates.follow_up_at = ""
    updates.follow_up_count = 0
    reply = validate(s.response, lastOut)
    // Direct update to force-clear fields (COALESCE won't clear nulls)
    await createAdminSupabase().from("customer_conversations").update({
      state: "COLLECTING", delivery_address: null, delivery_city: null,
      delivery_lat: null, delivery_lng: null, material_purpose: null,
      material_type: null, yards_needed: null, dimensions_raw: null,
      access_type: null, delivery_date: null, zone: null, distance_miles: null,
      price_per_yard_cents: null, total_price_cents: null, payment_method: null,
      payment_status: "pending", dispatch_order_id: null, follow_up_at: null,
      follow_up_count: 0, order_type: null, priority_total_cents: null,
      priority_guaranteed_date: null, priority_quarry_name: null,
      stripe_session_id: null, stripe_payment_intent_id: null,
    }).eq("phone", phone)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── ACTIVE ORDER — waiting for delivery ──
  if (state === "ORDER_PLACED") {
    // Check actual dispatch status so Sarah doesn't lie about driver availability
    let orderContext = "Customer has a confirmed order."
    if (has(conv.dispatch_order_id)) {
      const sb_order = createAdminSupabase()
      const { data: order } = await sb_order.from("dispatch_orders").select("status, drivers_notified, created_at").eq("id", conv.dispatch_order_id).maybeSingle()
      const driversNotified = order?.drivers_notified || 0
      const daysSince = order?.created_at ? Math.round((Date.now() - new Date(order.created_at).getTime()) / (1000*60*60*24)) : 0
      const isPriority = conv.order_type === "priority"
      if (order?.status === "active") {
        orderContext = "Their driver has been assigned. They'll get a text when their driver is heading out"
      } else if (isPriority) {
        orderContext = `Their priority delivery is confirmed for ${conv.priority_guaranteed_date || "their requested date"}. They'll get a text when their driver is heading their way`
      } else if (driversNotified > 0 && daysSince <= 2) {
        orderContext = "Their order is in and we've reached out to drivers in their area. Standard delivery is 3-5 business days. They'll get a text when a driver is heading their way"
      } else {
        orderContext = "Be honest, we don't have drivers hauling in their area right now. As soon as we do they'll be the first to know. We appreciate their patience. If their timeline is urgent they can ask about priority delivery"
      }
    }
    const s = await callSarah(body, conv, history, `${orderContext} Answer their question helpfully. If they want to cancel, say you'll have someone reach out`)
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates }, readAt)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── DELIVERED — delivery done, payment confirmed ──
  if (state === "DELIVERED") {
    // Check if they want a new order (any material/project/yard language)
    const wantsNewOrder = /\b(more|another|new order|need dirt|need fill|need topsoil|need sand|delivery|another load|order again|same thing|same order|reorder)\b/i.test(lower) || inlineMaterial || inlineYards || isAddress
    if (wantsNewOrder) {
      // Start fresh order — clear old data, keep name
      const s = await callSarah(body, conv, history, `Returning customer wants to place a new order. Welcome them back, acknowledge what they said, and ask what they need. They already know the process so keep it efficient`)
      reply = validate(s.response, lastOut)
      await createAdminSupabase().from("customer_conversations").update({
        state: "COLLECTING", delivery_address: null, delivery_city: null,
        delivery_lat: null, delivery_lng: null, material_purpose: null,
        material_type: null, yards_needed: null, dimensions_raw: null,
        access_type: null, delivery_date: null, zone: null, distance_miles: null,
        price_per_yard_cents: null, total_price_cents: null, payment_method: null,
        payment_status: "pending", dispatch_order_id: null, follow_up_at: null,
        follow_up_count: 0, order_type: null, priority_total_cents: null,
        priority_guaranteed_date: null, priority_quarry_name: null,
        stripe_session_id: null, stripe_payment_intent_id: null,
      }).eq("phone", phone)
      await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
    }
    const s = await callSarah(body, conv, history, "This customer's delivery has been completed and payment was received. Answer their question. If they need more material, tell them to just let you know and you'll get them set up. If they have an issue with the delivery, say you'll have someone from the team reach out")
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates }, readAt)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── QUOTING — we gave a price, waiting for yes/no ──
  if (state === "QUOTING") {
    // Detect if customer picked priority or standard
    const isPriority = /priority|option 2|guaranteed|lock.?in|specific date|quarry/i.test(lower)
    const isStandard = /standard|option 1|regular|3.?5\s*(day|business)|flexible|cheaper|first/i.test(lower)
    const hasPriorityQuote = has(conv.priority_total_cents)

    if (isYes || isPriority || isStandard) {
      // Customer wants to move forward — determine which option
      const wantsPriority = isPriority && !isStandard
      const wantsStandard = isStandard && !isPriority
      const ambiguousYes = isYes && !isPriority && !isStandard && hasPriorityQuote

      if (ambiguousYes) {
        // Dual quote was shown but they just said "yes" — need to clarify
        const s = await callSarah(body, conv, history, `Customer said yes but we gave them two options. Ask which one they want: standard delivery at ${fmt$(conv.total_price_cents||0)} (3-5 business days) or priority at ${fmt$(conv.priority_total_cents)} (guaranteed by ${conv.priority_guaranteed_date}). Keep it casual, just ask which works better`)
        reply = validate(s.response, lastOut)
      } else if (wantsPriority && hasPriorityQuote) {
        // PRIORITY — charge upfront via Stripe before dispatching
        updates.order_type = "priority"
        updates.total_price_cents = conv.priority_total_cents
        const yards = conv.yards_needed || MIN_YARDS
        const material = fmtMaterial(conv.material_type || "fill_dirt")
        const description = `${yards} yards ${material} - guaranteed ${conv.priority_guaranteed_date}`

        const checkout = await createCustomerPaymentCheckout({
          phone,
          customerName: conv.customer_name || "Customer",
          amountCents: conv.priority_total_cents,
          description,
          guaranteedDate: conv.priority_guaranteed_date || "",
        })

        if (checkout.success && checkout.url) {
          updates.state = "AWAITING_PRIORITY_PAYMENT"
          updates.stripe_session_id = checkout.sessionId
          await savePriorityFields(phone, {
            order_type: "priority",
            stripe_session_id: checkout.sessionId,
          })
          const s = await callSarah(body, conv, history, `Customer chose priority. Tell them to lock in their guaranteed delivery for ${conv.priority_guaranteed_date}, just complete payment at this link: ${checkout.url} — once that goes through you'll get their driver scheduled right away. Keep it natural, dont say "click here" just work the link into the message`)
          reply = validate(s.response, lastOut)
          await notifyAdmin(`PRIORITY ORDER PENDING PAYMENT: ${conv.customer_name} | ${fmt$(conv.priority_total_cents)} | ${yards}yds ${material} | ${conv.delivery_city} | Guaranteed ${conv.priority_guaranteed_date}`, sid)
          // Notify sales agent about incoming priority order
          const prioOrderAgent = agent || (conv.agent_id ? (await loadAgents()).find(a => a.id === conv.agent_id) : null)
          if (prioOrderAgent) await notifyAgent(prioOrderAgent, `Priority order pending payment: ${conv.customer_name} | ${fmt$(conv.priority_total_cents)} | ${yards}yds ${material} to ${conv.delivery_city} | Awaiting Stripe payment`, sid)
        } else {
          // Stripe failed — fall back to manual handling
          const s = await callSarah(body, conv, history, "Tell the customer you're having a small issue getting the payment link set up. You'll have someone from the team text them shortly to get it sorted out")
          reply = validate(s.response, lastOut)
          await notifyAdmin(`STRIPE CHECKOUT FAILED for ${conv.customer_name} (${phone}) — priority order ${fmt$(conv.priority_total_cents)} needs manual handling. Error: ${checkout.error}`, sid)
        }
      } else {
        // STANDARD — existing flow, pay after delivery
        updates.order_type = "standard"
        await savePriorityFields(phone, { order_type: "standard" })
        const orderId = await createDispatchOrder({ ...conv, ...updates }, phone)
        if (orderId) {
          updates.state = "ORDER_PLACED"
          updates.dispatch_order_id = orderId
          const yards = conv.yards_needed || MIN_YARDS
          await notifyAdmin(`New order: ${conv.customer_name} | ${yards}yds ${fmtMaterial(conv.material_type||"fill_dirt")} | ${conv.delivery_city} | ${fmt$(conv.total_price_cents||0)}`, sid)
          if (yards >= LARGE_ORDER) await notifyAdmin(`LARGE ORDER ${yards}yds — ${conv.customer_name} ${conv.delivery_city}`, sid)
          // Notify sales agent
          const orderAgent = agent || (conv.agent_id ? (await loadAgents()).find(a => a.id === conv.agent_id) : null)
          if (orderAgent) await notifyAgent(orderAgent, `New order received: ${conv.customer_name} | ${yards}yds ${fmtMaterial(conv.material_type||"fill_dirt")} to ${conv.delivery_city} | ${fmt$(conv.total_price_cents||0)}`, sid)
          const s = await callSarah(body, conv, history, `Customer chose standard delivery. Tell them their delivery is confirmed for ${conv.delivery_date || "the schedule"}. They'll get a text when their driver is heading their way. Mention that payment is collected after delivery, we accept Venmo, Zelle, or online invoice (card has a 3.5% fee). Keep it casual, dont send actual account info yet`)
          reply = validate(s.response, lastOut)
        } else {
          // Dispatch failed — DO NOT tell customer it's confirmed
          updates.state = "QUOTING" // Stay in QUOTING so they can retry
          await notifyAdmin(`DISPATCH FAILED for ${conv.customer_name} (${phone}) | ${conv.yards_needed}yds to ${conv.delivery_city} | Customer was NOT told order is confirmed. Needs manual dispatch.`, sid)
          const s = await callSarah(body, conv, history, "Tell the customer you're working on getting their delivery set up. Ask them to give you just a few minutes while you confirm the details on your end")
          reply = validate(s.response, lastOut)
        }
      }
    } else if (isNo) {
      updates.state = "FOLLOW_UP"
      updates.follow_up_at = new Date(Date.now() + 48*60*60*1000).toISOString()
      updates.follow_up_count = 0
      const s = await callSarah(body, conv, history, "Customer said no to the quote. Be understanding, no pressure. Tell them to text back anytime if they change their mind or want to adjust anything")
      reply = validate(s.response, lastOut)
    } else if (isFollowUp) {
      updates.state = "FOLLOW_UP"
      updates.follow_up_at = new Date(Date.now() + 24*60*60*1000).toISOString()
      updates.follow_up_count = 0
      const s = await callSarah(body, conv, history, "Customer wants to think about it. Be totally cool with that. Tell them you'll check back tomorrow and they can text anytime")
      reply = validate(s.response, lastOut)
    } else {
      // Question about the quote, negotiation, etc
      const s = await callSarah(body, conv, history, `Customer was quoted ${fmt$(conv.total_price_cents||0)} for ${conv.yards_needed} yards of ${fmtMaterial(conv.material_type||"")}. They said something other than yes/no. Answer their question or concern, then ask if they'd like to move forward`)
      reply = validate(s.response, lastOut)
    }
    await saveConv(phone, { ...conv, ...updates }, readAt)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── EMAIL COLLECTION (for invoice payments post-delivery) ──
  if (state === "ASKING_EMAIL") {
    const email = inlineEmail || extractEmail(body)
    if (email) {
      updates.customer_email = email
      updates.state = "AWAITING_PAYMENT"
      const s = await callSarah(body, conv, history, "Got their email. Let them know we'll send the invoice shortly. Thank them")
      reply = validate(s.response, lastOut)
      await notifyAdmin(`INVOICE NEEDED: ${conv.customer_name} | ${email} | ${fmt$(conv.total_price_cents||0)}`, sid)
    } else {
      const s = await callSarah(body, conv, history, "Need their email to send the invoice. They didn't give a valid email. Ask again naturally")
      reply = validate(s.response, lastOut)
    }
    await saveConv(phone, { ...conv, ...updates }, readAt)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ═══════════════════════════════════════════════════════
  // MAIN QUALIFICATION FLOW — collect info conversationally
  // ═══════════════════════════════════════════════════════

  // ── NEW CUSTOMER ──
  if (state === "NEW") {
    updates.state = "COLLECTING"
    // Extract anything useful from their first message before responding
    // so Sarah doesn't ask for info they already gave
    const firstMsgParts: string[] = []
    if (inlineYards) { updates.yards_needed = inlineYards; firstMsgParts.push(`${inlineYards} yards`) }
    if (inlineMaterial) { updates.material_type = inlineMaterial.key; updates.material_purpose = body.trim(); firstMsgParts.push(inlineMaterial.name) }
    if (isAddress) {
      const geo = await geocode(body)
      if (geo) {
        updates.delivery_address = body.trim(); updates.delivery_city = geo.city
        updates.delivery_lat = geo.lat; updates.delivery_lng = geo.lng
        const nearest = nearestYard(geo.lat, geo.lng)
        updates.distance_miles = nearest.miles
        updates.zone = ZONES.find(z => nearest.miles >= z.min && (nearest.miles < z.max || (z.zone === "C" && nearest.miles <= z.max)))?.zone || null
        firstMsgParts.push(`address: ${body.trim()}`)
      }
    }
    // Check if they included a name-like phrase
    // Patterns: "I'm Mike", "this is José", "John from fb", "Its John", "John here", "Hey John here"
    const nameMatch = body.match(/(?:i'm|im|i am|this is|it's|its|my name is|name's|names|me llamo|soy|hey)\s+([\p{L}][\p{L}]+(?:\s+[\p{L}][\p{L}]+)?)/iu)
      || body.match(/^([\p{L}][\p{L}]+)\s+(?:from|here|checking|looking|interested|wanting|needing|inquiring|texting|calling)\b/iu)
    if (nameMatch) {
      const extractedName = nameMatch[1].trim()
      // Make sure extracted name isn't a common non-name word
      const NAME_BLOCKLIST = /^(hey|hi|hello|good|this|that|just|still|also|really|very|much|some|more|been|your|have|need|want|fill|dirt|sand|topsoil|clean|cheap|free|best|nice|great)$/i
      if (!NAME_BLOCKLIST.test(extractedName)) {
        updates.customer_name = extractedName
        firstMsgParts.push(`name: ${extractedName}`)
      }
    }

    const merged = { ...conv, ...updates }
    const mHas = (k: string) => { const v = (merged as any)[k]; return v !== null && v !== undefined && v !== "" }
    let newInstruction = ""
    // Agent numbers: customer came from an ad, was told "text me" — DON'T introduce as Sarah or mention company name
    // Default number: no agent context — introduce as Sarah with Fill Dirt Near Me
    const isAgentLead = agent !== null
    const intro = isAgentLead
      ? "Hey, respond casually like you're picking up where the ad left off. Do NOT introduce yourself by name. Do NOT say any company name. Just jump right in like you're the person they expect to talk to."
      : "Say hey this is Sarah with Fill Dirt Near Me."
    if (firstMsgParts.length > 0) {
      // They gave us info — acknowledge it and ask for the NEXT missing thing
      const nextMissing = !mHas("customer_name") ? "ask their name" : !mHas("delivery_address") ? "ask for the delivery address" : !mHas("material_purpose") ? "ask what the dirt is for" : !mHas("yards_needed") ? "ask how many cubic yards" : "ask if big trucks can get to their property"
      newInstruction = `New customer texted. ${intro} They already told you: ${firstMsgParts.join(", ")}. Acknowledge what they shared, then ${nextMissing}. One short message`
    } else {
      newInstruction = `New customer just texted. ${intro} Ask what their name is. One short message, nothing else. Do NOT apologize, do NOT use dashes, do NOT use exclamation marks`
    }
    const s = await callSarah(body, merged, history, newInstruction)
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates }, readAt)
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── COLLECTING — the main qualification state ──
  // Code figures out what's missing, extracts data, gives Sonnet instructions

  // Try to extract data from whatever they said
  // Name extraction — ONLY save if it actually looks like a name
  const NOT_A_NAME = /^(hey|hi|hello|yo|sup|whats up|what up|howdy|hola|good morning|good afternoon|good evening|morning|afternoon|evening|yes|yeah|yep|yea|no|nah|nope|ok|okay|sure|thanks|thank you|please|help|info|information|quote|price|pricing|how much|what|when|where|why|how|can you|do you|is this|are you|i need|i want|i'm looking|looking for|need|want|got|have|dirt|fill|topsoil|sand|gravel|delivery|deliver|dump|truck|yard|yards|cubic|material|project|estimate|cost|cheap|affordable|available|asap|urgent|ready|interested|question|stop|start|reset|menu|sounds good|sounds great|yes please|go ahead|book it|set it up|do it|im down|im in|lets do it|perfect|absolutely|definitely|for sure|right|correct|cancel|never mind|too much|expensive|not now|done|sent|paid|.)$/i
  if (needName && body.trim().length > 1 && body.trim().length < 40 && !isAddress && !/\d{3}/.test(body) && !NOT_A_NAME.test(body.trim()) && !inlineMaterial && !isFollowUp && !isYes && !isNo && !isCancel && !isStatus && !isPaymentConfirm && !inlineAccess && !inlineDate) {
    const trimmed = body.trim()
    const words = trimmed.split(/\s+/)
    // Accept lowercase single names (most people text lowercase)
    // But filter out common non-name words
    // Filter common English words BUT allow real names that overlap (will, art, grace, may, mark, etc.)
    const COMMON_NON_NAMES = /^(the|a|an|is|it|at|in|on|to|so|or|do|go|and|but|for|not|just|also|too|very|all|any|some|my|our|this|that|its|get|got|can|has|had|was|are|been|have|from|with|they|them|what|when|how|who|which|where|here|there|then|than|more|much|many|most|other|only|still|even|well|back|over|such|after|into|made|like|long|out|way|day|each|new|now|old|see|let|say|own|why|try)$/i
    const hasLetters = /[a-zA-ZÀ-ÿ]/.test(trimmed) // Must contain at least one letter (blocks emoji-only)
    const isLikelyName = hasLetters && words.length <= 3 && words[0].length >= 2 && !COMMON_NON_NAMES.test(words[0]) && !/\b(dirt|fill|sand|topsoil|gravel|delivery|truck|dump|yard|slab|pool|concrete|driveway|garden|level|grade|material|project|quote|price|checking|update|status|estimate|question|interested|waiting|nothing|something|everything|anything|hello|thanks|cool|great|awesome|sweet|nice|fine|good|bad|maybe|probably|already|next|last|first|just|another)\b/i.test(trimmed)
    if (isLikelyName) {
      updates.customer_name = trimmed
    }
  }

  // Address extraction — require actual street address, not just a zip code
  // Allow re-entry if: no address yet, existing address has no zone, or customer is correcting
  const isBareZip = /^\d{5}(-\d{4})?$/.test(body.trim())
  const addressOutOfZone = has(conv.delivery_address) && !has(conv.zone)
  if (isAddress && (needAddress || addressOutOfZone) && !isBareZip) {
    const geo = await geocode(body)
    if (geo) {
      updates.delivery_address = body.trim()
      updates.delivery_city = geo.city
      updates.delivery_lat = geo.lat
      updates.delivery_lng = geo.lng
      const nearest = nearestYard(geo.lat, geo.lng)
      updates.distance_miles = nearest.miles
      const zone = ZONES.find(z => nearest.miles >= z.min && (nearest.miles < z.max || (z.zone === "C" && nearest.miles <= z.max)))
      updates.zone = zone?.zone || null
      if (!zone) {
        // Address geocoded but outside 60 miles — notify admin in case geocode was wrong
        await notifyAdmin(`Customer ${conv.customer_name || phone} address "${body.trim()}" geocoded to ${geo.lat},${geo.lng} (${geo.city}) — ${nearest.miles}mi from nearest yard, outside all zones. Verify this is correct.`, `zone_miss_${Date.now()}`)
      }
    } else {
      // Geocode completely failed — save the address text so we don't lose it, alert admin
      updates.delivery_address = body.trim()
      console.error("[customer geocode] FAILED for:", body.trim())
      await notifyAdmin(`GEOCODE FAILED for customer ${conv.customer_name || phone} address: "${body.trim()}". Address saved but no coords. May need manual zone assignment.`, `geocode_fail_${Date.now()}`)
    }
  }

  if (inlineYards && needYards) {
    updates.yards_needed = inlineYards
  }

  if (inlineDims && needYards) {
    const d = depthToFeet(inlineDims.d, body)
    const yards = cubicYards(inlineDims.l, inlineDims.w, d)
    updates.yards_needed = yards
    updates.dimensions_raw = body.trim()
  }

  if (inlineMaterial && needMaterial) {
    updates.material_type = inlineMaterial.key
    updates.material_purpose = body.trim()
  }

  if (inlineAccess && needAccess) {
    updates.access_type = inlineAccess
  }

  if (inlineDate && needDate) {
    updates.delivery_date = inlineDate
  }

  if (inlineEmail) {
    updates.customer_email = inlineEmail
  }

  // If a correction changed pricing-relevant fields, invalidate the old quote
  if (isCorrection && (updates.yards_needed || updates.material_type || updates.delivery_address)) {
    if (has(conv.total_price_cents)) {
      updates.total_price_cents = null as any
      updates.price_per_yard_cents = null as any
      updates.state = "COLLECTING" // Re-collect to regenerate quote
    }
  }

  // Merge updates to figure out current state
  const merged = { ...conv, ...updates }
  const mHas = (k: string) => { const v = (merged as any)[k]; return v !== null && v !== undefined && v !== "" }

  // Determine next instruction for Sonnet
  let instruction = ""

  if (!mHas("customer_name")) {
    instruction = "You still need their name. Ask naturally, like 'and whats your name' or 'what was your name'. If they told you about their project, acknowledge it briefly first then ask their name. Do NOT re-introduce yourself"
  } else if (!mHas("delivery_address")) {
    instruction = `Ask ${(merged.customer_name||"").split(/\s+/)[0]} for the delivery address. Explain you need it to give an accurate quote based on their location`
  } else if (!mHas("material_purpose")) {
    instruction = "Ask what they're using the material for. Explain this helps you recommend the right type of dirt for their project. Be genuinely curious about their project"
  } else if (!mHas("material_type")) {
    // Purpose given but material not auto-detected
    // Check if customer is CONFIRMING a material Sarah already recommended in the last message
    const isConfirm = isYes || /\b(that works|that sounds|sounds right|sounds good|go with that|that one|the one you said|what you said|recommended|yeah that|sure that|ok that|perfect|exactly)\b/i.test(lower)
    if (isConfirm && lastOut) {
      // Extract what material Sarah recommended from her last message
      const lastMaterial = extractMaterialFromPurpose(lastOut)
      if (lastMaterial) {
        updates.material_type = lastMaterial.key
        instruction = `They confirmed ${lastMaterial.name}. Now ask how many cubic yards they need. If they're not sure, you can help calculate from dimensions`
      } else {
        instruction = `Customer said they need dirt for: "${merged.material_purpose}". Based on your knowledge, recommend the right material type (fill dirt, structural fill, screened topsoil, or sand). Explain briefly why that material is right for their project. Then ask how many cubic yards they need, and offer to help calculate if they're not sure`
      }
    } else {
      instruction = `Customer said they need dirt for: "${merged.material_purpose}". Based on your knowledge, recommend the right material type (fill dirt, structural fill, screened topsoil, or sand). Explain briefly why that material is right for their project. Then ask how many cubic yards they need, and offer to help calculate if they're not sure`
    }
  } else if (!mHas("yards_needed")) {
    // Detect if they gave partial dimensions (e.g. "40 x 40" — 2 numbers, missing depth)
    const hasPartialDims = /\d+\s*[x×]\s*\d+/i.test(body) || /\d+\s*by\s*\d+/i.test(body) || /\d+\s*ft?\s*[x×]\s*\d+/i.test(body)
    const nums = body.match(/(\d+\.?\d*)/g)
    if (hasPartialDims && nums && nums.length === 2) {
      // They gave length x width but no depth — ask for depth, we'll calculate
      updates.state = "ASKING_DIMENSIONS"
      instruction = `Customer gave ${nums[0]} x ${nums[1]} but we need the depth too. Ask how deep/thick they need it in feet or inches. For a slab its usually 4-6 inches. Be helpful`
    } else if (hasPartialDims && nums && nums.length >= 3) {
      // They gave all 3 — calculate (convert depth to feet)
      const d = depthToFeet(parseFloat(nums[2]), body)
      const yards = cubicYards(parseFloat(nums[0]), parseFloat(nums[1]), d)
      updates.yards_needed = yards
      updates.dimensions_raw = body.trim()
      instruction = `That comes out to about ${yards} cubic yards. Now ask real quick, can an 18-wheeler get to their property or should we use standard dump trucks`
    } else if (/don.?t know|not sure|no idea|how much|figure|calculate|dimensions|measure/i.test(lower)) {
      instruction = "Customer doesn't know how many yards. Ask them for the dimensions of the area, length width and depth in feet. Tell them you'll calculate it for them"
      updates.state = "ASKING_DIMENSIONS"
    } else {
      instruction = `Ask how many cubic yards of ${fmtMaterial(merged.material_type)} they need. If they're not sure, you can help calculate from dimensions (length x width x depth in feet)`
    }
  } else if (!mHas("access_type")) {
    // Check if customer just answered yes/no to the access question
    if (isYes || /\b(sure|yep|yeah|of course|definitely|absolutely|they can|it can|room|plenty|wide|open|no problem|no issue)\b/i.test(lower)) {
      updates.access_type = "dump_truck_and_18wheeler"
      // Skip ahead — don't re-ask, move to date
      if (!mHas("delivery_date")) {
        instruction = "Got it, 18-wheelers can get in. Now ask about their timeline, do they need it by a specific date or are they flexible"
      } else {
        instruction = "__GENERATE_QUOTE__"
      }
    } else if (isNo || /\b(no|nope|nah|cant|can.?t|wont fit|too tight|too narrow|small)\b/i.test(lower)) {
      updates.access_type = "dump_truck_only"
      if (!mHas("delivery_date")) {
        instruction = "Got it, standard dump trucks only, no 18-wheelers. Now ask about their timeline, do they need it by a specific date or are they flexible"
      } else {
        instruction = "__GENERATE_QUOTE__"
      }
    } else {
      instruction = "Ask if an 18-wheeler can access their property or if we should use standard dump trucks. Standard dump trucks, triaxles, and quad axles can get pretty much anywhere. 18-wheelers need a wider road and room to turn around. Just ask real quick can an 18-wheeler get in or should we stick with regular dump trucks"
    }
  } else if (!mHas("delivery_date")) {
    instruction = "Ask about their timeline. Do they need it by a specific date or are they flexible. If they give a specific date we can offer guaranteed delivery for that date at a premium price, or standard 3-5 business day delivery at a lower price"
  } else {
    // ALL INFO COLLECTED — get dual quote (standard + priority from quarries)
    // Detect if customer gave a SPECIFIC date vs "flexible/whenever"
    const isFlexibleDate = /flexible|whenever|no rush|no hurry|not urgent|no specific|any.?time|doesn.?t matter|don.?t care/i.test(merged.delivery_date || "")
    const isSpecificDate = !isFlexibleDate && has(merged.delivery_date)
    const dualQuote = (merged.delivery_lat && merged.delivery_lng)
      ? await getDualQuote(
          merged.customer_name || "",
          merged.delivery_lat, merged.delivery_lng,
          merged.delivery_city || "",
          merged.material_type || "fill_dirt",
          merged.yards_needed || MIN_YARDS,
          merged.access_type || "dump_truck_only",
          merged.delivery_date || undefined,
        )
      : null

    if (dualQuote) {
      updates.price_per_yard_cents = dualQuote.standard.perYardCents
      updates.total_price_cents = dualQuote.standard.totalCents
      updates.zone = dualQuote.standard.zone
      updates.state = "QUOTING"
      // Store priority quote data so we know the price if they pick it
      if (dualQuote.priority) {
        updates._priority_total_cents = dualQuote.priority.totalCents
        updates._priority_guaranteed_date = dualQuote.priority.guaranteedDate
        updates._priority_quarry_name = dualQuote.priority.quarryName
      }
      // Sarah presents the formatted dual quote exactly as the pricing engine wrote it
      if (isSpecificDate && dualQuote.priority) {
        // Customer gave specific date — MUST present both options clearly
        instruction = `Customer needs it by ${merged.delivery_date}. Present BOTH options clearly:

Option 1 - Standard delivery: ${fmt$(dualQuote.standard.totalCents)} (${fmt$(dualQuote.standard.perYardCents)}/yard), 3-5 business days, sometimes sooner if we get a cancellation

Option 2 - Guaranteed by ${merged.delivery_date}: ${fmt$(dualQuote.priority.totalCents)} (${fmt$(dualQuote.priority.perYardCents)}/yard), locked in delivery date, payment upfront to secure the date

Ask which works better for them. Keep it natural, two short lines for the options then ask which one`
      } else if (isFlexibleDate || !dualQuote.priority) {
        // Flexible date or no priority available — just show standard
        instruction = `Present the standard quote: ${dualQuote.standard.billableYards} yards of ${fmtMaterial(merged.material_type||"")} to ${merged.delivery_city||""} comes to ${fmt$(dualQuote.standard.totalCents)} (${fmt$(dualQuote.standard.perYardCents)}/yard), delivery in 3-5 business days. Ask if they want to get that scheduled`
      } else {
        // Has priority but date wasn't clearly specific — show both but lead with standard
        instruction = `Present this quote to the customer exactly as written (rephrase naturally but keep the numbers exact): ${dualQuote.formatted}`
      }
    } else {
      // Fallback: use inline zone pricing if getDualQuote fails
      const quote = calcQuote(merged.distance_miles || 0, merged.material_type || "fill_dirt", merged.yards_needed || MIN_YARDS)
      if (quote) {
        updates.price_per_yard_cents = quote.perYardCents
        updates.total_price_cents = quote.totalCents
        updates.state = "QUOTING"
        const firstName = (merged.customer_name || "").split(/\s+/)[0]
        instruction = `Give ${firstName} their quote: ${quote.billable} yards of ${fmtMaterial(merged.material_type||"")} to ${merged.delivery_city||"their location"} comes to ${fmt$(quote.totalCents)} (${fmt$(quote.perYardCents)}/yard), delivery in 3-5 business days. Ask if they want to get that scheduled`
      } else if (merged.delivery_lat && merged.delivery_lng) {
        // Had coords but zone calc failed — genuinely outside service area
        instruction = "Their delivery address is outside your service area (more than 60 miles from your yards in Dallas, Fort Worth or Denver). Let them know and ask if there's another address"
        updates.state = "COLLECTING"
      } else {
        // No coords — geocode failed, address was saved but we can't price it
        // Don't tell them "outside service area" — that's a lie. Escalate.
        await notifyAdmin(`CANNOT QUOTE: ${conv.customer_name || phone} at "${merged.delivery_address}" — no coordinates. Geocode failed. Needs manual quote.`, `no_coords_${Date.now()}`)
        instruction = "Tell the customer you're having a little trouble pulling up the exact pricing for their address. Someone from the team will text them with a quote shortly"
        updates.state = "COLLECTING"
      }
    }
  }

  // ── GENERATE QUOTE if all info just became complete ──
  if (instruction === "__GENERATE_QUOTE__") {
    const qMerged = { ...conv, ...updates }
    const dualQuote = (qMerged.delivery_lat && qMerged.delivery_lng)
      ? await getDualQuote(
          qMerged.customer_name || "", qMerged.delivery_lat, qMerged.delivery_lng,
          qMerged.delivery_city || "", qMerged.material_type || "fill_dirt",
          qMerged.yards_needed || MIN_YARDS, qMerged.access_type || "dump_truck_only",
          qMerged.delivery_date || undefined,
        ) : null
    if (dualQuote) {
      updates.price_per_yard_cents = dualQuote.standard.perYardCents
      updates.total_price_cents = dualQuote.standard.totalCents
      updates.zone = dualQuote.standard.zone
      updates.state = "QUOTING"
      if (dualQuote.priority) {
        updates._priority_total_cents = dualQuote.priority.totalCents
        updates._priority_guaranteed_date = dualQuote.priority.guaranteedDate
        updates._priority_quarry_name = dualQuote.priority.quarryName
      }
      instruction = `Present this quote to the customer exactly as written (rephrase naturally but keep the numbers exact): ${dualQuote.formatted}`
    } else {
      const quote = calcQuote((qMerged.distance_miles || 0), qMerged.material_type || "fill_dirt", qMerged.yards_needed || MIN_YARDS)
      if (quote) {
        updates.price_per_yard_cents = quote.perYardCents
        updates.total_price_cents = quote.totalCents
        updates.state = "QUOTING"
        instruction = `Give ${(qMerged.customer_name||"").split(/\s+/)[0]} their quote: ${quote.billable} yards of ${fmtMaterial(qMerged.material_type||"")} to ${qMerged.delivery_city||"your location"} comes to ${fmt$(quote.totalCents)} (${fmt$(quote.perYardCents)}/yard), delivery in 3-5 business days. Ask if they want to get that scheduled`
      } else if (qMerged.delivery_lat && qMerged.delivery_lng) {
        instruction = "Their delivery address is outside our service area. Let them know and ask if there's another address"
        updates.state = "COLLECTING"
      } else {
        await notifyAdmin(`CANNOT QUOTE: ${qMerged.customer_name || phone} at "${qMerged.delivery_address}" — no coordinates. Needs manual quote.`, `no_coords2_${Date.now()}`)
        instruction = "Tell the customer you're having a little trouble pulling up the exact pricing for their address. Someone from the team will text them with a quote shortly"
        updates.state = "COLLECTING"
      }
    }
  }

  // Special state: waiting for dimensions — only run if we didn't already set an instruction from COLLECTING
  if ((state === "ASKING_DIMENSIONS" && !instruction) || (updates.state === "ASKING_DIMENSIONS" && !instruction)) {
    // If customer gives explicit yards (e.g. "15 yards"), accept it and skip dimensions
    if (inlineYards && /yard|yd|cy/i.test(body)) {
      updates.yards_needed = inlineYards
      updates.state = "COLLECTING"
      instruction = `Got it, ${inlineYards} cubic yards. Now ask real quick, can an 18-wheeler get to their property or should we use standard dump trucks`
    } else if (inlineDims) {
      const d = depthToFeet(inlineDims.d, body)
      const yards = cubicYards(inlineDims.l, inlineDims.w, d)
      updates.yards_needed = yards
      updates.dimensions_raw = body.trim()
      updates.state = "COLLECTING"
      instruction = `That comes out to about ${yards} cubic yards. Now ask real quick, can an 18-wheeler get to their property or should we use standard dump trucks`
    } else {
      // Check for partial dimensions or depth-only answers
      const nums = body.match(/(\d+\.?\d*)/g)
      if (nums && nums.length >= 3) {
        const d = depthToFeet(parseFloat(nums[2]), body)
        const yards = cubicYards(parseFloat(nums[0]), parseFloat(nums[1]), d)
        updates.yards_needed = yards
        updates.dimensions_raw = body.trim()
        updates.state = "COLLECTING"
        instruction = `That comes out to about ${yards} cubic yards. Now ask real quick, can an 18-wheeler get to their property or should we use standard dump trucks`
      } else if (nums && nums.length === 1 && conv.dimensions_raw) {
        // They gave depth after we asked — combine with stored L x W
        const prior = conv.dimensions_raw.match(/(\d+\.?\d*)/g)
        if (prior && prior.length >= 2) {
          const depth = depthToFeet(parseFloat(nums[0]), body)
          const yards = cubicYards(parseFloat(prior[0]), parseFloat(prior[1]), depth)
          updates.yards_needed = yards
          updates.dimensions_raw = `${prior[0]} x ${prior[1]} x ${nums[0]}`
          updates.state = "COLLECTING"
          instruction = `That comes out to about ${yards} cubic yards. Now ask real quick, can an 18-wheeler get to their property or should we use standard dump trucks`
        } else {
          instruction = "Need the depth in feet or inches. For reference, 4-6 inches is typical for a slab, 2-4 inches for leveling"
        }
      } else if (nums && nums.length === 2) {
        // Two numbers — assume length x width, still need depth
        updates.dimensions_raw = body.trim()
        instruction = `Got ${nums[0]} x ${nums[1]}. Now just need the depth, how thick does it need to be? For a slab usually 4-6 inches`
      } else if (nums && nums.length === 1) {
        // Single number — could be depth if we already have L x W
        instruction = "Need all three measurements, length width and depth in feet. Something like 40 x 40 x 6 inches"
      } else if (/don.?t know|no idea|not sure|no clue|can.?t measure|estimate|just guess|rough|ballpark/i.test(lower)) {
        // Customer can't provide dimensions — offer common estimates and escape back to COLLECTING
        updates.state = "COLLECTING"
        instruction = "Customer can't give exact dimensions. Help them estimate: a typical backyard leveling is 10-30 yards, a driveway base is 10-20 yards, a pool fill is 150-300 yards. Ask roughly how big the area is and suggest a number. If they pick one, go with it"
      } else {
        instruction = "Ask for the dimensions, length width and depth in feet. You'll calculate the cubic yards for them. If they're not sure, they can just give a rough estimate of the area size"
      }
    }
  }

  // Handle "let me get back to you" — only during QUOTING or late COLLECTING (not while gathering info)
  if (isFollowUp && (state === "QUOTING" || (state === "COLLECTING" && hasQuote))) {
    updates.state = "FOLLOW_UP"
    updates.follow_up_at = new Date(Date.now() + 24*60*60*1000).toISOString()
    updates.follow_up_count = 0
    instruction = "Customer wants to think about it or get back to you. Be totally cool with that, no pressure. Let them know you'll check back and they can text anytime"
  }

  if (!updates.state && state === "NEW") updates.state = "COLLECTING"
  if (!updates.state && state !== "COLLECTING" && state !== "ASKING_DIMENSIONS" && state !== "QUOTING") updates.state = state

  const s = await callSarah(body, merged, history, instruction || "Continue the conversation naturally. Figure out what they need and help them")
  reply = validate(s.response, lastOut)
  // Persist priority quote data FIRST (before saveConv) to avoid state/data mismatch
  // Check with != null instead of truthiness so $0 quotes still save
  if (updates._priority_total_cents != null) {
    await savePriorityFields(phone, {
      priority_total_cents: updates._priority_total_cents,
      priority_guaranteed_date: updates._priority_guaranteed_date || null,
      priority_quarry_name: updates._priority_quarry_name || null,
    })
  }
  await saveConv(phone, { ...conv, ...updates }, readAt)
  await logMsg(phone, reply, "outbound", `out_${sid}`)
  return reply

  } catch (err: any) {
    console.error("[CUSTOMER BRAIN CRASH]", err?.message || err)
    const fallback = "Give me one sec, let me check on that"
    try { await logMsg(normalizePhone(sms.from), fallback, "outbound", `safety_${sms.messageSid}`) } catch {}
    return fallback
  }
}
