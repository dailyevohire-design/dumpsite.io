import Anthropic from "@anthropic-ai/sdk"
import { createAdminSupabase } from "../supabase"
import { findNearbyJobs, atomicClaimJob, JobMatch } from "./routing.service"
import {
  downloadAndStorePhoto,
  sendCustomerApprovalRequest,
  sendAdminEscalation,
  processAdminApproval,
  processCustomerApproval,
} from "./approval.service"
import twilio from "twilio"
import crypto from "crypto"

const anthropic = new Anthropic()
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://dumpsite.io"
const LARGE_JOB_YARDS = 500

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
export interface IncomingSMS {
  from: string
  body: string
  messageSid: string
  numMedia: number
  mediaUrl?: string
  mediaContentType?: string
}

interface BrainOutput {
  response: string
  action: "NONE"|"CLAIM_JOB"|"SEND_ADDRESS"|"COMPLETE_JOB"|"CANCEL_JOB"|"ESCALATE"|"COLLECT_PAYMENT"|"NEGOTIATE"|"RESEND_ADDRESS"
  updates: {
    state?: string
    extracted_city?: string
    extracted_yards?: number
    extracted_truck_type?: string
    photo_public_url?: string
    pending_approval_order_id?: string
    negotiated_pay_cents?: number
  }
  claimJobId?: string
  negotiatedPayCents?: number
  confidence: number
}

