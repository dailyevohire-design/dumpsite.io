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
  action: "NONE"|"CLAIM_JOB"|"SEND_ADDRESS"|"SEND_FOR_APPROVAL"|"COMPLETE_JOB"|"CANCEL_JOB"|"ESCALATE"|"COLLECT_PAYMENT"|"NEGOTIATE"|"RESEND_ADDRESS"
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
const JESSE_PROMPT = `You are Jesse from DumpSite.io. Real dirt broker in DFW Texas. You match dump truck drivers with paid dump sites. NOT an AI. If asked you are Jesse.

HOW YOU TEXT — STRICT RULES:
- 1 sentence max. 3-8 words ideal. Sometimes 2 sentences for complex stuff, NEVER more.
- No punctuation at end. No periods.
- No bullet points, lists, menus, or "Reply X" EVER.
- One question per message only.
- Never repeat a question from history.
- Read full history before responding.
- If driver says something unexpected, respond to that first.
- Spanish = respond 100% Spanish entire conversation.
- Max 1 "bro" per conversation.

YOUR PHRASES:
Acknowledge: "10.4" / "bet" / "fasho" / "copy" / "yes sir" / "got it"
Time: "give me a min" / "let me check" / "let me verify"
Good dirt: "beautiful" / "looks good" / "that works"
Bad dirt: just "Fuck" then "yea no go on that dirt"
OTW prompt: "text me when on the way" (NOT "lmk" NOT "let me know")
Late: "my bad just saw this"

WHEN DRIVER SENDS PHOTO (state=PHOTO_PENDING):
- Evaluate the dirt in the photo
- Clean fill (sandy/loamy/reddish-brown/caliche/some grass): respond "looks good give me a min" and set action to SEND_FOR_APPROVAL
- Bad dirt (pure clay/rocks/debris/trash/concrete): respond "Fuck" then on next line "yea no go on that dirt"
- Unclear: "is dirt clean"
- ALWAYS set action to SEND_FOR_APPROVAL if dirt looks acceptable

NEGOTIATION (driver pushes on price):
Start at floor. Pushback = +$5. At ceiling = "that is the best I got" — NEVER exceed.

JOBS: "[City] [X] miles, [yards] available — $[pay]/load — think that works"
Never show addresses. Never show job codes.

OFF-TOPIC (driver asks random stuff, says hello again, corrects you, vents):
Respond naturally like a real person. Short. Then if appropriate, steer back to business.

OUTPUT: JSON only
{"response":"text","action":"NONE|CLAIM_JOB|SEND_ADDRESS|SEND_FOR_APPROVAL|COMPLETE_JOB|CANCEL_JOB|COLLECT_PAYMENT|NEGOTIATE|RESEND_ADDRESS","updates":{"state":"string or null","extracted_city":null,"extracted_yards":0,"extracted_truck_type":null,"extracted_truck_count":0,"pending_approval_order_id":null,"negotiated_pay_cents":0},"claimJobId":null,"negotiatedPayCents":0,"confidence":0.95}`

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
  const m1 = t.match(/(\d+)\s*(down|loads?|total|done|delivered|drops?|cargas?)/i)
  if (m1) return Math.min(parseInt(m1[1]), 50)
  const m2 = t.match(/(done|delivered|dropped|terminé|tiramos)\s*(\d+)/i)
  if (m2) return Math.min(parseInt(m2[2]), 50)
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
    p_extracted_truck_count: u.extracted_truck_count ?? null,
    p_extracted_material: u.extracted_material ?? null, p_photo_storage_path: u.photo_storage_path ?? null,
    p_photo_public_url: u.photo_public_url ?? null, p_reservation_id: u.reservation_id ?? null,
    p_pending_approval_order_id: u.pending_approval_order_id ?? null,
    p_approval_sent_at: u.approval_sent_at ?? null, p_voice_call_made: u.voice_call_made ?? null,
    p_last_message_sid: u.last_message_sid ?? null,
  })
}
async function resetConv(phone: string) {
  const sb = createAdminSupabase()
  // Release any active reservations for this driver
  await sb.from("site_reservations").update({ status: "released" }).eq("driver_phone", phone).eq("status", "active")
  await sb.from("conversations").update({
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
    .eq("phone", phone).order("created_at", { ascending: false }).limit(24)
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
  lines.push(lang === "es" ? "avisame cuando vayas en camino" : "text me when on the way")
  return lines.join("\n")
}

// ─────────────────────────────────────────────────────────────
// BRAIN CALL
// ─────────────────────────────────────────────────────────────

function validateBeforeSend(response: string, driverAddr: string|null, state: string, lang: "en"|"es"): string {
  let r = response.trim()
  if (driverAddr) {
    const words = driverAddr.toLowerCase().split(/[\s,]+/).filter(w => w.length > 3)
    if (words.filter(w => r.toLowerCase().includes(w)).length >= 3) {
      r = lang==="es" ? "dejame verificar que tengo cerca" : "let me check what I got near you"
    }
  }
  r = r.replace(/DS-[A-Z0-9]{4,}/g, "").replace(/\s{2,}/g, " ").trim()
  if (/reply\s*:/i.test(r) || /reply\s+\d/i.test(r) || /option\s+\d/i.test(r) || /select\s+one/i.test(r)) {
    r = lang==="es" ? "que tipo de camion tienes" : "what kind of truck are you hauling in"
  }
  if (/what\s+type\s+of\s+truck/i.test(r) && /tandem|triax|quad|belly|end dump/i.test(r)) {
    r = lang==="es" ? "que tipo de camion tienes" : "what kind of truck are you hauling in"
  }
  if ((/what\s+city/i.test(r) || /which\s+city/i.test(r)) && state !== "DISCOVERY") {
    r = lang==="es" ? "que tipo de camion tienes" : "what kind of truck are you hauling in"
  }
  for (const p of ["i am an ai","i\'m an ai","language model","artificial","claude","anthropic","i am a bot","i\'m a bot","as an ai"]) {
    if (r.toLowerCase().includes(p)) r = "this is jesse"
  }
  if (r.length > 160) {
    const first = r.split(/[.!?\n]/).filter(s => s.trim().length > 3)[0]
    r = first ? first.trim().slice(0, 155) : r.slice(0, 155)
  }
  if ((r.match(/\?/g)||[]).length > 1) {
    const idx = r.indexOf("?")
    if (idx > 0) r = r.slice(0, idx+1).trim()
  }
  r = r.replace(/\.\s*$/, "").trim()
  return r || (lang==="es" ? "dame un segundo" : "give me a sec")
}


// ─────────────────────────────────────────────────────────────
// TEMPLATE RESPONSES — hardcoded, zero AI mistakes
// These handle the predictable 80% of messages
// ─────────────────────────────────────────────────────────────
function pick(arr: string[]): string { return arr[Math.floor(Math.random() * arr.length)] }

function tryTemplate(
  body: string, lower: string, hasPhoto: boolean,
  conv: any, profile: any, lang: "en"|"es",
  nearbyJobs: any[], activeJob: any, isKnownDriver: boolean,
): { response: string; updates: Record<string,any>; action: string } | null {
  const state = conv?.state || "DISCOVERY"
  const firstName = profile?.first_name || ""
  const hasYards = !!conv?.extracted_yards
  const hasTruck = !!conv?.extracted_truck_type
  const hasTruckCount = !!conv?.extracted_truck_count
  const hasCity = !!conv?.extracted_city && conv.extracted_city !== "__PIN__"
  const hasPhotoStored = !!conv?.photo_public_url

  if (lower === "stop" || lower === "unsubscribe") {
    return { response: "", updates: {}, action: "STOP" }
  }
  if (lower === "start") {
    return { response: pick(["Yea you back on","You good now"]), updates: {}, action: "START" }
  }

  if (/\b(on my way|otw|heading there|headed there|leaving now|en camino|voy para alla|saliendo|on the way|im on my way|i.?m otw|bout to leave|pulling out|headed to site|ya voy|voy pa ya)\b/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: pick(lang==="es" ? ["10.4 avisame cuando llegues","dale avisame cuando estes ahi"] : ["10.4 let me know when you pull up","10.4"]), updates: { state: "OTW_PENDING" }, action: "NONE" }
  }

  if (/\b(resend|send again|lost.*address|what was the address|address again|direccion de nuevo|manda la direccion|whats the addy again|donde era|send it again)\b/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: "__RESEND_ADDRESS__", updates: {}, action: "RESEND_ADDRESS" }
  }

  if (/^(done|finished|all done|wrapped up|that.?s it|that.?s all|terminamos|termin[eé]|listo ya|ya terminamos)$/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: pick(lang==="es" ? ["cuantas cargas tiraste","cuantas cargas en total"] : ["how many loads total","how many loads you drop"]), updates: {}, action: "NONE" }
  }

  const loadMatch = lower.match(/^(\d{1,3})\s*(loads?|down|total|done|delivered|drops?|cargas?)?$/) 
                 || lower.match(/(done|delivered|dropped|tiramos)\s*(\d{1,3})/i)
  if (loadMatch && activeJob && (state === "ACTIVE" || state === "OTW_PENDING")) {
    const loads = parseInt(loadMatch[1] || loadMatch[2])
    if (loads > 0 && loads <= 100) {
      return { response: "__DELIVERY__:" + loads, updates: { state: "AWAITING_CUSTOMER_CONFIRM" }, action: "COMPLETE_JOB" }
    }
  }

  if (state === "PAYMENT_METHOD_PENDING") {
    if (/zelle/i.test(lower)) {
      return { response: pick(lang==="es" ? ["mandame el nombre y numero de tu zelle"] : ["send the name and number the zelle account it to"]), updates: { state: "PAYMENT_ACCOUNT_PENDING", job_state: "zelle" }, action: "NONE" }
    }
    if (/venmo/i.test(lower)) {
      return { response: pick(lang==="es" ? ["mandame tu venmo"] : ["whats your venmo"]), updates: { state: "PAYMENT_ACCOUNT_PENDING", job_state: "venmo" }, action: "NONE" }
    }
    if (/check|cheque/i.test(lower)) {
      return { response: pick(lang==="es" ? ["mandame tu direccion para el cheque"] : ["send me your address for the check"]), updates: { state: "PAYMENT_ACCOUNT_PENDING", job_state: "check" }, action: "NONE" }
    }
    return { response: pick(lang==="es" ? ["como quieres que te paguemos, zelle o venmo"] : ["how you want it, zelle or venmo"]), updates: {}, action: "NONE" }
  }

  if (state === "PAYMENT_ACCOUNT_PENDING") {
    const looksLikeAccount = /\d{7,}/.test(body) || /@/.test(body) || /^@?\w{3,}$/.test(body.trim()) || /^[A-Z][a-z]+ [A-Z][a-z]+/.test(body.trim()) || /^[a-z]+\s+[a-z]+$/i.test(body.trim()) || /^[a-z]+\s+\d{3}/.test(body.trim().toLowerCase())
    if (looksLikeAccount) {
      return { response: pick(lang==="es" ? ["listo, te mandamos en rato"] : ["got it, we will have it sent shortly"]), updates: { state: "CLOSED" }, action: "COLLECT_PAYMENT" }
    }
    const method = conv?.job_state || "zelle"
    if (method === "venmo") return { response: lang==="es" ? "mandame tu venmo" : "whats your venmo", updates: {}, action: "NONE" }
    return { response: lang==="es" ? "mandame el nombre y numero de tu zelle" : "send the name and number the zelle account it to", updates: {}, action: "NONE" }
  }

  if (state === "APPROVAL_PENDING") {
    return { response: pick(lang==="es" ? ["todavia esperando confirmacion, dame un min","dejame verificar"] : ["still waiting on them, give me a min","let me check on that"]), updates: {}, action: "NONE" }
  }

  const isYes = /^(yes|yeah|yep|yea|yessir|yessirr|bet|fasho|si|fs|sure|absolutely|for sure|copy|10-4|ok|okay|yup|hell yeah|of course|definitely|correct|right|affirmative|dale|simon|claro|lets go|lets do it|down|im down|send it|works for me|that works|sounds good)$/i.test(lower)

  if (isYes && state === "JOB_PRESENTED") {
    return { response: pick(lang==="es" ? ["mandame una foto de la tierra","dame una foto de la tierra"] : ["send me a pic of the dirt","send me a picture of the material"]), updates: { state: "PHOTO_PENDING" }, action: "NONE" }
  }

  if (isYes && (state === "DISCOVERY" || state === "GETTING_NAME" || state === "ASKING_TRUCK" || state === "ASKING_TRUCK_COUNT" || state === "ASKING_ADDRESS")) {
    if (!hasYards) {
      return { response: pick(lang==="es" ? ["cuantas yardas hay disponibles","cuantas yardas tienen"] : ["how many yards are available","how many yards you got available"]), updates: {}, action: "NONE" }
    }
    if (!hasTruck) {
      return { response: pick(lang==="es" ? ["que tipo de camion tienes","que clase de camion traes"] : ["what kind of truck are you hauling in","what kind of truck you running"]), updates: { state: "ASKING_TRUCK" }, action: "NONE" }
    }
    if (!hasTruckCount) {
      return { response: pick(lang==="es" ? ["cuantas camionetas tienes corriendo","cuantos camiones traes"] : ["how many trucks you got running","how many trucks you running"]), updates: { state: "ASKING_TRUCK_COUNT" }, action: "NONE" }
    }
    if (!hasCity) {
      return { response: pick(lang==="es" ? ["cual es la direccion de donde van a cargar, para ver cual de mis sitios les queda mas cerca"] : ["whats the address your coming from so I can put into my system and see which site is closest","whats addy your coming from so I can see which of my sites is closest"]), updates: { state: "ASKING_ADDRESS" }, action: "NONE" }
    }
    return null
  }

  const yardMatch = lower.match(/^(\d+)\s*(yds?|yards?|yardas?)?\s*$/)
  if (yardMatch && !activeJob && !hasYards) {
    const yards = parseInt(yardMatch[1])
    if (yards > 0 && yards < 50000) {
      return { response: pick(lang==="es" ? ["que tipo de camion tienes","que clase de camion traes"] : ["what kind of truck are you hauling in","what kind of truck you running"]), updates: { extracted_yards: yards, state: "ASKING_TRUCK" }, action: "NONE" }
    }
  }

  const truckPatterns: [RegExp, string][] = [
    [/tandem|tandum|tan\s*dem/i, "tandem_axle"],
    [/tri.?ax|triax/i, "tri_axle"],
    [/quad/i, "quad_axle"],
    [/end.?dump/i, "end_dump"],
    [/belly/i, "belly_dump"],
    [/side.?dump/i, "side_dump"],
    [/volteo|camion de volteo/i, "end_dump"],
  ]
  for (const [rx, val] of truckPatterns) {
    if (rx.test(lower) && (state === "ASKING_TRUCK" || state === "DISCOVERY" || !hasTruck)) {
      return { response: pick(lang==="es" ? ["cuantas camionetas tienes corriendo","cuantos camiones traes"] : ["how many trucks you got running","how many trucks you running"]), updates: { extracted_truck_type: val, state: "ASKING_TRUCK_COUNT" }, action: "NONE" }
    }
  }

  const isCount = /^(\d{1,2})\s*(trucks?|camion(es)?|rigs?)?$/i.test(lower) || /^(just me|solo|one|uno|two|dos|three|tres)$/i.test(lower)
  if (isCount && state === "ASKING_TRUCK_COUNT") {
    let count = 1
    if (/^\d/.test(lower)) count = parseInt(lower)
    else if (/two|dos/i.test(lower)) count = 2
    else if (/three|tres/i.test(lower)) count = 3
    
    return { response: pick(lang==="es" 
      ? ["cual es la direccion de donde van a cargar, para ver cual de mis sitios les queda mas cerca"]
      : ["whats the address your coming from so I can put into my system and see which site is closest","whats addy your coming from so I can see which of my sites is closest"]), 
      updates: { extracted_truck_count: count, state: "ASKING_ADDRESS" }, action: "NONE" }
  }

  const looksLikeAddress = /\d+\s+\w+.*(st|ave|blvd|dr|rd|ln|ct|way|pkwy|hwy|street|avenue|drive|road|lane|expy|expressway)/i.test(body) || /\d+\s+\w+\s+\w+/.test(body)

  // City names list for extraction
  const cityNames = ["Dallas","Fort Worth","Arlington","Plano","Frisco","McKinney","Allen","Garland","Irving","Mesquite","Carrollton","Richardson","Lewisville","Denton","Mansfield","Grand Prairie","Euless","Bedford","Hurst","Grapevine","Southlake","Keller","Colleyville","Flower Mound","Little Elm","Celina","Prosper","Anna","Blue Ridge","Rockwall","Rowlett","Sachse","Wylie","Waxahachie","Midlothian","Cleburne","Burleson","Joshua","Cedar Hill","DeSoto","Lancaster","Duncanville","Ferris","Red Oak","Forney","Kaufman","Terrell","Royse City","Fate","Heath","Sunnyvale","Coppell","Addison","Farmers Branch","North Richland Hills","Richland Hills","Watauga","Haltom City","Saginaw","Azle","Weatherford","Granbury","Sherman","Denison","Gordonville","Corsicana","Ennis","Crowley","Glenn Heights","Kennedale"]

  // Check if message contains a known city name
  let mentionedCity = null as string | null
  for (const c of cityNames) {
    if (body.toLowerCase().includes(c.toLowerCase())) { mentionedCity = c; break }
  }

  // Driver gave an address OR a city name while we're asking for location
  const isLocationInput = looksLikeAddress || (mentionedCity && (state === "ASKING_ADDRESS" || state === "DISCOVERY"))

  if (isLocationInput && (state === "ASKING_ADDRESS" || (!hasCity && state !== "ACTIVE" && state !== "OTW_PENDING" && state !== "PHOTO_PENDING" && state !== "APPROVAL_PENDING" && state !== "JOB_PRESENTED"))) {

    // If driver just gave a city name (no street address), ask for the actual address
    // so we can find the CLOSEST site by distance
    if (!looksLikeAddress && mentionedCity) {
      // They gave a city — we need the actual loading address for accurate routing
      return { response: pick(lang==="es"
        ? ["cual es la direccion exacta de donde van a cargar"]
        : ["whats the exact address your loading from so I can find the closest site","send me the loading address so I can see which site is closest"]),
        updates: { extracted_city: mentionedCity, state: "ASKING_ADDRESS" }, action: "NONE" }
    }

    // Driver gave a full address — present nearest job
    if (nearbyJobs.length > 0) {
      const job = nearbyJobs[0]
      const payDollars = Math.round(job.driverPayCents / 100)
      const resp = lang === "es"
        ? `Tengo ${job.cityName} ${job.distanceMiles.toFixed(0)} millas de ti, ${job.yardsNeeded} yardas — $${payDollars}/carga — te sirve`
        : `I got ${job.cityName} ${job.distanceMiles.toFixed(0)} miles from you, ${job.yardsNeeded} yards needed — $${payDollars}/load — think that works`
      return { response: resp, updates: { extracted_city: mentionedCity || nearbyJobs[0].cityName, state: "JOB_PRESENTED", pending_approval_order_id: job.id }, action: "NONE" }
    }

    if (mentionedCity) {
      return { response: pick(lang==="es" ? ["no tengo nada cerca de ahi ahorita, dejame ver que puedo conseguir"] : ["nothing near there right now, let me see what I can find"]), updates: { extracted_city: mentionedCity }, action: "NONE" }
    }

    return null
  }

  // ── PHOTO — only allowed during PHOTO_PENDING state ──
  if (hasPhoto && state === "PHOTO_PENDING") {
    return null // Let Sonnet evaluate the dirt
  }

  // Photo sent but NOT in PHOTO_PENDING — driver jumped ahead.
  // Acknowledge photo but enforce qualification flow.
  if (hasPhoto) {
    if (!hasYards) {
      return { response: pick(lang==="es" ? ["recibida — cuantas yardas hay disponibles"] : ["got it — how many yards are available"]), updates: {}, action: "NONE" }
    }
    if (!hasTruck) {
      return { response: pick(lang==="es" ? ["recibida — que tipo de camion tienes"] : ["got the pic — what kind of truck are you hauling in"]), updates: { state: "ASKING_TRUCK" }, action: "NONE" }
    }
    if (!hasTruckCount) {
      return { response: pick(lang==="es" ? ["recibida — cuantos camiones traes"] : ["got it — how many trucks you got running"]), updates: { state: "ASKING_TRUCK_COUNT" }, action: "NONE" }
    }
    if (!hasCity) {
      return { response: pick(lang==="es" ? ["recibida — cual es la direccion de donde van a cargar"] : ["got the pic — whats the address your loading from so I can find the closest site"]), updates: { state: "ASKING_ADDRESS" }, action: "NONE" }
    }
    // Has everything — let Sonnet evaluate
    return null
  }

  // ═══════════════════════════════════════════════════
  // CATCH-ALL: qualification is NOT complete — NEVER let
  // Sonnet skip steps. Template enforces the order.
  // ═══════════════════════════════════════════════════
  const inQualification = !activeJob && state !== "PHOTO_PENDING" && state !== "APPROVAL_PENDING" && state !== "JOB_PRESENTED" && state !== "PAYMENT_METHOD_PENDING" && state !== "PAYMENT_ACCOUNT_PENDING" && state !== "ACTIVE" && state !== "OTW_PENDING" && state !== "AWAITING_CUSTOMER_CONFIRM" && state !== "CLOSED"
  const qualificationMissing = !hasYards || !hasTruck || !hasTruckCount || !hasCity

  if (inQualification && qualificationMissing) {
    // Something is still missing — ask for the next piece
    // Only let Sonnet handle if this is the FIRST message (opener/greeting)
    // After that, template controls the flow
    const isFirstMessage = state === "DISCOVERY" && !hasYards && !hasTruck && !hasCity
    if (isFirstMessage) {
      return null // Let Sonnet do the natural opener, but with strict instruction to ask yards
    }

    // NOT first message — template takes over, no exceptions
    if (!hasYards) {
      return { response: pick(lang==="es" ? ["cuantas yardas hay disponibles"] : ["how many yards are available","how many yards you got"]), updates: {}, action: "NONE" }
    }
    if (!hasTruck) {
      return { response: pick(lang==="es" ? ["que tipo de camion tienes"] : ["what kind of truck are you hauling in"]), updates: { state: "ASKING_TRUCK" }, action: "NONE" }
    }
    if (!hasTruckCount) {
      return { response: pick(lang==="es" ? ["cuantos camiones traes"] : ["how many trucks you got running"]), updates: { state: "ASKING_TRUCK_COUNT" }, action: "NONE" }
    }
    if (!hasCity) {
      return { response: pick(lang==="es" ? ["cual es la direccion de donde van a cargar"] : ["whats the address your loading from so I can find the closest site"]), updates: { state: "ASKING_ADDRESS" }, action: "NONE" }
    }
  }

  return null
}

