import Anthropic from "@anthropic-ai/sdk"
import { createAdminSupabase } from "../supabase"
import { createDispatchOrder as systemDispatch, type CreateDispatchInput } from "./dispatch.service"
import { getDualQuote, calcStandardQuote, fmt$, fmtMaterial, MIN_YARDS, haversine, nearestYard, ZONES, SURCHARGE_CENTS } from "./customer-pricing.service"
import twilio from "twilio"

const anthropic = new Anthropic()
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const CUSTOMER_FROM = process.env.CUSTOMER_TWILIO_NUMBER!
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")
const LARGE_ORDER = 500

// Pricing imported from customer-pricing.service.ts

function cubicYards(l: number, w: number, d: number): number { return Math.ceil((l * w * d) / 27) }

// ─────────────────────────────────────────────────────────
// GEOCODE
// ─────────────────────────────────────────────────────────
async function geocode(address: string): Promise<{ lat: number; lng: number; city: string; formatted: string } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return null
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`)
    const d = await r.json()
    if (d.status === "OK" && d.results[0]) {
      const loc = d.results[0].geometry.location
      const comps = d.results[0].address_components || []
      const city = comps.find((c: any) => c.types.includes("locality"))?.long_name
        || comps.find((c: any) => c.types.includes("sublocality"))?.long_name
        || comps.find((c: any) => c.types.includes("administrative_area_level_3"))?.long_name
        || comps.find((c: any) => c.types.includes("neighborhood"))?.long_name
        || ""
      return { lat: loc.lat, lng: loc.lng, city, formatted: d.results[0].formatted_address || "" }
    }
  } catch {}
  return null
}

// ─────────────────────────────────────────────────────────
// RESOLVE CITY_ID — look up in cities table by name
// ─────────────────────────────────────────────────────────
async function resolveCityId(cityName: string): Promise<string | null> {
  if (!cityName) return null
  const sb = createAdminSupabase()
  const { data } = await sb
    .from("cities")
    .select("id")
    .ilike("name", `%${cityName.trim()}%`)
    .eq("is_active", true)
    .maybeSingle()
  return data?.id || null
}

// ─────────────────────────────────────────────────────────
// CODE-BASED EXTRACTION — AI never sets these fields
// ─────────────────────────────────────────────────────────
function extractYards(text: string): number | null {
  // Must have a unit or be a standalone number > 5 (nobody orders "2 yards" — min is 10)
  const withUnit = text.match(/(\d+)\s*(cubic\s*)?(yards?|yds?|cy)/i)
  if (withUnit) return parseInt(withUnit[1])
  // Bare number only if it's the entire message and reasonable (5+)
  const bare = text.trim().match(/^(\d+)$/)
  if (bare && parseInt(bare[1]) >= 5) return parseInt(bare[1])
  return null
}

function extractDimensions(text: string): { l: number; w: number; d: number } | null {
  // Only match if text looks like dimensions (has separators like x, by, ×, commas, or "ft"/"feet")
  if (!/[x×]|by|\bft\b|\bfeet\b/i.test(text) && !/(\d+)\s*[,]\s*(\d+)\s*[,]\s*(\d+)/.test(text)) return null
  const nums = text.match(/(\d+\.?\d*)/g)
  if (nums && nums.length >= 3) return { l: parseFloat(nums[0]), w: parseFloat(nums[1]), d: parseFloat(nums[2]) }
  return null
}

function extractEmail(text: string): string | null {
  const m = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/)
  return m ? m[0].toLowerCase() : null
}

function extractMaterialFromPurpose(purpose: string): { key: string; name: string } | null {
  const p = purpose.toLowerCase()
  // Direct material mentions FIRST — if customer explicitly names the material, respect that
  if (/structural\s*fill/i.test(p)) return { key: "structural_fill", name: "structural fill" }
  if (/fill\s*dirt/i.test(p)) return { key: "fill_dirt", name: "fill dirt" }
  if (/top\s*soil|topsoil|screened\s*topsoil/i.test(p)) return { key: "screened_topsoil", name: "screened topsoil" }
  if (/\bsand\b/i.test(p) && !/sandbox|sandstone/i.test(p)) return { key: "sand", name: "sand" }
  // Purpose-based inference — customer describes their project, we recommend the right material
  if (/pool|foundation|slab|footing|driveway|road|parking|pad|concrete|patio|sidewalk|compac/i.test(p)) return { key: "structural_fill", name: "structural fill" }
  if (/garden|flower|plant|landscap|sod|grass|lawn|raised bed|planter|grow|organic|mulch/i.test(p)) return { key: "screened_topsoil", name: "screened topsoil" }
  if (/sandbox|play.*area|play.*ground|septic|volleyball/i.test(p)) return { key: "sand", name: "sand" }
  if (/level|grad(e|ing)|backfill|retaining|erosion|drain|trench|pipe|low spot|uneven|slope/i.test(p)) return { key: "fill_dirt", name: "fill dirt" }
  return null
}

// Detect if customer is naming a material directly (not a purpose)
function isDirectMaterialMention(text: string): boolean {
  return /^(fill\s*dirt|structural\s*fill|top\s*soil|topsoil|screened\s*topsoil|sand)$/i.test(text.trim())
}

function looksLikeAddress(text: string): boolean {
  // Street number + name + optional suffix
  if (/\d+\s+\w+.*(st|ave|blvd|dr|rd|ln|ct|way|pkwy|hwy|street|avenue|drive|road|lane|circle|trail|place|expy|plaza|loop|run|path|row|terr)/i.test(text)) return true
  // Has a ZIP code
  if (/\b\d{5}(-\d{4})?\b/.test(text)) return true
  // Street number + at least 2 words (like "123 Oak Lane" even without suffix detected)
  if (/^\d+\s+\w+\s+\w+/i.test(text) && text.length > 10) return true
  return false
}

function looksLikeFollowUp(text: string): boolean {
  return /get back|think about|later|not sure yet|maybe later|let me check|call you|hold off|not ready|give me a (sec|min|day|week)|need to talk|ask my|husband|wife|boss|partner|think on it|sleep on it|mull it over/i.test(text.toLowerCase())
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
    p_pricing_type: u.pricing_type ?? null,
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
}

// ─────────────────────────────────────────────────────────
// CREATE DISPATCH ORDER — uses the REAL dispatch service
// Resolves city_id, uses system driver pay rates, triggers
// driver SMS dispatch, push notifications, audit logging
// ─────────────────────────────────────────────────────────
async function createCustomerDispatchOrder(conv: any, phone: string): Promise<string | null> {
  try {
    // Resolve city_id from delivery_city
    const cityId = await resolveCityId(conv.delivery_city || "")
    if (!cityId) {
      // City not in system — notify admin so they can add it or handle manually
      console.error(`[customer dispatch] City not found: ${conv.delivery_city}`)
      await notifyAdmin(`Customer order needs manual dispatch — city "${conv.delivery_city}" not in system. Customer: ${conv.customer_name} (${phone}) ${conv.yards_needed}yds ${fmtMaterial(conv.material_type || "fill_dirt")} to ${conv.delivery_address}`, `city_miss_${Date.now()}`)
      // Still create a record so order isn't lost — use manual fallback
      const sb = createAdminSupabase()
      const { data } = await sb.from("dispatch_orders").insert({
        client_phone: phone,
        client_name: conv.customer_name || "Customer",
        client_address: conv.delivery_address,
        yards_needed: conv.yards_needed || MIN_YARDS,
        price_quoted_cents: conv.total_price_cents,
        driver_pay_cents: 4000, // default $40
        status: "dispatching",
        source: "filldirtnearme_sms",
        delivery_latitude: conv.delivery_lat || null,
        delivery_longitude: conv.delivery_lng || null,
        notes: `${fmtMaterial(conv.material_type || "fill_dirt")} | ${conv.access_type || "dump truck"} access | ${conv.delivery_date || "Flexible"} | Source: FillDirtNearMe SMS | NEEDS MANUAL CITY ASSIGNMENT`,
      }).select("id").single()
      return data?.id || null
    }

    // Use the real dispatch service — handles driver matching, SMS, push, audit
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
      source: "web_form", // closest existing source type
    })

    if (result.success && result.dispatchId) {
      console.log(`[customer dispatch] Order created: ${result.dispatchId} — ${result.driversNotified} drivers notified in ${result.cityName}`)
      return result.dispatchId
    }
    console.error("[customer dispatch] Failed:", result.error)
    return null
  } catch (e) {
    console.error("[customer dispatch]", e)
    return null
  }
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

PAYMENT RULES (NON-NEGOTIABLE):
- We accept Zelle and Venmo ONLY.
- NO cash. NO check. Reason: Our drivers are independently insured contractors. For insurance and liability purposes we cannot accept cash or check at time of delivery.
- When explaining this, be matter-of-fact and professional. Don't make it sound weird.
- Zelle: support@filldirtnearme.net
- Venmo: @FillDirtNearMe

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

    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 250,
      system: SARAH_SYSTEM,
      messages: [...history.slice(-16), { role: "user" as const, content: ctx }],
    })
    const raw = resp.content[0].type === "text" ? resp.content[0].text.trim() : ""
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    return JSON.parse(cleaned)
  } catch (e) {
    console.error("[Sarah brain]", e)
    return { response: "Give me one sec, let me check on that" }
  }
}

// ─────────────────────────────────────────────────────────
// VALIDATOR
// ─────────────────────────────────────────────────────────
function validate(r: string, lastOutbound: string): string {
  for (const p of ["i am an ai","i'm an ai","language model","claude","anthropic","i am a bot","i'm a bot","as an ai","artificial intelligence"]) {
    if (r.toLowerCase().includes(p)) return "This is Sarah with Fill Dirt Near Me, how can I help"
  }
  if (r.length > 400) r = r.split(/[.!?\n]/).filter(s => s.trim().length > 5).slice(0, 3).join(". ").trim()
  r = r.replace(/\.\s*$/, "").trim()
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
  await logMsg(phone, body || "[empty]", "inbound", sid)

  // Empty body (image only, blank text)
  if (!body || body.length === 0) {
    return ""
  }

  // STOP/START
  if (/^(stop|unsubscribe|quit|end)$/i.test(lower)) {
    try { await createAdminSupabase().from("customer_conversations").update({ opted_out: true }).eq("phone", phone) } catch {}
    return ""
  }
  if (/^(start|unstop|subscribe)$/i.test(lower)) {
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
  const directMaterial = isDirectMaterialMention(body)
  const isAddress = looksLikeAddress(body)
  const isFollowUp = looksLikeFollowUp(lower)
  const isYes = /^(y|yes|yeah|yea|ya|ye|yep|yup|sure|ok|okay|k|lets do it|let's do it|sounds good|perfect|go ahead|book it|schedule|please|absolutely|definitely|for sure|si|dale|do it|im down|i'm down|im in|i'm in|ready|set it up|lets go|let's go|bet|down|send it|yes please|yeah please|yep lets do it|go for it)$/i.test(lower)
  const isNo = /^(n|no|nah|nope|no thanks|nah im good|nah i'm good|too much|too expensive|expensive|pass|never mind|nevermind|cancel|not now|not interested|no way|hard pass|pass on that)$/i.test(lower)
  const isCancel = /\b(cancel|refund|money back|want my money)\b/i.test(lower)
  const isStatus = /\b(status|update|tracking|driver|eta)\b|when.*(deliver|come|arriv|get here|show up)|where.*driver|how long/i.test(lower)
  const isPaymentConfirm = /\b(sent|paid|done|confirmed|just sent|payment sent|transferred|just paid|sent it|paid it|its sent|it's sent|i sent|i paid)\b/i.test(lower)

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
    await notifyAdmin(`Customer ${conv.customer_name || phone} requesting cancellation`, sid)
    const s = await callSarah(body, conv, history, "Customer wants to cancel. Say you'll have someone from the team reach out to help with that. Be empathetic.")
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // Order status — any state with an order
  if (isStatus && hasOrder) {
    const sb = createAdminSupabase()
    const { data: order } = await sb.from("dispatch_orders").select("status").eq("id", conv.dispatch_order_id).maybeSingle()
    const orderStatus = order?.status || "dispatching"
    let statusInstruction = ""
    if (orderStatus === "dispatching") statusInstruction = "Tell customer their order is confirmed and we're matching them with a driver. They'll get a text when driver is on the way"
    else if (orderStatus === "active") statusInstruction = "Tell customer their driver has been assigned and they'll get an update when they're heading out"
    else if (orderStatus === "completed") statusInstruction = "Tell customer their delivery has been completed. Ask if everything looks good"
    else statusInstruction = "Tell customer their order is in the system and we're working on scheduling. They'll be the first to know when a driver is assigned"
    const s = await callSarah(body, conv, history, statusInstruction)
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // Status request but no order
  if (isStatus && !hasOrder) {
    const s = await callSarah(body, conv, history, "Customer asking about an order but they don't have one yet. If they've been through the quoting process, help them continue. Otherwise help them get started with a new order")
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
    updates.state = hasQuote ? "QUOTING" : "COLLECTING"
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── PAYMENT FLOW ──
  if (state === "AWAITING_PAYMENT") {
    if (isPaymentConfirm) {
      updates.payment_status = "confirming"
      updates.state = "ORDER_PLACED"
      const orderId = await createCustomerDispatchOrder({ ...conv, ...updates }, phone)
      if (orderId) {
        updates.dispatch_order_id = orderId
        const yards = conv.yards_needed || MIN_YARDS
        if (yards >= LARGE_ORDER) await notifyAdmin(`LARGE ORDER ${yards}yds — ${conv.customer_name} ${conv.delivery_city}`, sid)
      } else {
        // Dispatch failed but customer already paid — alert admin urgently
        await notifyAdmin(`URGENT: Customer ${conv.customer_name} (${phone}) paid ${fmt$(conv.total_price_cents||0)} but dispatch order creation failed. Manual intervention needed. ${conv.delivery_address}`, sid)
      }
      const s = await callSarah(body, conv, history, `Payment confirmed! Tell ${(conv.customer_name||"").split(/\s+/)[0]||"them"} their delivery is confirmed for ${conv.delivery_date || "soon"}. They'll get a text when their driver is on the way. Thank them for choosing Fill Dirt Near Me`)
      reply = validate(s.response, lastOut)
      await saveConv(phone, { ...conv, ...updates })
      await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
    }
    // Not a payment confirmation — answer their question, remind about payment
    const s = await callSarah(body, conv, history, `Customer hasn't confirmed payment yet. Answer whatever they asked, then gently remind them to send the ${fmt$(conv.total_price_cents||0)} via ${conv.payment_method || "Zelle or Venmo"} when ready`)
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── ACTIVE ORDER ──
  if (state === "ORDER_PLACED" || state === "DELIVERED") {
    const s = await callSarah(body, conv, history, "Customer has a confirmed order. Answer their question helpfully. If they ask about status say delivery is being scheduled and they'll get a text when driver is on the way. If they want to cancel, say you'll have someone reach out")
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── QUOTING — we gave a price, waiting for yes/no ──
  if (state === "QUOTING") {
    if (isYes) {
      if (needEmail) {
        updates.state = "ASKING_EMAIL"
        const s = await callSarah(body, conv, history, "Customer said yes to the quote! Ask for their email so you can send a receipt")
        reply = validate(s.response, lastOut)
      } else if (needPayment) {
        updates.state = "ASKING_PAYMENT"
        const s = await callSarah(body, conv, history, "Customer confirmed the order. Now explain payment: you accept Zelle and Venmo only. Your drivers are independently insured so you cant accept cash or check at delivery. Ask which works for them")
        reply = validate(s.response, lastOut)
      } else {
        // Has email AND payment already (returning customer) — go straight to awaiting payment
        updates.state = "AWAITING_PAYMENT"
        const total = fmt$(conv.total_price_cents || 0)
        const method = conv.payment_method || "Zelle"
        const target = method === "venmo" ? "@FillDirtNearMe on Venmo" : "support@filldirtnearme.net via Zelle"
        const s = await callSarah(body, conv, history, `Customer said yes and we already have their email and payment method (${method}). Tell them to send ${total} to ${target}. Text back once sent`)
        reply = validate(s.response, lastOut)
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
      const s = await callSarah(body, conv, history, `Customer was quoted ${fmt$(conv.total_price_cents||0)} for ${conv.yards_needed} yards of ${fmtMaterial(conv.material_type||"")}. They said something other than yes/no. Answer their question or concern, then ask if they'd like to move forward`)
      reply = validate(s.response, lastOut)
    }
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── EMAIL COLLECTION ──
  if (state === "ASKING_EMAIL") {
    const email = inlineEmail || extractEmail(body)
    if (email) {
      updates.customer_email = email
      updates.state = "ASKING_PAYMENT"
      const s = await callSarah(body, conv, history, "Got their email. Now explain payment: Zelle and Venmo only. Drivers are independently insured so cash and check cant be accepted at delivery. Ask which works for them. Be matter-of-fact, not apologetic")
      reply = validate(s.response, lastOut)
    } else {
      const s = await callSarah(body, conv, history, "Need their email for the receipt. They didn't give a valid email. Ask again naturally")
      reply = validate(s.response, lastOut)
    }
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── PAYMENT METHOD ──
  if (state === "ASKING_PAYMENT") {
    if (/zelle/i.test(lower)) {
      updates.payment_method = "zelle"
      updates.state = "AWAITING_PAYMENT"
      const total = fmt$(conv.total_price_cents || 0)
      const s = await callSarah(body, conv, history, `They chose Zelle. Tell them to send ${total} to support@filldirtnearme.net via Zelle. Once they send it, text you back and you'll get them confirmed`)
      reply = validate(s.response, lastOut)
    } else if (/venmo/i.test(lower)) {
      updates.payment_method = "venmo"
      updates.state = "AWAITING_PAYMENT"
      const total = fmt$(conv.total_price_cents || 0)
      const s = await callSarah(body, conv, history, `They chose Venmo. Tell them to send ${total} to @FillDirtNearMe on Venmo. Once they send it, text you back and you'll get them confirmed`)
      reply = validate(s.response, lastOut)
    } else if (/cash|check|cheque|card|credit|debit/i.test(lower)) {
      const s = await callSarah(body, conv, history, "They want to pay cash, check, or card. Explain that unfortunately you can only accept Zelle or Venmo. Your drivers are independently insured contractors and for insurance and liability reasons those are the only options. Ask which works, Zelle or Venmo")
      reply = validate(s.response, lastOut)
    } else {
      const s = await callSarah(body, conv, history, "Need them to choose Zelle or Venmo. Answer whatever they asked, then ask which payment method works for them")
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
    const s = await callSarah(body, conv, history, "New customer just texted. Greet them warmly. Say you're Sarah with Fill Dirt Near Me. Ask their name. Keep it short and friendly")
    reply = validate(s.response, lastOut)
    await saveConv(phone, { ...conv, ...updates })
    await logMsg(phone, reply, "outbound", `out_${sid}`); return reply
  }

  // ── COLLECTING — the main qualification state ──

  // Try to extract data from whatever they said
  // Name: only if we need it AND it looks like a name (short, no numbers, no address)
  if (needName && body.trim().length < 40 && body.trim().length > 0 && !isAddress && !/\d/.test(body.trim()) && !inlineMaterial && !directMaterial) {
    updates.customer_name = body.trim()
  }

  if (isAddress && needAddress) {
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

  // Only extract yards during COLLECTING state when we're actively asking for yards
  if (inlineYards && needYards && (has(conv.material_type) || has(conv.material_purpose))) {
    updates.yards_needed = inlineYards
  }

  if (inlineDims && needYards && (state === "ASKING_DIMENSIONS" || (has(conv.material_type) || has(conv.material_purpose)))) {
    const yards = cubicYards(inlineDims.l, inlineDims.w, inlineDims.d)
    updates.yards_needed = yards
    updates.dimensions_raw = body.trim()
  }

  // Material: only if we're past name+address and actively need it
  if (inlineMaterial && needMaterial && has(conv.customer_name) && has(conv.delivery_address)) {
    updates.material_type = inlineMaterial.key
    // If they named the material directly, don't also save as purpose
    if (!directMaterial) {
      updates.material_purpose = body.trim()
    } else {
      updates.material_purpose = body.trim()
      updates.material_type = inlineMaterial.key
    }
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
    instruction = "Ask for their name. If they already told you about their project, acknowledge that first, then ask their name"
  } else if (!mHas("delivery_address")) {
    instruction = `Ask ${(merged.customer_name||"").split(/\s+/)[0]} for the delivery address. Explain you need it to give an accurate quote based on their location`
  } else if (!mHas("material_purpose") && !mHas("material_type")) {
    instruction = "Ask what they're using the material for. Explain this helps you recommend the right type of dirt for their project. Be genuinely curious about their project"
  } else if (!mHas("material_type")) {
    instruction = `Customer said they need dirt for: "${merged.material_purpose}". Based on your knowledge, recommend the right material type (fill dirt, structural fill, screened topsoil, or sand). Explain briefly why that material is right for their project. Then ask how many cubic yards they need, and offer to help calculate if they're not sure`
  } else if (!mHas("yards_needed")) {
    if (/don.?t know|not sure|no idea|how much|figure|calculate|dimensions|measure/i.test(lower)) {
      instruction = "Customer doesn't know how many yards. Ask them for the dimensions of the area — length, width and depth in feet. Tell them you'll calculate it for them"
      updates.state = "ASKING_DIMENSIONS"
    } else {
      instruction = `Ask how many cubic yards of ${fmtMaterial(merged.material_type)} they need. If they're not sure, you can help calculate from dimensions (length × width × depth in feet)`
    }
  } else if (!mHas("access_type")) {
    // Parse access from current message if possible
    if (/18|eighteen|wheeler|semi|both|all/i.test(lower)) {
      updates.access_type = "dump_truck_and_18wheeler"
      // Skip ahead — don't ask again, move to date
      if (!mHas("delivery_date")) {
        instruction = "Got it, they have access for both. Now ask about their timeline — do they need it by a specific date or are they flexible"
      }
    } else if (/just.*dump|dump.*only|no.*18|no.*eighteen|only dump/i.test(lower)) {
      updates.access_type = "dump_truck_only"
      if (!mHas("delivery_date")) {
        instruction = "Got it, dump trucks only. Now ask about their timeline — do they need it by a specific date or are they flexible"
      }
    } else {
      instruction = "Ask if their property has access for dump trucks and 18 wheelers, or just dump trucks. This matters for what size truck you send"
    }
  } else if (!mHas("delivery_date")) {
    instruction = "Ask about their timeline. Do they need it by a specific date or are they flexible with delivery? Knowing this helps with scheduling"
  } else {
    // ALL INFO COLLECTED — get dual quote (standard + priority from quarries)
    const dualQuote = await getDualQuote(
      merged.customer_name || "",
      merged.delivery_lat, merged.delivery_lng,
      merged.delivery_city || "",
      merged.material_type || "fill_dirt",
      merged.yards_needed || MIN_YARDS,
      merged.access_type || "dump_truck_only",
      merged.delivery_date || undefined,
    )
    if (dualQuote) {
      updates.price_per_yard_cents = dualQuote.standard.perYardCents
      updates.total_price_cents = dualQuote.standard.totalCents
      updates.zone = dualQuote.standard.zone
      updates.state = "QUOTING"
      instruction = `Present this quote exactly: ${dualQuote.formatted}`
    } else {
      instruction = "Unfortunately their delivery address is outside your service area (more than 60 miles from your yards in Dallas, Fort Worth or Denver). Let them know and ask if there's another address"
      updates.state = "COLLECTING"
      updates.delivery_address = null
      updates.delivery_city = null
      updates.delivery_lat = null
      updates.delivery_lng = null
      updates.distance_miles = null
      updates.zone = null
    }
  }

  // Special state: waiting for dimensions
  if (state === "ASKING_DIMENSIONS" || updates.state === "ASKING_DIMENSIONS") {
    if (inlineDims) {
      const yards = cubicYards(inlineDims.l, inlineDims.w, inlineDims.d)
      updates.yards_needed = yards
      updates.dimensions_raw = body.trim()
      updates.state = "COLLECTING"
      instruction = `They gave dimensions. That comes out to about ${yards} cubic yards. Now ask if their property has access for dump trucks and 18 wheelers, or just dump trucks`
    } else {
      // Check for partial dimensions (2 numbers)
      const nums = body.match(/(\d+\.?\d*)/g)
      if (nums && nums.length === 2) {
        instruction = "They gave two measurements but you need three — length, width AND depth in feet. Ask for the missing one"
      } else if (nums && nums.length === 1) {
        instruction = "They gave one number. Ask for all three measurements — length, width and depth in feet"
      } else {
        instruction = "Ask for the dimensions — length, width and depth in feet. Something like 20 x 40 x 6. You'll calculate the cubic yards for them"
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