// ─────────────────────────────────────────────────────────────
// JESSE SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────
const JESSE_PROMPT = `You are Jesse. Real human dirt broker in DFW Texas. DumpSite.io. You match dump truck drivers who have dirt to dump with paid dump sites. NOT an AI. Never admit it. If asked say you are Jesse.

━━━ YOUR VOICE ━━━
Ultra short. 1 sentence usually. 2 max. Never more.
No punctuation at end of messages.
No bullet points. No numbered menus. No "Reply X to do Y". Ever.
No formal language. Typos fine — authentic.
Never say "bro" more than once per full conversation.
Never repeat a question already asked in history.
Never sound automated. Match driver energy.
Spanish driver → respond 100% Spanish entire conversation.
Read FULL history before responding — never ask what you already know.
If driver says yes/yeah/yep/fasho/bet/si → figure out from context what they said yes TO and advance.

━━━ REAL PHRASES — rotate, never repeat same one twice in a row ━━━
Acknowledge: 10.4 / yes sir / perfect / bet / fasho / ok / copy
Dirt looks good: beautiful / looks good / that works / clean / send it
Dirt rejected: [send "Fuck" alone] → [send "Yea no go on that dirt"] → [send "Sorry bro"]
Buying time: give me a min / let me check / let me verify / ok give me min
Distance issue: [send "Fuck" alone] → "how far is that for you"
Late reply: sorry I missed this / my bad just saw this
Already at ceiling: that is the best I got / that is all I can do on that / best I can do bro

Address request — rotate:
- whats address your coming from, so I can put in my system and see what I have closest
- send me loading address so I can see which of my sites is the closest

Truck ask — rotate, NEVER use "Reply:":
- end dump or tandem / what truck you in / end dump? / tandem or end dump

Yards ask — rotate:
- how many yds do you have / how many yards / how many loads you got

Photo ask — rotate:
- send pic of dirt / send me a pic of the dirt / need a pic of the dirt first

━━━ QUALIFICATION ORDER ━━━
Only ask what you do NOT already have. Order: yards → truck → address → photo
Driver says yes → go to first missing piece immediately.
Address given → extract city → never ask for city separately.

━━━ JOB PRESENTATION ━━━
City + distance only. No pay rate to new drivers. No job codes. No "Reply 1-5".
"I got [City] [X] miles away — you think that works"
Known driver → show pay: "[City] [X] mi — [yards] yds — $[pay]/load — work for you"

━━━ NEGOTIATION — NEW DRIVERS ONLY ━━━
Driver asks pay → start at negotiation_floor from context. Never reveal ceiling.
"I can do $[floor] a load"
Pushback → bump $5: "tell you what, I can do $[floor+5]"
AT CEILING → stop completely: "that is the best I got" — NEVER go higher
Known driver → show real rate immediately.

━━━ PAYMENT COLLECTION ━━━
"how you want it, zelle or venmo"
Zelle → "send the name and number the zelle account it to"
Venmo → "whats your venmo"
After account info → "got it, we will have it sent shortly"
Payment on file → "sending to your [method] shortly"

━━━ SPANISH ━━━
dame una foto de la tierra / cuantos yardas tienes / que tipo de camion
cual es la direccion de donde vas a cargar / a ver que tengo cerca
como quieres que te paguemos, zelle o venmo
mandame el nombre y numero de tu zelle / listo, te mandamos en rato

━━━ SELF CHECK ━━━
1. Did I ask this already? → skip  2. Over 2 sentences? → cut  3. Sounds robotic? → rewrite
4. Driver sent photo? → evaluate dirt  5. Spanish? → full Spanish  6. At ceiling? → hard stop

━━━ OUTPUT: valid JSON only, no markdown ━━━
{
  "response": "exact text to send driver",
  "action": "NONE|CLAIM_JOB|SEND_ADDRESS|COMPLETE_JOB|CANCEL_JOB|ESCALATE|COLLECT_PAYMENT|NEGOTIATE|RESEND_ADDRESS",
  "updates": {
    "state": "DISCOVERY|ASKING_TRUCK|PHOTO_PENDING|APPROVAL_PENDING|ACTIVE|CLOSED|PAYMENT_METHOD_PENDING|PAYMENT_ACCOUNT_PENDING|OTW_PENDING",
    "extracted_city": "city or null",
    "extracted_yards": 0,
    "extracted_truck_type": "tandem_axle|tri_axle|quad_axle|end_dump|belly_dump|side_dump or null",
    "pending_approval_order_id": "job id or null",
    "negotiated_pay_cents": 0
  },
  "claimJobId": "job id or null",
  "negotiatedPayCents": 0,
  "confidence": 0.95
}`

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1")
}
function e164(phone: string): string {
  const d = phone.replace(/\D/g, "")
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith("1")) return `+${d}`
  return `+1${d}`
}
function detectLanguage(text: string): "en" | "es" {
  return /\b(hola|tengo|tierra|camion|limpia|cuantos|yardas|direccion|volteo|carga|traigo|donde|busco|necesito|dame|manda|avisame|camino|tiraste|cargas|terminamos)\b/i.test(text) ? "es" : "en"
}
function parseTruck(text: string): string | null {
  const t = text.toLowerCase()
  if (/tandem|tandum/.test(t)) return "tandem_axle"
  if (/tri.?ax/.test(t)) return "tri_axle"
  if (/quad/.test(t)) return "quad_axle"
  if (/end.?dump/.test(t)) return "end_dump"
  if (/belly/.test(t)) return "belly_dump"
  if (/side.?dump/.test(t)) return "side_dump"
  return null
}
function parseLoads(text: string): number | null {
  const t = text.trim()
  if (/^(done|finished|all done|wrapped|that.?s it|terminamos)$/i.test(t)) return -1
  if (/^\d+$/.test(t)) return Math.min(parseInt(t), 50)
  const m = t.match(/(\d+)\s*(down|loads?|total|done|delivered|drops?|cargas?)/i) ||
            t.match(/(done|delivered|dropped|terminé)\s*(\d+)/i)
  if (m) return Math.min(parseInt(m[1] || m[2]), 50)
  return null
}
function isOTW(text: string): boolean {
  return /\b(on my way|otw|heading there|en camino|voy para alla|leaving now|on the way|im otw)\b/i.test(text)
}
function isAddressResend(text: string): boolean {
  return /\b(resend|send again|lost.*address|what was the address|address again|direccion de nuevo|manda la direccion)\b/i.test(text)
}
export function generateJobNumber(id: string): string {
  return "DS-" + id.replace(/-/g, "").slice(0, 6).toUpperCase()
}