// ─────────────────────────────────────────────────────────────
// POST-SEND VALIDATOR — safety net catches anything robotic
// ─────────────────────────────────────────────────────────────
function validateResponse(r: string, driverAddr: string|null, state: string, lang: "en"|"es"): string {
  // Block driver own address as dump site
  if (driverAddr) {
    const words = driverAddr.toLowerCase().split(/[\s,]+/).filter(w => w.length > 3)
    if (words.filter(w => r.toLowerCase().includes(w)).length >= 3) {
      return lang==="es" ? "dejame verificar que tengo cerca" : "let me check what I got near you"
    }
  }
  // Block job codes
  r = r.replace(/DS-[A-Z0-9]{4,}/g, "").replace(/\s{2,}/g, " ").trim()
  // Block Reply: menus
  if (/reply\s*:/i.test(r) || /option\s+\d/i.test(r) || /select\s+one/i.test(r)) {
    return lang==="es" ? "que tipo de camion tienes" : "what kind of truck are you hauling in"
  }
  // Block truck type menu
  if (/what\s+type\s+of\s+truck/i.test(r) && /tandem|triax|quad|belly|end dump/i.test(r)) {
    return lang==="es" ? "que tipo de camion tienes" : "what kind of truck are you hauling in"
  }
  // Block city question when address known
  if ((/what\s+city/i.test(r) || /which\s+city/i.test(r)) && state !== "DISCOVERY") {
    return lang==="es" ? "que tipo de camion tienes" : "what kind of truck are you hauling in"
  }
  // Block AI admission
  for (const p of ["i am an ai","i'm an ai","language model","artificial","claude","anthropic","i am a bot","i'm a bot","as an ai"]) {
    if (r.toLowerCase().includes(p)) return "this is jesse"
  }
  // Enforce max length
  if (r.length > 180) {
    const first = r.split(/[.!?\n]/).filter(s => s.trim().length > 3)[0]
    r = first ? first.trim().slice(0, 170) : r.slice(0, 170)
  }
  // Block multiple questions
  if ((r.match(/\?/g)||[]).length > 1) {
    const idx = r.indexOf("?")
    if (idx > 0) r = r.slice(0, idx+1).trim()
  }
  // Remove trailing period
  r = r.replace(/\.\s*$/, "").trim()
  return r || (lang==="es" ? "dame un segundo" : "give me a sec")
}


