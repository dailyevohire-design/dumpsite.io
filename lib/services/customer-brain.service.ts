import Anthropic from "@anthropic-ai/sdk"
import { createAdminSupabase } from "../supabase"
import twilio from "twilio"

const anthropic = new Anthropic()
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const CUSTOMER_FROM = process.env.CUSTOMER_TWILIO_NUMBER!
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")
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
  { zone: "A", min: 0, max: 20, base: 2200 },
  { zone: "B", min: 20, max: 40, base: 2500 },
  { zone: "C", min: 40, max: 60, base: 3000 },
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
  if (!key) return null
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`)
    const d = await r.json()
    if (d.status === "OK" && d.results[0]) {
      const loc = d.results[0].geometry.location
      const city = d.results[0].address_components?.find((c: any) => c.types.includes("locality"))?.long_name || ""
      return { lat: loc.lat, lng: loc.lng, city }
    }
  } catch {}
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
}

async function createDispatchOrder(conv: any, phone: string): Promise<string | null> {
  try {
    const sb = createAdminSupabase()
    const { data } = await sb.from("dispatch_orders").insert({
      client_phone: phone, client_name: conv.customer_name || "Customer",
      client_address: conv.delivery_address, yards_needed: conv.yards_needed || MIN_YARDS,
      price_quoted_cents: conv.total_price_cents,
      driver_pay_cents: Math.round((conv.price_per_yard_cents || 2200) * 0.5 * (conv.yards_needed || MIN_YARDS)),
      status: "open",
      notes: `${fmtMaterial(conv.material_type || "fill_dirt")} | ${conv.access_type || "dump truck"} access | ${conv.delivery_date || "Flexible"} | Source: FillDirtNearMe SMS`,
    }).select("id").single()
    return data?.id || null
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
- Match their energy — casual customer gets casual Sarah, professional contractor gets professional Sarah.
- Ask one thing at a time. Never stack questions.
- If they tell you something unexpected, respond to THAT before moving forward.
- If they ask a question, ANSWER IT before asking your next question.

WHAT YOU KNOW ABOUT DIRT:
- Fill Dirt: clean, general purpose. Leveling, grading, filling holes, backfill behind retaining walls, general site prep. Most affordable. $22-30/yard depending on distance.
- Structural Fill: engineered to compact. Foundations, slabs, driveways, pool fills, anything that needs a solid stable base underneath. Slightly more at $30-38/yard.
- Screened Topsoil: nutrient-rich, great for growing things. Gardens, landscaping, sod prep, raised beds, lawn repair. $27-35/yard.
- Sand: play areas, sandboxes, septic systems, drainage. $28-36/yard.
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
  for (const p of ["i am an ai","i'm an ai","language model","claude","anthropic","i am a bot","i'm a bot"]) {
    if (r.toLowerCase().includes(p)) return "This is Sarah with Fill Dirt Near Me, how can I help"
  }
  if (r.length > 400) r = r.split(/[.!?\n]/).filter(s => s.trim().length > 5).slice(0, 3).join(". ").trim()
  // Remove trailing period
  r = r.replace(/\.\s*$/, "").trim()
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
  await logMsg(phone, body || "[empty]", "inbound", sid)

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
  const isYes = /^(yes|yeah|yep|sure|ok|okay|lets do it|sounds good|perfect|go ahead|book it|schedule|please|absolutely|definitely|si|dale|do it|im down|im in|ready|set it up)$/i.test(lower)
  const isNo = /^(no|nah|nope|too much|expensive|pass|never mind|cancel|not now|not interested)$/i.test(lower)
  const isCancel = /cancel|refund|money back/i.test(lower)
  const isStatus = /status|update|where|when.*deliver|order|tracking|driver|eta|how long/i.test(lower)
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

  // ── PAYMENT FLOW ──
  if (state === "AWAITING_PAYMENT") {
    if (isPaymentConfirm) {
      updates.payment_status = "confirming"
      updates.state = "ORDER_PLACED"
      const orderId = await createDispatchOrder({ ...conv, ...updates }, phone)
      if (orderId) {
        updates.dispatch_order_id = orderId
        const yards = conv.yards_needed || MIN_YARDS
        await notifyAdmin(`New order: ${conv.customer_name} | ${yards}yds ${fmtMaterial(conv.material_type||"fill_dirt")} | ${conv.delivery_city} | ${fmt$(conv.total_price_cents||0)} | ${conv.payment_method}`, sid)
        if (yards >= LARGE_ORDER) await notifyAdmin(`⚠️ LARGE ORDER ${yards}yds — ${conv.customer_name} ${conv.delivery_city}`, sid)
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
    } else if (/cash|check|cheque/i.test(lower)) {
      const s = await callSarah(body, conv, history, "They want to pay cash or check. Explain that unfortunately you can only accept Zelle or Venmo. Your drivers are independently insured contractors and for insurance and liability reasons cash and check cant be accepted at delivery. Ask which works, Zelle or Venmo")
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
  // Code figures out what's missing, extracts data, gives Sonnet instructions

  // Try to extract data from whatever they said
  if (needName && body.trim().length < 40 && !isAddress && !/\d{3}/.test(body)) {
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
  } else if (!mHas("material_purpose")) {
    instruction = "Ask what they're using the material for. Explain this helps you recommend the right type of dirt for their project. Be genuinely curious about their project"
  } else if (!mHas("material_type")) {
    // Purpose given but material not auto-detected
    instruction = `Customer said they need dirt for: "${merged.material_purpose}". Based on your knowledge, recommend the right material type (fill dirt, structural fill, screened topsoil, or sand). Explain briefly why that material is right for their project. Then ask how many cubic yards they need, and offer to help calculate if they're not sure`
  } else if (!mHas("yards_needed")) {
    // Check if they said "I don't know"
    if (/don.?t know|not sure|no idea|how much|figure|calculate|dimensions|measure/i.test(lower)) {
      instruction = "Customer doesn't know how many yards. Ask them for the dimensions of the area — length, width and depth in feet. Tell them you'll calculate it for them"
      updates.state = "ASKING_DIMENSIONS"
    } else {
      instruction = `Ask how many cubic yards of ${fmtMaterial(merged.material_type)} they need. If they're not sure, you can help calculate from dimensions (length × width × depth in feet)`
    }
  } else if (!mHas("access_type")) {
    instruction = "Ask if their property has access for dump trucks and 18 wheelers, or just dump trucks. This matters for what size truck you send"
  } else if (!mHas("delivery_date")) {
    instruction = "Ask about their timeline. Do they need it by a specific date or are they flexible with delivery? Knowing this helps with scheduling"
  } else {
    // ALL INFO COLLECTED — generate quote
    const quote = calcQuote(merged.distance_miles || 0, merged.material_type || "fill_dirt", merged.yards_needed || MIN_YARDS)
    if (quote) {
      updates.price_per_yard_cents = quote.perYardCents
      updates.total_price_cents = quote.totalCents
      updates.state = "QUOTING"
      const firstName = (merged.customer_name || "").split(/\s+/)[0]
      instruction = `All info collected! Give ${firstName} their quote: ${quote.billable} yards of ${fmtMaterial(merged.material_type||"")} delivered to ${merged.delivery_city||"their location"} comes to ${fmt$(quote.totalCents)} (${fmt$(quote.perYardCents)}/yard). Ask if they'd like to get that scheduled. Sound excited to help them`
    } else {
      instruction = "Unfortunately their delivery address is outside your service area (more than 60 miles from your yards in Dallas, Fort Worth or Denver). Let them know and ask if there's another address"
      updates.state = "COLLECTING"
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
    } else if (/\d/.test(body)) {
      instruction = "They gave some numbers but you need length, width AND depth in feet. Ask for the missing dimension"
    } else {
      instruction = "Ask for the dimensions — length, width and depth in feet. You'll calculate the cubic yards for them"
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