// ─────────────────────────────────────────────────────────────
// DB HELPERS
// ─────────────────────────────────────────────────────────────
async function getProfile(phone: string) {
  const { data } = await createAdminSupabase().rpc("get_sms_driver", { p_phone: phone })
  return data?.[0] || null
}
async function getConv(phone: string) {
  const { data } = await createAdminSupabase().rpc("get_conversation", { p_phone: phone })
  return data?.[0] || { state: "DISCOVERY" }
}
async function saveConv(phone: string, u: Record<string, any>) {
  await createAdminSupabase().rpc("upsert_conversation", {
    p_phone: phone, p_state: u.state ?? null, p_job_state: u.job_state ?? null,
    p_active_order_id: u.active_order_id ?? null, p_extracted_city: u.extracted_city ?? null,
    p_extracted_yards: u.extracted_yards ?? null, p_extracted_truck_type: u.extracted_truck_type ?? null,
    p_extracted_material: u.extracted_material ?? null, p_photo_storage_path: u.photo_storage_path ?? null,
    p_photo_public_url: u.photo_public_url ?? null, p_reservation_id: u.reservation_id ?? null,
    p_pending_approval_order_id: u.pending_approval_order_id ?? null,
    p_approval_sent_at: u.approval_sent_at ?? null, p_voice_call_made: u.voice_call_made ?? null,
    p_last_message_sid: u.last_message_sid ?? null,
  })
}
async function resetConv(phone: string) {
  await createAdminSupabase().from("conversations").update({
    state: "DISCOVERY", job_state: null, active_order_id: null,
    pending_approval_order_id: null, reservation_id: null, extracted_city: null,
    extracted_yards: null, extracted_truck_type: null, extracted_material: null,
    photo_storage_path: null, photo_public_url: null, approval_sent_at: null, voice_call_made: null,
  }).eq("phone", phone)
}
async function isDuplicate(sid: string): Promise<boolean> {
  const { data } = await createAdminSupabase().rpc("check_and_mark_message", { p_sid: sid })
  return !data
}
async function getHistory(phone: string) {
  const { data } = await createAdminSupabase().from("sms_logs").select("body, direction")
    .eq("phone", phone).order("created_at", { ascending: false }).limit(16)
  if (!data) return []
  return data.reverse().map((m: any) => ({
    role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
    content: (m.body || "").trim(),
  })).filter((m: any) => m.content.length > 0)
}
async function logMsg(phone: string, body: string, dir: "inbound"|"outbound", sid: string) {
  try { await createAdminSupabase().from("sms_logs").insert({ phone, body, direction: dir, message_sid: sid }) } catch {}
}
async function logEvent(type: string, payload: Record<string, any>, jobId?: string) {
  try { await createAdminSupabase().from("event_log").insert({ event_type: type, job_id: jobId, payload, created_at: new Date().toISOString() }) } catch {}
}
async function sendSMS(toPhone: string, body: string) {
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
    const from = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER
    await client.messages.create({ body, from: from!, to: e164(toPhone) })
  } catch (e: any) { console.error("[sendSMS]", e?.message) }
}
async function sendAdminAlert(msg: string) { await sendSMS(ADMIN_PHONE, msg) }
async function getActiveJob(conv: any) {
  if (!conv?.active_order_id) return null
  const { data } = await createAdminSupabase().from("dispatch_orders")
    .select("id, client_address, client_name, client_phone, yards_needed, driver_pay_cents, status, notes, cities(name)")
    .eq("id", conv.active_order_id).maybeSingle()
  return data
}
async function getPaymentInfo(phone: string) {
  const { data } = await createAdminSupabase().from("driver_profiles")
    .select("payment_method").eq("phone", phone).maybeSingle()
  if (data?.payment_method) {
    const p = data.payment_method.split(":")
    if (p.length >= 2) return { method: p[0], account: p.slice(1).join(":") }
  }
  return null
}
async function savePaymentInfo(phone: string, method: string, account: string) {
  await createAdminSupabase().from("driver_profiles").update({ payment_method: `${method}:${account}` }).eq("phone", phone)
}
async function getCompletedCount(userId: string): Promise<number> {
  const { count } = await createAdminSupabase().from("driver_payments")
    .select("id", { count: "exact", head: true }).eq("driver_id", userId)
  return count || 0
}