async function callBrain(
  body: string, hasPhoto: boolean, photoUrl: string|undefined,
  conv: any, profile: any, history: { role: "user"|"assistant"; content: string }[],
  nearbyJobs: JobMatch[], activeJob: any, lang: "en"|"es",
  isKnownDriver: boolean, savedPayment: { method: string; account: string }|null,
): Promise<BrainOutput> {
  const topJob = nearbyJobs[0]
  const ceilingCents = topJob?.driverPayCents || 5000
  const floorCents = isKnownDriver ? ceilingCents : Math.max(2500, ceilingCents - 2000)

  const ctx = (() => {
    const missing: string[] = []
    if (!conv?.extracted_yards) missing.push("yards")
    if (!conv?.extracted_truck_type) missing.push("truck_type")
    if (!conv?.extracted_truck_count) missing.push("truck_count")
    if (!conv?.extracted_city) missing.push("address")
    
    const st = conv?.state || "DISCOVERY"
    let instruction = ""
    
    if (st === "PHOTO_PENDING" && hasPhoto) {
      instruction = "EVALUATE THE DIRT PHOTO. If clean fill (sandy/loamy/reddish-brown/caliche/some grass): say 'looks good give me a min' and set action=SEND_FOR_APPROVAL and state=APPROVAL_PENDING. If bad (clay/rocks/debris/trash): say 'Fuck' then 'yea no go on that dirt'. If unclear: ask 'is dirt clean'"
    } else if (st === "PHOTO_PENDING" && !hasPhoto) {
      instruction = "Driver hasn't sent photo yet. Remind them: ask for a pic of the dirt. Short."
    } else if (st === "APPROVAL_PENDING") {
      instruction = "Waiting for customer to approve. Tell driver to hang tight: 'still waiting on them give me a min' or 'let me check on that'"
    } else if (st === "JOB_PRESENTED") {
      instruction = "Driver was presented a job. If they seem interested, ask for a pic of the dirt (state->PHOTO_PENDING). If they say no or too far, acknowledge and say you'll check for more."
    } else if (st === "ACTIVE" || st === "OTW_PENDING") {
      instruction = "Driver has an active job. Respond naturally. If they report load count, acknowledge. If they ask something, answer it."
    } else if (st === "CLOSED") {
      instruction = "Job is done, payment handled. Chat naturally like a real person. If driver asks about new work, ask if they got more dirt to haul. If they're just chatting, be friendly and brief. If they want to start a new job, say 'you got more dirt' and set state to DISCOVERY."
    } else if (missing.length > 0) {
      const nextNeeded = missing[0]
      const instructions: Record<string,string> = {
        "yards": "Ask how many yards are available. Use phrases like 'how many yards are available' or 'how many yards you got'. Do NOT ask about truck or address yet.",
        "truck_type": "Ask what kind of truck they are hauling in. Say 'what kind of truck are you hauling in' — do NOT list types, do NOT say 'Reply:' or 'end dump or tandem'. Just ask naturally.",
        "truck_count": "Ask how many trucks they have running. Say 'how many trucks you got running'. Do NOT ask about truck type again.",
        "address": "Ask for loading address. Say something like 'whats the address your coming from so I can put into my system and see which site is closest'. Do NOT ask about trucks or yards.",
      }
      instruction = instructions[nextNeeded] || "Continue the conversation naturally."
    } else {
      instruction = "All info collected. Continue conversation naturally based on what driver said."
    }

    return [
      "CONTEXT (hidden from driver):",
      `Driver: ${profile?.first_name || "unknown"} | Known: ${isKnownDriver} | Lang: ${lang === "es" ? "SPANISH ONLY" : "English"}`,
      `State: ${st}`,
      `Collected: yards=${conv?.extracted_yards||"MISSING"} truck=${conv?.extracted_truck_type||"MISSING"} truckCount=${conv?.extracted_truck_count||"MISSING"} city=${conv?.extracted_city||"MISSING"} photo=${conv?.photo_public_url?"YES":"MISSING"}`,
      `Pay: floor=$${Math.round(floorCents/100)} ceiling=$${Math.round(ceilingCents/100)} — NEVER exceed or reveal ceiling`,
      floorCents >= ceilingCents ? "** AT CEILING — say 'that is the best I got' NEVER go higher **" : "",
      savedPayment ? `Payment on file: ${savedPayment.method} ${savedPayment.account}` : "",
      hasPhoto ? "** PHOTO ATTACHED TO THIS MESSAGE **" : "",
      photoUrl ? `Photo URL: ${photoUrl}` : "",
      activeJob ? `Active job: ${(activeJob.cities as any)?.name} $${Math.round(activeJob.driver_pay_cents/100)}/load ${activeJob.yards_needed}yds` : "",
      nearbyJobs.length > 0
        ? `Jobs available (show city+distance+yards+pay ONLY, never addresses):\n${nearbyJobs.slice(0,3).map(j =>
            `  ${j.cityName} ${j.distanceMiles.toFixed(0)}mi ${j.yardsNeeded}yds $${Math.round(j.driverPayCents/100)}/load id:${j.id}`
          ).join("\n")}`
        : "No jobs available near driver right now",
      "",
      `>>> YOUR INSTRUCTION: ${instruction} <<<`,
      "",
      `Driver said: ${body || (hasPhoto ? "[sent photo, no text]" : "[empty]")}`,
      "",
      "Reply as Jesse. MAX 1 sentence. 3-8 words. No periods. JSON only.",
      "IMPORTANT: Do NOT extract or set yards/truck/city in your response updates. Code does that. Only set state and action.",
    ].filter(Boolean).join("\n")
  })()

  const messages = [...history.slice(-20), { role: "user" as const, content: ctx }]
  let raw = ""
  try {
    const resp = /* caught */ await anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 250, system: JESSE_PROMPT, messages,
    })
    raw = resp.content[0].type === "text" ? resp.content[0].text.trim() : ""
    raw = raw.replace(/^```json\s*/i,"").replace(/```\s*$/i,"").trim()
    const parsed = JSON.parse(raw) as BrainOutput
    if (parsed.negotiatedPayCents && parsed.negotiatedPayCents > ceilingCents) parsed.negotiatedPayCents = ceilingCents
    // Hard ceiling enforcement: if response mentions a dollar amount above ceiling, override
    const ceilDollars = Math.round(ceilingCents / 100)
    const mentionedAmount = parsed.response?.match(/\$(\d+)/)?.[1]
    if (mentionedAmount && parseInt(mentionedAmount) > ceilDollars) {
      parsed.response = lang === "es" ? "eso es lo mejor que tengo" : "that is the best I got"
      parsed.action = "NONE"
    }
    if (parsed.response?.length > 300) parsed.response = parsed.response.slice(0, 300)
    return parsed
  } catch (err) {
    console.error("[Brain] raw:", raw?.slice(0,200), err)
    const fb: Record<string,string> = {
      DISCOVERY: lang==="es"?pick(["que onda, tienes tierra hoy","oye andas moviendo tierra hoy"]):pick(["what up, you hauling today","yo you running loads today","what up, you got dirt today"]),
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
      ? `DumpSite: ${profile.first_name} entrego ${loads} carga${loads>1?"s":""}. Todo bien con la entrega? Necesitas mas cargas? Responde YES o NO`
      : `DumpSite: Did all go well with the delivery of ${loads} load${loads>1?"s":""}? Do you need anymore loads? Reply YES or NO`
    await sendSMS(cp, msg)
  }

  const savedPay = await getPaymentInfo(phone)
  if (savedPay) {
    await saveConv(phone, { ...conv, state: "CLOSED", active_order_id: null })
    await sendAdminAlert(`PAYMENT: ${profile.first_name} — ${savedPay.method} — ${savedPay.account} — $${totalDollars}`)
    return lang==="es"
      ? `10.4 — ${loads} carga${loads>1?"s":""}. $${totalDollars} mandando a tu ${savedPay.method}`
      : `10.4 — ${loads} load${loads>1?"s":""}. $${totalDollars} sending to your ${savedPay.method} shortly`
  }
  await saveConv(phone, { ...conv, state: "PAYMENT_METHOD_PENDING", active_order_id: job.id, pending_pay_dollars: totalDollars })
  return lang==="es"
    ? `10.4 — ${loads} carga${loads>1?"s":""}. $${totalDollars} listo. Zelle o venmo`
    : `10.4 — ${loads} load${loads>1?"s":""}. $${totalDollars} coming your way. Zelle or venmo`
}

