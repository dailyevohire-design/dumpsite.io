import Anthropic from "@anthropic-ai/sdk"
import { createAdminSupabase } from "../supabase"
import { getDualQuote } from "./customer-pricing.service"
import { createDispatchOrder as systemDispatch } from "./dispatch.service"
import twilio from "twilio"

const anthropic = new Anthropic()
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const CUSTOMER_FROM = process.env.CUSTOMER_TWILIO_NUMBER!
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")
const ADMIN_PHONE_2 = (process.env.ADMIN_PHONE_2 || "").replace(/\D/g, "")
const LARGE_ORDER = 500

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
  const z = ZONES.find(z => miles >= z.min && miles < z.max)
  if (!z) return null
  const perYard = z.base + (SURCHARGE[material] || 0)
  const billable = Math.max(yards, MIN_YARDS)
  return { zone: z.zone, perYardCents: perYard, totalCents: billable * perYard, billable }
}

function cubicYards(l: number, w: number, d: number): number { return Math.ceil((l * w * d) / 27) }
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
    const q = encodeURIComponent(address.includes("Texas") || address.includes("TX") ? address : `${address} Texas USA`)
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
function extractYards(text: string): number | null {
  const m = text.match(/(\d+)\s*(cubic\s*)?(yards?|yds?|cy)/i) || text.match(/^(\d+)$/)
  return m ? parseInt(m[1]) : null
}

function extractDimensions(text: string): { l: number; w: number; d: number } | null {
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
  if (/pool|foundation|slab|footing|driveway|road|parking|pad|concrete|patio|sidewalk|compac/i.test(p)) return { key: "structural_fill", name: "structural fill" }
  if (/garden|flower|plant|landscap|sod|grass|lawn|raised bed|planter|grow|organic|mulch/i.test(p)) return { key: "screened_topsoil", name: "screened topsoil" }
  if (/sandbox|play.*area|play.*ground|septic|volleyball/i.test(p)) return { key: "sand", name: "sand" }
  if (/level|grad|fill|hole|low spot|uneven|slope|backfill|retaining|erosion|drain|trench|pipe/i.test(p)) return { key: "fill_dirt", name: "fill dirt" }
  return null
}

function looksLikeAddress(text: string): boolean {
  return /\d+\s+\w+.*(st|ave|blvd|dr|rd|ln|ct|way|pkwy|hwy|street|avenue|drive|road|lane|circle|trail|place|expy)/i.test(text) || /\d{5}/.test(text)
}

function looksLikeFollowUp(text: string): boolean {
  return /get back|think about|later|not sure yet|maybe|let me check|call you|hold off|not ready|give me a|need to talk|ask my|husband|wife|boss/i.test(text.toLowerCase())
}

// ─────────────────────────────────────────────────────────
// DB HELPERS
// ─────────────────────────────────────────────────────────
function normalizePhone(raw: string): string { return raw.replace(/\D/g, "").replace(/^1/, "") }

async function getConv(phone: string): Promise<any> {
  const sb = createAdminSupabase()
  const { data } = await sb.from("customer_conversations").select("*").eq("phone", phone).maybeSingle()
  return data || { state: "NEW" }
}

async function saveConv(phone: string, u: Record<string, any>): Promise<void> {
  const sb = createAdminSupabase()
  await sb.rpc("upsert_customer_conversation", {
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
  })
}

async function isDupe(sid: string): Promise<boolean> {
  const sb = createAdminSupabase()
  const { data } = await sb.rpc("check_customer_message", { p_sid: sid })
  return !data
}

async function getHistory(phone: string) {
  const sb = createAdminSupabase()
  const { data } = await sb.from("customer_sms_logs").select("body, direction").eq("phone", phone).order("created_at", { ascending: false }).limit(24)
  if (!data) return []
  return data.reverse().map((m: any) => ({ role: (m.direction === "inbound" ? "user" : "assistant") as "user"|"assistant", content: (m.body || "").trim() })).filter(m => m.content.length > 0)
}

async function logMsg(phone: string, body: string, dir: "inbound"|"outbound", sid: string) {
  try { await createAdminSupabase().from("customer_sms_logs").insert({ phone, body, direction: dir, message_sid: sid }) } catch {}
}