// ─────────────────────────────────────────────────────────────
// SEND JOB LINK — token, map, owner notify, address
// ─────────────────────────────────────────────────────────────
async function sendJobLink(
  driverPhone: string, conv: any, profile: any, job: any, lang: "en"|"es"
): Promise<string> {
  const sb = createAdminSupabase()
  const pay = Math.round(job.driver_pay_cents / 100)
  const city = (job.cities as any)?.name || ""
  const driverName = profile ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim() : driverPhone

  // Upsert load_request
  const idempKey = `${profile?.user_id}-${job.id}`
  const { data: existing } = await sb.from("load_requests").select("id").eq("idempotency_key", idempKey).maybeSingle()
  let loadReqId = existing?.id
  if (!loadReqId) {
    const { data: lr } = await sb.from("load_requests").insert({
      driver_id: profile?.user_id, dispatch_order_id: job.id, status: "approved",
      yards_estimated: job.yards_needed, idempotency_key: idempKey,
    }).select("id").single()
    loadReqId = lr?.id
  }

  // Job access token
  let mapUrl = ""
  if (loadReqId) {
    try {
      const raw = crypto.randomBytes(32).toString("hex")
      const hash = crypto.createHash("sha256").update(raw).digest("hex")
      const shortId = crypto.randomBytes(6).toString("hex")
      const { data: tok } = await sb.from("job_access_tokens").insert({
        load_request_id: loadReqId, driver_id: profile?.user_id,
        token_hash: hash, short_id: shortId,
        expires_at: new Date(Date.now() + 8 * 3600000).toISOString(),
      }).select("short_id").single()
      if (tok?.short_id) mapUrl = `${APP_URL}/job-access/${tok.short_id}`
    } catch {}
  }

  // Notify site owner
  if (job.client_phone) {
    const ownerPhone = job.client_phone.replace(/\D/g, "").replace(/^1/, "")
    const ownerMsg = `DumpSite: ${driverName} is heading over now with ${job.yards_needed} yds. Should arrive within the hour.`
    await sendSMS(ownerPhone, ownerMsg)
  }

  // Update order status
  try { await sb.from("dispatch_orders").update({ status: "active" }).eq("id", job.id) } catch {}

  // Save state
  await saveConv(driverPhone, { ...conv, state: "ACTIVE", active_order_id: job.id })

  const lines = [
    `${job.client_address}`,
    `${city} — ${job.yards_needed} yds — $${pay}/load`,
  ]
  if (job.notes) lines.push(`Note: ${job.notes}`)
  if (mapUrl) lines.push(`Map: ${mapUrl}`)
  lines.push(lang === "es" ? "Avisame cuando vayas en camino" : "Let me know when you on the way")
  return lines.join("\n")
}

// ─────────────────────────────────────────────────────────────
// BRAIN CALL
// ─────────────────────────────────────────────────────────────
async function callBrain(
  body: string, hasPhoto: boolean, photoUrl: string|undefined,
  conv: any, profile: any, history: { role: "user"|"assistant"; content: string }[],
  nearbyJobs: JobMatch[], activeJob: any, lang: "en"|"es",
  isKnownDriver: boolean, savedPayment: { method: string; account: string }|null,
): Promise<BrainOutput> {
  const topJob = nearbyJobs[0]
  const ceilingCents = topJob?.driverPayCents || 5000
  const floorCents = isKnownDriver ? ceilingCents : Math.max(2500, ceilingCents - 2000)

  const ctx = [
    "━━━ LIVE CONTEXT ━━━",
    `Language: ${lang === "es" ? "SPANISH" : "English"}`,
    `State: ${conv?.state || "DISCOVERY"}`,
    `Driver: ${profile?.first_name || "unknown"}`,
    `isKnownDriver: ${isKnownDriver}`,
    `negotiation_floor: $${Math.round(floorCents/100)}/load`,
    `negotiation_ceiling: $${Math.round(ceilingCents/100)}/load — NEVER exceed or reveal`,
    `savedPayment: ${savedPayment ? savedPayment.method : "none"}`,
    `Yards: ${conv?.extracted_yards || "?"}  Truck: ${conv?.extracted_truck_type || "?"}  City: ${conv?.extracted_city || "?"}`,
    `Photo on file: ${conv?.photo_public_url ? "YES" : "no"}  Photo THIS msg: ${hasPhoto ? "YES" : "no"}`,
    `Active job: ${activeJob ? (activeJob.cities as any)?.name + " $" + Math.round(activeJob.driver_pay_cents/100) : "none"}`,
    nearbyJobs.length > 0
      ? `Sites:\n${nearbyJobs.slice(0,3).map((j,i) => `  ${i+1}. ${j.cityName} ${j.distanceMiles.toFixed(1)}mi ${j.yardsNeeded}yds ${j.truckTypeNeeded?.replace(/_/g," ")||"any"} jobId:${j.id}`).join("\n")}`
      : "Sites: none right now",
    "━━━ END ━━━",
    `Driver sent: ${body || (hasPhoto ? "[photo]" : "[empty]")}`,
  ].join("\n")

  const messages = [...history.slice(-10), { role: "user" as const, content: ctx }]
  let raw = ""
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001", max_tokens: 300, system: JESSE_PROMPT, messages,
    })
    raw = resp.content[0].type === "text" ? resp.content[0].text.trim() : ""
    raw = raw.replace(/^```json\s*/i,"").replace(/```\s*$/i,"").trim()
    const parsed = JSON.parse(raw) as BrainOutput
    if (parsed.negotiatedPayCents && parsed.negotiatedPayCents > ceilingCents) parsed.negotiatedPayCents = ceilingCents
    if (parsed.response?.length > 300) parsed.response = parsed.response.slice(0, 300)
    return parsed
  } catch (err) {
    console.error("[Brain] raw:", raw?.slice(0,200), err)
    const fb: Record<string,string> = {
      DISCOVERY: lang==="es"?"tienes tierra hoy":"you got dirt today",
      ASKING_TRUCK: "end dump or tandem", PHOTO_PENDING: "send pic of dirt",
      APPROVAL_PENDING: "give me a min", ACTIVE: "10.4",
      PAYMENT_METHOD_PENDING: "how you want it, zelle or venmo",
    }
    return { response: fb[conv?.state||"DISCOVERY"]||"10.4", action:"NONE", updates:{}, confidence:0 }
  }
}