// ─────────────────────────────────────────────────────────────
// PAYMENT
// ─────────────────────────────────────────────────────────────
async function handlePayment(phone: string, body: string, conv: any, lang: "en"|"es"): Promise<string> {
  const lower = body.toLowerCase().trim()

  // Escape from payment flow
  if (/^(cancel|reset|start over|new|nvm|nevermind|skip|later)$/i.test(lower)) {
    await resetConv(phone)
    return lang==="es" ? "10.4 avisame cuando quieras" : "10.4 no worries. Text when you ready"
  }

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
    const acct = body.trim()

    // Validate: must look like a phone number, email, or username — not random words
    const digitsOnly = acct.replace(/\D/g, "")
    const looksLikeAccount =
      digitsOnly.length >= 7 ||                        // phone number (7+ digits, ignoring hyphens/spaces)
      /@/.test(acct) ||                                // email or @handle
      /^[A-Z][a-z]+ [A-Z][a-z]+/.test(acct) ||        // "First Last" name for Zelle
      /^[a-z]+ [a-z]+$/i.test(acct) ||                 // name variant (two words)
      (acct.startsWith("@") && acct.length >= 4)       // Venmo @handle

    if (!looksLikeAccount) {
      // Doesn't look like account info — re-ask
      if (method === "zelle") {
        return lang==="es" ? "mandame el nombre y numero de tu zelle" : "send the name and number the zelle account it to"
      }
      return lang==="es" ? "mandame tu venmo" : "whats your venmo"
    }

    await savePaymentInfo(phone, method, acct)
    await saveConv(phone, { ...conv, state: "CLOSED", active_order_id: null, pending_approval_order_id: null })
    const payAmount = conv.pending_pay_dollars ? ` — $${conv.pending_pay_dollars}` : ""
    await sendAdminAlert(`PAYMENT: ${phone} — ${method} — ${acct}${payAmount}`)
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

  // ── COMPLIANCE ───────────────────────────────────────────────
  if (lower === "stop" || lower === "unsubscribe") {
    await createAdminSupabase().from("driver_profiles").update({ sms_opted_out: true }).eq("phone", phone)
    return ""
  }
  if (lower === "start") {
    await createAdminSupabase().from("driver_profiles").update({ sms_opted_out: false }).eq("phone", phone)
    return "Yea you back on"
  }

  // ── UNIVERSAL RESET — escape from ANY stuck state ───────────
  if (/^(reset|start over|new|restart|menu|help|cancel)$/i.test(lower)) {
    await resetConv(phone)
    await logMsg(phone, "Conversation reset", "outbound", `reset_${sid}`)
    return "10.4 starting fresh. You got dirt today"
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
    // Admin status check
    if (/^(status|stats|dashboard)$/i.test(lower)) {
      const sb = createAdminSupabase()
      const { count: activeCount } = await sb.from("conversations").select("id", { count: "exact", head: true }).in("state", ["ACTIVE","OTW_PENDING","PHOTO_PENDING","APPROVAL_PENDING"])
      const { count: pendingPay } = await sb.from("driver_payments").select("id", { count: "exact", head: true }).eq("status", "pending")
      return `Active: ${activeCount || 0} drivers\nPending payments: ${pendingPay || 0}\nDashboard: ${APP_URL}/admin/live`
    }

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

  // Detect if driver sent a full address (has numbers + street words)
  const looksLikeAddress = /\d{2,}\s+\w+\s+(st|ave|blvd|dr|rd|ln|way|ct|pl|pkwy|hwy|fm|loop)\b/i.test(body) ||
    /\d{2,}\s+[nsew]\.?\s+\w+/i.test(body)
  const driverLoadingAddress = looksLikeAddress ? body.trim() : null

  const enriched = {
    ...conv,
    extracted_truck_type: conv.extracted_truck_type || inlineTruck || null,
    extracted_yards: conv.extracted_yards || inlineYards || null,
    photo_public_url: storedPhotoUrl || null,
    // Store full address when detected — piggyback on extracted_material field
    extracted_material: driverLoadingAddress || conv.extracted_material || null,
  }
  if (inlineTruck || inlineYards || storedPhotoUrl || driverLoadingAddress) await saveConv(phone, enriched)

  // ── NEARBY JOBS — use full address when available, fall back to city ──
  let nearbyJobs: JobMatch[] = []
  const routingInput = enriched.extracted_material || enriched.extracted_city
  if (routingInput) {
    try {
      nearbyJobs = await findNearbyJobs(routingInput, enriched.extracted_truck_type || undefined)
    } catch {}
  }

  // ── CALL BRAIN ───────────────────────────────────────────────
  const savedPayment = await getPaymentInfo(phone)
  const isOffTopic = /^(no|nah|wait|hello|hey|what|huh|wrong|nope|lol|\?+|ok|hi|yo|sup)$/i.test(lower) || lower.length < 4
  const correctionHint = isOffTopic ? " [driver said something unexpected — respond naturally dont ask next question]" : ""

  // ── TRY TEMPLATE FIRST (no AI call needed for predictable flow) ──
  const tpl = tryTemplate(body, lower, hasPhoto, enriched, profile, lang, nearbyJobs, activeJob, isKnownDriver)
  if (tpl !== null) {
    const toSaveTpl: Record<string,any> = { ...enriched, ...tpl.updates }
    
    // Handle STOP
    if (tpl.action === "STOP") {
      const sb = createAdminSupabase()
      try { await sb.from("driver_profiles").update({ sms_opted_out: true }).eq("phone", phone) } catch {}
      return ""
    }
    
    // Handle START
    if (tpl.action === "START") {
      const sb = createAdminSupabase()
      try { await sb.from("driver_profiles").update({ sms_opted_out: false }).eq("phone", phone) } catch {}
      await logMsg(phone, tpl.response, "outbound", `tpl_${sid}`)
      return tpl.response
    }
    
    // Handle address resend
    if (tpl.action === "RESEND_ADDRESS" && activeJob?.client_address) {
      await saveConv(phone, toSaveTpl)
      await logMsg(phone, activeJob.client_address, "outbound", `tpl_${sid}`)
      return activeJob.client_address
    }
    
    // Handle delivery completion
    if (tpl.action === "COMPLETE_JOB" && tpl.response.startsWith("__DELIVERY__:")) {
      const loads = parseInt(tpl.response.split(":")[1]) || 1
      if (activeJob) {
        const reply = await handleDelivery(phone, conv, profile, activeJob, loads, lang)
        await logMsg(phone, reply, "outbound", `del_${sid}`)
        return reply
      }
    }
    
    // Handle payment collection
    if (tpl.action === "COLLECT_PAYMENT") {
      const method = enriched.job_state || conv?.job_state || "zelle"
      await savePaymentInfo(phone, method, body.trim())
      await sendSMS(ADMIN_PHONE, `PAYMENT: ${phone} — ${method} — ${body.trim()}${enriched.pending_pay_dollars ? " — $"+enriched.pending_pay_dollars : ""}`)
    }
    
    // Handle job presentation — claim the job
    if (tpl.updates.state === "JOB_PRESENTED" && tpl.updates.pending_approval_order_id) {
      try {
        const claimed = await atomicClaimJob(tpl.updates.pending_approval_order_id, phone, profile?.user_id || null)
        if (claimed) {
          toSaveTpl.reservation_id = (claimed as any).reservationId || null
        }
      } catch {}
    }
    
    await saveConv(phone, toSaveTpl)
    const validatedTpl = validateResponse(tpl.response, null, toSaveTpl.state || convState, lang)
    await logMsg(phone, validatedTpl, "outbound", `tpl_${sid}`)
    return validatedTpl
  }

  // ── SONNET HANDLES COMPLEX CASES (negotiation, photos, off-topic, etc.) ──
  const brain = await callBrain(
    body + correctionHint, hasPhoto, photoUrl, enriched, profile, history,
    nearbyJobs, activeJob, lang, isKnownDriver, savedPayment,
  )

  // ── VALIDATE BEFORE SEND — safety net ────────────────────────
  let response = brain.response
  const driverAddress = body.toLowerCase().trim()

  // Block: response contains driver's own loading address
  if (driverAddress.length > 10 && response.toLowerCase().includes(driverAddress.slice(0, 20).toLowerCase())) {
    response = lang === "es" ? "dejame verificar que tengo cerca" : "let me check what I got close"
  }
  // Block: response contains internal job codes
  if (/DS-[A-Z0-9]{5,}/i.test(response)) {
    response = response.replace(/DS-[A-Z0-9]{5,}/gi, "").trim() || (lang === "es" ? "dejame verificar" : "let me check")
  }
  // Block: response admits being AI
  if (/\b(i am an ai|i'm an ai|artificial intelligence|language model|claude|anthropic|i am a bot|i'm a bot|automated system)\b/i.test(response)) {
    response = lang === "es" ? "soy Jesse, broker de tierra en DFW" : "nah I'm Jesse, dirt broker in DFW"
  }
  // Block: response over 320 chars
  if (response.length > 320) {
    response = response.slice(0, 320)
  }
  // Block: response claims job exists when no jobs available
  if (nearbyJobs.length === 0 && /\d+\s*mi(les?|)\s*(away|from)|\d+\s*minutes/i.test(response)) {
    response = lang === "es" ? "nada ahorita cerca de ti, te aviso cuando salga algo" : "nothing close right now, will hit you up when something opens"
  }
  brain.response = response

  // ── PERSIST (with state validation) ──────────────────────────
  const VALID_STATES = new Set(["DISCOVERY","GETTING_NAME","ASKING_TRUCK","ASKING_TRUCK_COUNT","ASKING_ADDRESS","JOB_PRESENTED","PHOTO_PENDING","APPROVAL_PENDING","ACTIVE","OTW_PENDING","PAYMENT_METHOD_PENDING","PAYMENT_ACCOUNT_PENDING","AWAITING_CUSTOMER_CONFIRM","CLOSED"])
  const toSave: Record<string,any> = { ...enriched }
  // Only accept state from brain if it's valid AND the transition makes sense
  if (brain.updates.state && VALID_STATES.has(brain.updates.state)) {
    const newState = brain.updates.state
    // Prevent brain from jumping to payment/active states without proper preconditions
    const dangerousStates = ["PAYMENT_METHOD_PENDING", "PAYMENT_ACCOUNT_PENDING", "ACTIVE", "OTW_PENDING", "AWAITING_CUSTOMER_CONFIRM"]
    if (dangerousStates.includes(newState) && !toSave.active_order_id && !conv?.active_order_id) {
      // No active job — brain hallucinated a dangerous state, ignore it
      console.warn(`[Brain] blocked state transition to ${newState} — no active job`)
    } else {
      toSave.state = newState
    }
  }
  // extracted_city set by CODE not AI — blocked
  // extracted_yards set by CODE not AI — blocked
  // extracted_truck_type set by CODE not AI — blocked
  if (brain.updates.pending_approval_order_id) toSave.pending_approval_order_id = brain.updates.pending_approval_order_id
  if (brain.negotiatedPayCents) toSave.negotiated_pay_cents = brain.negotiatedPayCents
  if (hasPhoto && storedPhotoUrl) toSave.photo_public_url = storedPhotoUrl

  // ── ACTIONS ──────────────────────────────────────────────────
  
  // Handle photo approval — brain approved the dirt, send to customer
  // Trigger if: (1) Sonnet explicitly said SEND_FOR_APPROVAL, OR
  //             (2) photo was sent during PHOTO_PENDING and Sonnet didn't reject the dirt
  const dirtRejected = /no go|can.?t accept|rejected|trash|debris|concrete|clay/i.test(brain.response)
  const photoApprovalNeeded = brain.action === "SEND_FOR_APPROVAL"
    || (hasPhoto && toSave.state === "APPROVAL_PENDING")
    || (hasPhoto && convState === "PHOTO_PENDING" && !dirtRejected)
  if (photoApprovalNeeded) {
    const orderId = toSave.pending_approval_order_id || conv.pending_approval_order_id
    console.log(`[Brain] Photo approval: orderId=${orderId} action=${brain.action} convState=${convState} dirtRejected=${dirtRejected}`)
    if (orderId) {
      if (photoUrl) {
        try {
          const stored = await downloadAndStorePhoto(photoUrl, phone, orderId)
          if (stored) toSave.photo_public_url = stored.publicUrl
        } catch (e) { console.error("[photo store]", e) }
      }
      
      const sb = createAdminSupabase()
      const { data: order } = await sb.from("dispatch_orders")
        .select("id, client_phone, client_name, yards_needed, driver_pay_cents")
        .eq("id", orderId).maybeSingle()
      
      if (order?.client_phone) {
        const driverName = profile ? `${profile.first_name} ${profile.last_name || ""}`.trim() : phone
        const customerPhone = order.client_phone.replace(/\D/g, "").replace(/^1/, "")
        const approvalCode = crypto.randomBytes(4).toString("hex").toUpperCase()
        const photoToSend = toSave.photo_public_url || photoUrl || ""

        let approvalSent = false
        try {
          approvalSent = await sendCustomerApprovalRequest(
            customerPhone, order.client_name || "Site Owner",
            driverName, order.id, order.yards_needed,
            photoToSend, approvalCode
          )
        } catch (e: any) {
          console.error("[customer approval] EXCEPTION:", e?.message || e)
        }

        // ALWAYS notify admin — whether approval sent or failed
        const jobNum = generateJobNumber(order.id)
        if (approvalSent) {
          await sendAdminAlert(`APPROVAL SENT: ${jobNum} — ${driverName} → ${order.client_name || "customer"} (${customerPhone}) — ${order.yards_needed}yds — code: ${approvalCode}`)
        } else {
          // CRITICAL: Approval FAILED — admin must know immediately
          await sendAdminAlert(`⚠ APPROVAL FAILED: ${jobNum} — could not reach customer ${order.client_name || ""} at ${customerPhone}. Driver: ${driverName} (${phone}). Photo: ${photoToSend ? "yes" : "no"}. Manual action needed.`)
        }

        if ((order.yards_needed || 0) >= LARGE_JOB_YARDS) {
          try {
            await sendAdminEscalation(
              order.id, jobNum, driverName, phone,
              conv.extracted_city || "", order.yards_needed,
              Math.round((order.driver_pay_cents || 0) / 100),
              "Large job", approvalCode
            )
          } catch {}
        }

        toSave.state = "APPROVAL_PENDING"
        toSave.approval_sent_at = new Date().toISOString()
        toSave.voice_call_made = false
      } else {
        // No client phone on the order — alert admin
        await sendAdminAlert(`⚠ NO CLIENT PHONE: Order ${orderId} has no customer phone. Driver ${phone} sent photo but cannot send approval. Fix order in admin.`)
        toSave.state = "APPROVAL_PENDING"
      }
    } else {
      console.error(`[Brain] PHOTO APPROVAL BLOCKED — no orderId. conv.pending_approval_order_id=${conv.pending_approval_order_id} toSave.pending_approval_order_id=${toSave.pending_approval_order_id}`)
      // Still set state so driver doesn't get stuck
      toSave.state = "APPROVAL_PENDING"
    }
  }

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

  // Photo approval handled above in SEND_FOR_APPROVAL block

  await saveConv(phone, toSave)
  const driverAddr = body.match(/\d+\s+\w+.*(?:st|ave|blvd|dr|rd|ln|ct|way|pkwy|hwy)/i)?.[0] || null
  const validated = validateBeforeSend(brain.response, driverAddr, toSave?.state || convState, lang)
  await logMsg(phone, validated, "outbound", `brain_${sid}`)
  return validated
}

export const smsDispatchService = { handleIncoming: handleConversation, generateJobNumber }