async function sendSMS(to: string, body: string, sid: string) {
  const msg = await twilioClient.messages.create({ body, from: CUSTOMER_FROM, to: `+1${normalizePhone(to)}` })
  await logMsg(normalizePhone(to), body, "outbound", msg.sid || `out_${sid}`)
}

async function notifyAdmin(msg: string, sid: string) {
  try { await sendSMS(ADMIN_PHONE, msg, `adm_${sid}`) } catch {}
  if (ADMIN_PHONE_2) { try { await sendSMS(ADMIN_PHONE_2, msg, `adm2_${sid}`) } catch {} }
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

SELF-CHECK BEFORE RESPONDING:
1. Did I answer their question FIRST before asking mine?
2. Is my response under 3 sentences?
3. Does it sound like a real person texting, not a customer service bot?
4. Am I asking only ONE thing?
5. If I don't know something, do I say "let me check on that" instead of making it up?

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
  // Dedup — don't send exact same message
  if (r.toLowerCase() === lastOutbound.toLowerCase() && r.length > 10) r = "Let me know if you have any other questions"
  return r || "Give me one sec"
}

// ─────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────
export async function handleCustomerSMS(sms: { from: string; body: string; messageSid: string; numMedia: number; mediaUrl?: string }): Promise<string> {
  const phone = normalizePhone(sms.from)
  const body = (sms.body || "").trim()
  const lower = body.toLowerCase().trim()
  const sid = sms.messageSid

  try {

  if (await isDupe(sid)) return ""
  await logMsg(phone, body || (sms.numMedia > 0 ? "[photo]" : "[empty]"), "inbound", sid)

  // Empty body with photo — acknowledge it
  if (sms.numMedia > 0 && !body) {
    const s = await callSarah("[Customer sent a photo]", await getConv(phone), await getHistory(phone), "Customer sent a photo. Acknowledge it naturally, like 'thanks for the pic' or 'got the photo'. Then continue with whatever question you need to ask next based on what info is still missing")
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

  const conv = await getConv(phone)
  if (conv.opted_out) return ""
  const state = conv.state || "NEW"
  const history = await getHistory(phone)
  const lastOut = history.filter(h => h.role === "assistant").slice(-1)[0]?.content || ""
  const updates: Record<string, any> = {}
  let reply = ""

  // ═══════════════════════════════════════════════════════
  // CODE DETERMINES WHAT TO DO → SONNET DECIDES HOW TO SAY IT
  // ═══════════════════════════════════════════════════════

  // ── INLINE EXTRACTION (code always does this, not AI) ──
  const inlineYards = extractYards(body)
  const inlineDims = extractDimensions(body)
  const inlineEmail = extractEmail(body)
  const inlineMaterial = extractMaterialFromPurpose(body)
  const isAddress = looksLikeAddress(body)
  const isFollowUp = looksLikeFollowUp(lower)

  // ── ACCESS TYPE EXTRACTION ──
  const inlineAccess = (() => {
    if (/\b(18.?wheel|big rig|semi|tractor|wide open|plenty of room|lots of room|big truck|any size|all good|both)\b/i.test(lower)) return "dump_truck_and_18wheeler"
    if (/\b(just dump|dump truck only|no.*(18|semi|big)|tight|narrow|small street|residential|driveway only|only dump)\b/i.test(lower)) return "dump_truck_only"
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
  const isYes = /^(yes|yeah|yep|sure|ok|okay|lets do it|sounds good|perfect|go ahead|book it|schedule|please|absolutely|definitely|si|dale|do it|im down|im in|ready|set it up)$/i.test(lower)
  const isNo = /^(no|nah|nope|too much|expensive|pass|never mind|cancel|not now|not interested|no thanks|no thank you|nah im good|nah i'm good|too expensive|way too much|too high|cant afford|can't afford|out of my budget|too pricey|hard pass|no way)$/i.test(lower)
  const isCancel = /cancel|refund|money back/i.test(lower)
  const isStatus = /\b(status|tracking|eta)\b|where.*(my|is my|the).*(order|delivery|driver|truck)|when.*(my|is my|the).*(order|delivery|driver|truck|arriving|coming|getting here)|how long.*(until|till|before|for)/i.test(lower)
  const isPaymentConfirm = /sent|paid|done|confirmed|just sent|payment sent|transferred|just paid/i.test(lower)

  // Determine what info is missing
  const has = (v: any) => v !== null && v !== undefined && v !== ""
  const needName = !has(conv.customer_name)
  const needAddress = !has(conv.delivery_address)
  const needPurpose = !has(conv.material_purpose)
  const needMaterial = !has(conv.material_type)
  const needYards = !has(conv.yards_needed)
  const needAccess = !has(conv.access_type)
  const needDate = !has(conv.delivery_date)
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
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // Order status — any state with an order
  if (isStatus && hasOrder) {
    const sb = createAdminSupabase()
    const { data: order } = await sb.from("dispatch_orders").select("status").eq("id", conv.dispatch_order_id).maybeSingle()
    const orderStatus = order?.status || "open"
    let statusInstruction = ""
    if (orderStatus === "open") statusInstruction = "Tell customer their order is confirmed and we're matching them with a driver. They'll get a text when driver is on the way"
    else if (orderStatus === "active" || orderStatus === "dispatching") statusInstruction = "Tell customer their driver has been assigned and they'll get an update when they're heading out"
    else if (orderStatus === "completed") statusInstruction = "Tell customer their delivery has been completed. Ask if everything looks good"
    else statusInstruction = "We're not currently hauling in their area but as soon as we are they'll be the first to know. We appreciate their patience"
    const s = await callSarah(body, conv, history, statusInstruction)
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // Status request but no order
  if (isStatus && !hasOrder) {
    const s = await callSarah(body, conv, history, "Customer asking about an order but they don't have one yet. We're not currently hauling in their area but as soon as we are they'll be the first to know. If they want to place an order, help them get started")
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
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
    await saveConv(phone, { ...conv, ...updates })
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
      await saveConv(phone, { ...conv, ...updates })
      await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
    }
    if (/zelle/i.test(lower)) {
      updates.payment_method = "zelle"
      const total = fmt$(conv.total_price_cents || 0)
      const s = await callSarah(body, conv, history, `They chose Zelle. Tell them to send ${total} to support@filldirtnearme.net via Zelle. Once sent, text you back`)
      reply = validate(s.response, lastOut)
      await saveConv(phone, { ...conv, ...updates })
      await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
    }
    if (/venmo/i.test(lower)) {
      updates.payment_method = "venmo"
      const total = fmt$(conv.total_price_cents || 0)
      const s = await callSarah(body, conv, history, `They chose Venmo. Tell them to send ${total} to @FillDirtNearMe on Venmo. Once sent, text you back`)
      reply = validate(s.response, lastOut)
      await saveConv(phone, { ...conv, ...updates })
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
      await saveConv(phone, { ...conv, ...updates })
      await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
    }
    if (/cash|check|cheque/i.test(lower)) {
      const s = await callSarah(body, conv, history, "They want cash or check. Explain we cant accept those, our drivers are independently insured contractors so for liability reasons we can only do Venmo, Zelle, or online invoice (card with 3.5% fee). Ask which works")
      reply = validate(s.response, lastOut)
      await saveConv(phone, { ...conv, ...updates })
      await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
    }
    // General question while waiting for payment
    const s = await callSarah(body, conv, history, `Delivery is complete, waiting on payment of ${fmt$(conv.total_price_cents||0)}. Answer their question, then remind them we accept Venmo, Zelle, or online invoice (card with 3.5% fee). Which works for them`)
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── CLOSED — customer cancelled or completed. Let them restart. ──
  if (state === "CLOSED") {
    const s = await callSarah(body, conv, history, "This customer had a previous order that's now closed. If they want to place a new order, help them get started fresh. Ask what they need")
    updates.state = "COLLECTING"
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── ACTIVE ORDER — waiting for delivery ──
  if (state === "ORDER_PLACED") {
    const s = await callSarah(body, conv, history, "Customer has a confirmed order waiting for delivery. Answer their question helpfully. If they ask about status say their delivery is being scheduled and they'll get a text when their driver is heading their way. If they want to cancel, say you'll have someone reach out")
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── DELIVERED — delivery done, payment confirmed ──
  if (state === "DELIVERED") {
    const s = await callSarah(body, conv, history, "This customer's delivery has been completed and payment was received. Answer their question. If they need more material, help them start a new order. If they have an issue with the delivery, say you'll have someone from the team reach out")
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── QUOTING — we gave a price, waiting for yes/no ──
  if (state === "QUOTING") {
    if (isYes) {
      // Customer accepted the quote — create order immediately, payment comes after delivery
      updates.state = "ORDER_PLACED"
      const orderId = await createDispatchOrder({ ...conv, ...updates }, phone)
      if (orderId) {
        updates.dispatch_order_id = orderId
        const yards = conv.yards_needed || MIN_YARDS
        await notifyAdmin(`New order: ${conv.customer_name} | ${yards}yds ${fmtMaterial(conv.material_type||"fill_dirt")} | ${conv.delivery_city} | ${fmt$(conv.total_price_cents||0)}`, sid)
        if (yards >= LARGE_ORDER) await notifyAdmin(`LARGE ORDER ${yards}yds — ${conv.customer_name} ${conv.delivery_city}`, sid)
      }
      const s = await callSarah(body, conv, history, `Customer said yes. Tell them their delivery is confirmed for ${conv.delivery_date || "the schedule"}. They'll get a text when their driver is heading their way. Mention that payment is collected after delivery, we accept Venmo, Zelle, or online invoice (card has a 3.5% fee). Keep it casual, dont send actual account info yet`)
      reply = validate(s.response, lastOut)
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
    await saveConv(phone, { ...conv, ...updates })
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
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ═══════════════════════════════════════════════════════
  // MAIN QUALIFICATION FLOW — collect info conversationally
  // ═══════════════════════════════════════════════════════

  // ── NEW CUSTOMER ──
  if (state === "NEW") {
    updates.state = "COLLECTING"
    const s = await callSarah(body, conv, history, "New customer just texted. Say hey this is Sarah with Fill Dirt Near Me. Ask what their name is. One short message, nothing else. Do NOT apologize, do NOT use dashes, do NOT use exclamation marks")
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
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
    const COMMON_WORDS = /^(the|a|an|is|it|at|in|on|to|so|or|do|go|and|but|for|not|just|also|too|very|all|any|some|my|our|this|that|its|get|got|can|will|has|had|was|are|been|have|from|with|they|them|what|when|how|who|which|where|here|there|then|than|more|much|many|most|other|only|still|even|well|back|over|such|after|into|made|like|long|out|way|day|each|new|now|old|see|let|say|may|own|why|try)$/i
    const isLikelyName = words.length <= 3 && words[0].length >= 2 && !COMMON_WORDS.test(words[0]) && !/\b(dirt|fill|sand|topsoil|gravel|delivery|truck|dump|yard|slab|pool|concrete|driveway|garden|level|grade|material|project|quote|price)\b/i.test(trimmed)
    if (isLikelyName) {
      updates.customer_name = trimmed
    }
  }

  // Address extraction — require actual street address, not just a zip code
  const isBareZip = /^\d{5}(-\d{4})?$/.test(body.trim())
  if (isAddress && needAddress && !isBareZip) {
    const geo = await geocode(body)
    if (geo) {
      updates.delivery_address = body.trim()
      updates.delivery_city = geo.city
      updates.delivery_lat = geo.lat
      updates.delivery_lng = geo.lng
      const nearest = nearestYard(geo.lat, geo.lng)
      updates.distance_miles = nearest.miles
      const zone = ZONES.find(z => nearest.miles >= z.min && nearest.miles < z.max)
      updates.zone = zone?.zone || null
    }
  }

  if (inlineYards && needYards) {
    updates.yards_needed = inlineYards
  }

  if (inlineDims && needYards) {
    const yards = cubicYards(inlineDims.l, inlineDims.w, inlineDims.d)
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
    instruction = `Customer said they need dirt for: "${merged.material_purpose}". Based on your knowledge, recommend the right material type (fill dirt, structural fill, screened topsoil, or sand). Explain briefly why that material is right for their project. Then ask how many cubic yards they need, and offer to help calculate if they're not sure`
  } else if (!mHas("yards_needed")) {
    // Detect if they gave partial dimensions (e.g. "40 x 40" — 2 numbers, missing depth)
    const hasPartialDims = /\d+\s*[x×]\s*\d+/i.test(body) || /\d+\s*by\s*\d+/i.test(body) || /\d+\s*ft?\s*[x×]\s*\d+/i.test(body)
    const nums = body.match(/(\d+\.?\d*)/g)
    if (hasPartialDims && nums && nums.length === 2) {
      // They gave length x width but no depth — ask for depth, we'll calculate
      updates.state = "ASKING_DIMENSIONS"
      instruction = `Customer gave ${nums[0]} x ${nums[1]} but we need the depth too. Ask how deep/thick they need it in feet or inches. For a slab its usually 4-6 inches. Be helpful`
    } else if (hasPartialDims && nums && nums.length >= 3) {
      // They gave all 3 — calculate
      const yards = cubicYards(parseFloat(nums[0]), parseFloat(nums[1]), parseFloat(nums[2]))
      updates.yards_needed = yards
      updates.dimensions_raw = body.trim()
      instruction = `That comes out to about ${yards} cubic yards. Now ask if their property has access for dump trucks and 18 wheelers, or just dump trucks`
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
        instruction = "They have room for big trucks. Now ask about their timeline, do they need it by a specific date or are they flexible"
      } else {
        instruction = "__GENERATE_QUOTE__"
      }
    } else if (isNo || /\b(no|nope|nah|cant|can.?t|wont fit|too tight|too narrow|small)\b/i.test(lower)) {
      updates.access_type = "dump_truck_only"
      if (!mHas("delivery_date")) {
        instruction = "Got it, dump trucks only. Now ask about their timeline, do they need it by a specific date or are they flexible"
      } else {
        instruction = "__GENERATE_QUOTE__"
      }
    } else {
      instruction = "Ask if their property can fit big rigs and 18 wheelers, or just standard dump trucks. This affects what size truck we send"
    }
  } else if (!mHas("delivery_date")) {
    instruction = "Ask about their timeline. Do they need it by a specific date or are they flexible on delivery"
  } else {
    // ALL INFO COLLECTED — get dual quote (standard + priority from quarries)
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
      // Sarah presents the formatted dual quote exactly as the pricing engine wrote it
      instruction = `Present this quote to the customer exactly as written (rephrase naturally but keep the numbers exact): ${dualQuote.formatted}`
    } else {
      // Fallback: use inline zone pricing if getDualQuote fails
      const quote = calcQuote(merged.distance_miles || 0, merged.material_type || "fill_dirt", merged.yards_needed || MIN_YARDS)
      if (quote) {
        updates.price_per_yard_cents = quote.perYardCents
        updates.total_price_cents = quote.totalCents
        updates.state = "QUOTING"
        const firstName = (merged.customer_name || "").split(/\s+/)[0]
        instruction = `Give ${firstName} their quote: ${quote.billable} yards of ${fmtMaterial(merged.material_type||"")} to ${merged.delivery_city||"their location"} comes to ${fmt$(quote.totalCents)} (${fmt$(quote.perYardCents)}/yard), delivery in 3-5 business days. Ask if they want to get that scheduled`
      } else {
        instruction = "Their delivery address is outside your service area (more than 60 miles from your yards in Dallas, Fort Worth or Denver). Let them know and ask if there's another address"
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
      instruction = `Present this quote to the customer exactly as written (rephrase naturally but keep the numbers exact): ${dualQuote.formatted}`
    } else {
      const quote = calcQuote((qMerged.distance_miles || 0), qMerged.material_type || "fill_dirt", qMerged.yards_needed || MIN_YARDS)
      if (quote) {
        updates.price_per_yard_cents = quote.perYardCents
        updates.total_price_cents = quote.totalCents
        updates.state = "QUOTING"
        instruction = `Give ${(qMerged.customer_name||"").split(/\s+/)[0]} their quote: ${quote.billable} yards of ${fmtMaterial(qMerged.material_type||"")} to ${qMerged.delivery_city||"your location"} comes to ${fmt$(quote.totalCents)} (${fmt$(quote.perYardCents)}/yard), delivery in 3-5 business days. Ask if they want to get that scheduled`
      } else {
        instruction = "Their delivery address is outside our service area. Let them know and ask if there's another address"
        updates.state = "COLLECTING"
      }
    }
  }

  // Special state: waiting for dimensions
  if (state === "ASKING_DIMENSIONS" || updates.state === "ASKING_DIMENSIONS") {
    if (inlineDims) {
      const yards = cubicYards(inlineDims.l, inlineDims.w, inlineDims.d)
      updates.yards_needed = yards
      updates.dimensions_raw = body.trim()
      updates.state = "COLLECTING"
      instruction = `That comes out to about ${yards} cubic yards. Now ask if their property has access for dump trucks and 18 wheelers, or just dump trucks`
    } else {
      // Check for partial dimensions or depth-only answers
      const nums = body.match(/(\d+\.?\d*)/g)
      if (nums && nums.length >= 3) {
        const yards = cubicYards(parseFloat(nums[0]), parseFloat(nums[1]), parseFloat(nums[2]))
        updates.yards_needed = yards
        updates.dimensions_raw = body.trim()
        updates.state = "COLLECTING"
        instruction = `That comes out to about ${yards} cubic yards. Now ask if their property has access for dump trucks and 18 wheelers, or just dump trucks`
      } else if (nums && nums.length === 1 && conv.dimensions_raw) {
        // They gave depth after we asked — combine with stored L x W
        const prior = conv.dimensions_raw.match(/(\d+\.?\d*)/g)
        if (prior && prior.length >= 2) {
          let depth = parseFloat(nums[0])
          // Convert to feet: explicit "inches" or "in" → divide by 12
          // Explicit "feet" or "ft" → use as-is
          // No unit: if <= 12 assume inches (nobody does a 6-foot-deep slab), if > 12 assume inches too
          const saidFeet = /\b(feet|ft|foot)\b/i.test(body)
          const saidInches = /\b(inch|inches|in)\b|"/i.test(body)
          if (saidFeet) { /* already in feet */ }
          else if (saidInches || depth <= 12) depth = depth / 12
          const yards = cubicYards(parseFloat(prior[0]), parseFloat(prior[1]), depth)
          updates.yards_needed = yards
          updates.dimensions_raw = `${prior[0]} x ${prior[1]} x ${nums[0]}`
          updates.state = "COLLECTING"
          instruction = `That comes out to about ${yards} cubic yards. Now ask if their property has access for dump trucks and 18 wheelers, or just dump trucks`
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
      } else {
        instruction = "Ask for the dimensions, length width and depth in feet. You'll calculate the cubic yards for them"
      }
    }
  }

  // Handle "let me get back to you" at any collection stage
  if (isFollowUp && state !== "FOLLOW_UP") {
    updates.state = "FOLLOW_UP"
    updates.follow_up_at = new Date(Date.now() + 24*60*60*1000).toISOString()
    updates.follow_up_count = 0
    instruction = "Customer wants to think about it or get back to you. Be totally cool with that, no pressure. Let them know you'll check back and they can text anytime"
  }

  if (!updates.state && state === "NEW") updates.state = "COLLECTING"
  if (!updates.state && state !== "COLLECTING" && state !== "ASKING_DIMENSIONS" && state !== "QUOTING") updates.state = state

  const s = await callSarah(body, merged, history, instruction || "Continue the conversation naturally. Figure out what they need and help them")
  reply = validate(s.response, lastOut)
  await saveConv(phone, { ...conv, ...updates })
  await logMsg(phone, reply, "outbound", `out_${sid}`)
  return reply

  } catch (err: any) {
    console.error("[CUSTOMER BRAIN CRASH]", err?.message || err)
    const fallback = "Give me one sec, let me check on that"
    try { await logMsg(normalizePhone(sms.from), fallback, "outbound", `safety_${sms.messageSid}`) } catch {}
    return fallback
  }
}