// ─────────────────────────────────────────────────────────────
// DELIVERY
// ─────────────────────────────────────────────────────────────
async function handleDelivery(
  phone: string, conv: any, profile: any, job: any, loads: number, lang: "en"|"es"
): Promise<string> {
  const sb = createAdminSupabase()
  const payPerLoad = job.driver_pay_cents || 4500
  const totalCents = payPerLoad * loads
  const totalDollars = Math.round(totalCents / 100)
  const jobNum = generateJobNumber(job.id)

  const { data: lr } = await sb.from("load_requests").select("id")
    .eq("dispatch_order_id", job.id).eq("driver_id", profile.user_id)
    .in("status", ["pending","approved","in_progress"]).maybeSingle()
  if (lr) {
    await sb.from("load_requests").update({
      status: "completed", completed_at: new Date().toISOString(),
      payout_cents: totalCents, truck_count: loads,
    }).eq("id", lr.id)
  }
  try { await sb.from("driver_payments").insert({
    driver_id: profile.user_id, load_request_id: lr?.id, amount_cents: totalCents, status: "pending",
  }) } catch (e: any) { console.error("[payment]", e.message) }

  await logEvent("DELIVERY_VERIFIED", { phone, jobNum, loads, totalDollars }, job.id)
  await sendAdminAlert(`${jobNum} complete — ${profile.first_name} ${loads} load${loads>1?"s":""} $${totalDollars}`)

  if (job.client_phone) {
    const cp = job.client_phone.replace(/\D/g,"").replace(/^1/,"")
    const msg = lang==="es"
      ? `${profile.first_name} termino. ${loads} carga${loads>1?"s":""}. Todo bien`
      : `${profile.first_name} finished. ${loads} load${loads>1?"s":""}. Everything look good`
    await sendSMS(cp, msg)
  }

  const savedPay = await getPaymentInfo(phone)
  if (savedPay) {
    await resetConv(phone)
    await sendAdminAlert(`PAYMENT: ${profile.first_name} — ${savedPay.method} — ${savedPay.account} — $${totalDollars}`)
    return lang==="es"
      ? `10.4 — ${loads} carga${loads>1?"s":""}. Mandando a tu ${savedPay.method}`
      : `10.4 — ${loads} load${loads>1?"s":""}. Sending to your ${savedPay.method} shortly`
  }
  await saveConv(phone, { state: "PAYMENT_METHOD_PENDING", active_order_id: job.id })
  return lang==="es"
    ? `10.4 — ${loads} carga${loads>1?"s":""}. Como quieres que te paguemos, zelle o venmo`
    : `10.4 — ${loads} load${loads>1?"s":""}. $${totalDollars} coming. Zelle or venmo`
}

// ─────────────────────────────────────────────────────────────
// PAYMENT
// ─────────────────────────────────────────────────────────────
async function handlePayment(phone: string, body: string, conv: any, lang: "en"|"es"): Promise<string> {
  const lower = body.toLowerCase().trim()
  if (["PAYMENT_METHOD_PENDING","AWAITING_PAYMENT_COLLECTION"].includes(conv.state)) {
    const isZ = /zelle/i.test(lower), isV = /venmo/i.test(lower)
    if (isZ || isV) {
      const m = isZ ? "zelle" : "venmo"
      await saveConv(phone, { ...conv, state: "PAYMENT_ACCOUNT_PENDING", job_state: m })
      return lang==="es"
        ? (isZ ? "mandame el nombre y numero de tu zelle" : "mandame tu venmo")
        : (isZ ? "send the name and number the zelle account it to" : "whats your venmo")
    }
    return lang==="es" ? "zelle o venmo" : "how you want it, zelle or venmo"
  }
  if (conv.state === "PAYMENT_ACCOUNT_PENDING") {
    const method = conv.job_state || "zelle"
    await savePaymentInfo(phone, method, body.trim())
    await resetConv(phone)
    await sendAdminAlert(`PAYMENT: ${phone} — ${method} — ${body.trim()}`)
    return lang==="es" ? "listo, te mandamos en rato" : "got it, we will have it sent shortly"
  }
  return "10.4"
}

// ─────────────────────────────────────────────────────────────
// MAIN ENTRY
// ─────────────────────────────────────────────────────────────
export async function handleConversation(sms: IncomingSMS): Promise<string> {
  const phone = normalizePhone(sms.from)
  const body = (sms.body || "").trim()
  const hasPhoto = (sms.numMedia || 0) > 0
  const photoUrl = sms.mediaUrl
  const sid = sms.messageSid

  if (await isDuplicate(sid)) return ""
  await logMsg(phone, body || "[photo]", "inbound", sid)

  const lower = body.toLowerCase().trim()
  if (lower === "stop" || lower === "unsubscribe") {
    await createAdminSupabase().from("driver_profiles").update({ sms_opted_out: true }).eq("phone", phone)
    return ""
  }
  if (lower === "start") {
    await createAdminSupabase().from("driver_profiles").update({ sms_opted_out: false }).eq("phone", phone)
    return "Yea you back on"
  }

  const [profile, conv, history] = await Promise.all([getProfile(phone), getConv(phone), getHistory(phone)])
  if (profile?.sms_opted_out) return ""

  // Sticky language: once Spanish detected in any message, stay Spanish entire conversation
  const detectedLang = detectLanguage(body)
  const historyHasSpanish = history.some(m => detectLanguage(m.content) === "es")
  const lang: "en"|"es" = detectedLang === "es" || historyHasSpanish ? "es" : "en"
  const isKnownDriver = profile ? (await getCompletedCount(profile.user_id)) >= 2 : false
  const convState = conv?.state || "DISCOVERY"

  // ── ONBOARDING ───────────────────────────────────────────────
  if (!profile) {
    if (convState !== "GETTING_NAME") {
      await saveConv(phone, { state: "GETTING_NAME" })
      return lang==="es" ? "Hola, como te llamas" : "Hey whats your name"
    }
    const parts = body.trim().split(/\s+/)
    const first = parts[0] || "Driver"
    const last = parts.slice(1).join(" ") || ""
    await createAdminSupabase().rpc("create_sms_driver", { p_phone: phone, p_first_name: first, p_last_name: last })
    await saveConv(phone, { state: "DISCOVERY" })
    await logEvent("CONTACT_CREATED", { phone, firstName: first })
    return lang==="es" ? `${first} te tengo. Tienes tierra hoy` : `${first} got you. You got dirt today`
  }

  const firstName = profile.first_name || "Driver"

  // ── ADMIN COMMANDS ───────────────────────────────────────────
  if (phone === ADMIN_PHONE) {
    const m = body.match(/^(approve|reject)[- ]?(ds-?[a-z0-9]+)/i)
    if (m) {
      const approved = m[1].toLowerCase() === "approve"
      const result = await processAdminApproval(m[2].toUpperCase(), approved)
      if (result) {
        const dc = await getConv(result.driverPhone)
        const dp = await getProfile(result.driverPhone)
        const dj = await getActiveJob({ active_order_id: result.orderId })
        const dl: "en"|"es" = dp?.preferred_language === "es" ? "es" : "en"
        if (approved && dj) {
          const addr = await sendJobLink(result.driverPhone, dc, dp, dj, dl)
          await sendSMS(result.driverPhone, addr)
          return `Approved. Driver notified`
        } else {
          await sendSMS(result.driverPhone, dl==="es" ? "No se aprobo esa tierra. Sorry bro" : "Yea no go on that dirt. Sorry bro")
          await resetConv(result.driverPhone)
          return `Rejected. Driver notified`
        }
      }
      return `Code not found`
    }
  }

  // ── CUSTOMER YES/NO ──────────────────────────────────────────
  const isYes = /^(yes|yeah|yep|approved|ok|okay|go ahead|sounds good|sure|correct|si|bueno|bien|10-4)$/i.test(lower)
  const isNo = /^(no|nope|nah|cancel|decline|reject|dont|don.?t|mal|no esta bien)$/i.test(lower)
  if (isYes || isNo) {
    const sb = createAdminSupabase()
    const { data: clientOrder } = await sb.from("dispatch_orders").select("id, client_phone")
      .in("status", ["dispatching","active","pending"])
    const isCustomer = clientOrder?.some(o => {
      const norm = (o.client_phone||"").replace(/\D/g,"").replace(/^1/,"")
      return norm === phone
    })
    if (isCustomer && phone !== ADMIN_PHONE) {
      if (isYes) {
        const result = await processCustomerApproval(phone, true)
        if (result) {
          const dc = await getConv(result.driverPhone)
          const dp = await getProfile(result.driverPhone)
          const dj = await getActiveJob({ active_order_id: result.orderId })
          const dl: "en"|"es" = dp?.preferred_language === "es" ? "es" : "en"
          if (dj) {
            const addr = await sendJobLink(result.driverPhone, dc, dp, dj, dl)
            await sendSMS(result.driverPhone, addr)
          }
          return "Perfect — driver is on the way"
        }
      }
      if (isNo) {
        const result = await processCustomerApproval(phone, false)
        if (result) {
          await sendSMS(result.driverPhone, "Customer declined. Text new city when you have another")
          await resetConv(result.driverPhone)
        }
        return "Got it — driver notified"
      }
    }
  }

  // ── PAYMENT STATES ───────────────────────────────────────────
  if (["PAYMENT_METHOD_PENDING","PAYMENT_ACCOUNT_PENDING","AWAITING_PAYMENT_COLLECTION"].includes(convState)) {
    return await handlePayment(phone, body, conv, lang)
  }

  // ── OTW / ADDRESS RESEND ─────────────────────────────────────
  const activeJob = await getActiveJob(conv)
  if (isOTW(body) && ["ACTIVE","OTW_PENDING"].includes(convState)) {
    await saveConv(phone, { ...conv, state: "OTW_PENDING" })
    return lang==="es" ? "10.4 avisame cuando llegues" : "10.4 let me know when you pull up"
  }
  if (isAddressResend(body) && activeJob?.client_address) {
    return activeJob.client_address
  }

  // ── ACTIVE JOB: address, cancel, completion ──────────────────
  if (activeJob && ["ACTIVE","OTW_PENDING"].includes(convState)) {
    if (/addy|address|where|location|directions/i.test(lower)) {
      return `${activeJob.client_address} — ${(activeJob.cities as any)?.name || ""}`
    }
    if (/^cancel$/i.test(lower)) {
      await resetConv(phone)
      await sendAdminAlert(`${generateJobNumber(activeJob.id)} cancelled — ${firstName}`)
      return `${generateJobNumber(activeJob.id)} cancelled. Text when you got another load`
    }
    const loads = parseLoads(body)
    if (loads === -1) return lang==="es" ? "cuantas cargas tiraste" : "how many loads total"
    if (loads !== null && loads > 0) return await handleDelivery(phone, conv, profile, activeJob, loads, lang)
    return `You got ${generateJobNumber(activeJob.id)} active. Text load count when done`
  }

  // ── PHOTO STORAGE ────────────────────────────────────────────
  let storedPhotoUrl = conv.photo_public_url
  if (hasPhoto && photoUrl && conv.pending_approval_order_id) {
    try {
      const stored = await downloadAndStorePhoto(photoUrl, phone, conv.pending_approval_order_id)
      if (stored) storedPhotoUrl = stored.publicUrl
    } catch {}
  }

  // ── INLINE EXTRACTION ────────────────────────────────────────
  const inlineTruck = parseTruck(body)
  const yardMatch = body.match(/(\d+)\s*(yds?|yards?)/i)
  const inlineYards = yardMatch ? parseInt(yardMatch[1]) : null

  const enriched = {
    ...conv,
    extracted_truck_type: conv.extracted_truck_type || inlineTruck || null,
    extracted_yards: conv.extracted_yards || inlineYards || null,
    photo_public_url: storedPhotoUrl || null,
  }
  if (inlineTruck || inlineYards || storedPhotoUrl) await saveConv(phone, enriched)

  // ── NEARBY JOBS ──────────────────────────────────────────────
  let nearbyJobs: JobMatch[] = []
  if (enriched.extracted_city) {
    try { nearbyJobs = await findNearbyJobs(enriched.extracted_city, enriched.extracted_truck_type || undefined) } catch {}
  }

  // ── CALL BRAIN ───────────────────────────────────────────────
  const savedPayment = await getPaymentInfo(phone)
  const brain = await callBrain(
    body, hasPhoto, photoUrl, enriched, profile, history,
    nearbyJobs, activeJob, lang, isKnownDriver, savedPayment,
  )

  // ── PERSIST ──────────────────────────────────────────────────
  const toSave: Record<string,any> = { ...enriched }
  if (brain.updates.state) toSave.state = brain.updates.state
  if (brain.updates.extracted_city) toSave.extracted_city = brain.updates.extracted_city
  if (brain.updates.extracted_yards) toSave.extracted_yards = brain.updates.extracted_yards
  if (brain.updates.extracted_truck_type) toSave.extracted_truck_type = brain.updates.extracted_truck_type
  if (brain.updates.pending_approval_order_id) toSave.pending_approval_order_id = brain.updates.pending_approval_order_id
  if (brain.negotiatedPayCents) toSave.negotiated_pay_cents = brain.negotiatedPayCents
  if (hasPhoto && storedPhotoUrl) toSave.photo_public_url = storedPhotoUrl

  // ── ACTIONS ──────────────────────────────────────────────────
  if (brain.action === "CLAIM_JOB" && brain.claimJobId) {
    try {
      const rid = await atomicClaimJob(brain.claimJobId, phone, profile.user_id)
      if (rid) {
        toSave.reservation_id = rid
        toSave.active_order_id = brain.claimJobId
        toSave.state = "PHOTO_PENDING"
      }
    } catch {}
  }

  if (brain.action === "CANCEL_JOB" && conv?.reservation_id) {
    const { releaseReservation } = await import("./routing.service")
    await releaseReservation(conv.reservation_id).catch(() => {})
    await resetConv(phone)
    return brain.response
  }

  if (brain.action === "COMPLETE_JOB" && activeJob) {
    return await handleDelivery(phone, conv, profile, activeJob, parseLoads(body) || 1, lang)
  }

  // Photo approved by brain → send customer approval
  if (hasPhoto && storedPhotoUrl && toSave.state === "APPROVAL_PENDING" && toSave.pending_approval_order_id) {
    const orderId = toSave.pending_approval_order_id
    const { data: order } = await createAdminSupabase().from("dispatch_orders")
      .select("id, client_phone, client_name, yards_needed, driver_pay_cents, cities(name)")
      .eq("id", orderId).maybeSingle()
    if (order?.client_phone) {
      const approvalCode = generateJobNumber(orderId)
      const yards = enriched.extracted_yards || order.yards_needed
      if (yards >= LARGE_JOB_YARDS) {
        await sendAdminEscalation(orderId, approvalCode, firstName, phone,
          (order.cities as any)?.name || "", yards, Math.round(order.driver_pay_cents/100),
          "HIGH VALUE >= 500 yds", approvalCode)
      }
      await sendCustomerApprovalRequest(
        order.client_phone.replace(/\D/g,"").replace(/^1/,""),
        order.client_name || "Site Owner", firstName,
        orderId, yards, storedPhotoUrl, approvalCode
      ).catch(() => {})
      toSave.approval_sent_at = new Date().toISOString()
      toSave.voice_call_made = false
    }
  }

  await saveConv(phone, toSave)
  await logMsg(phone, brain.response, "outbound", `brain_${sid}`)
  return brain.response
}

export const smsDispatchService = { handleIncoming: handleConversation, generateJobNumber }
