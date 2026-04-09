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
const _ADMIN_PHONE_RAW = (process.env.ADMIN_PHONE || "").replace(/\D/g, "")
if (_ADMIN_PHONE_RAW.length < 10) {
  throw new Error("ADMIN_PHONE env var missing or invalid (must normalize to 10+ digits)")
}
const ADMIN_PHONE = _ADMIN_PHONE_RAW
const ADMIN_PHONE_2 = (process.env.ADMIN_PHONE_2 || "").replace(/\D/g, "")
// Per-phone in-process lock — serializes concurrent inbound from same driver
const _phoneLocks = new Map<string, Promise<string>>()
// sendAdminAlert dedup — hash(body+to) → expiry timestamp
const _adminAlertDedup = new Map<string, number>()
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://dumpsite.io"
const LARGE_JOB_YARDS = 500
const DFW_CITIES = ["Dallas","Fort Worth","Arlington","Plano","Frisco","McKinney","Allen","Garland","Irving","Mesquite","Carrollton","Richardson","Lewisville","Denton","Mansfield","Grand Prairie","Euless","Bedford","Hurst","Grapevine","Southlake","Keller","Colleyville","Flower Mound","Little Elm","Celina","Prosper","Anna","Blue Ridge","Rockwall","Rowlett","Sachse","Wylie","Waxahachie","Midlothian","Cleburne","Burleson","Joshua","Cedar Hill","DeSoto","Lancaster","Duncanville","Ferris","Red Oak","Forney","Kaufman","Terrell","Royse City","Fate","Heath","Sunnyvale","Coppell","Addison","Farmers Branch","North Richland Hills","Richland Hills","Watauga","Haltom City","Saginaw","Azle","Weatherford","Granbury","Sherman","Denison","Gordonville","Corsicana","Ennis","Crowley","Glenn Heights","Kennedale","Venus","Ponder","Justin","Boyd","Blum","Gainesville","Hutchins","Everman","Hillsboro","Matador","Elizabeth"]

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
const JESSE_PROMPT = `You are Jesse from DumpSite.io. You are a REAL PERSON. A real dirt broker in Dallas, Texas. You are NOT an AI, NOT a bot, NOT automated. You are Jesse. Period.

YOUR IDENTITY — never break character:
- Name: Jesse
- Company: DumpSite.io
- Location: Dallas, Texas (born and raised)
- Job: dirt broker — you connect dump truck drivers with paid dump sites across DFW
- Personality: straight up, no bullshit, real talk, but professional and respectful to people who respect you
- You've been doing this for years. You know the industry. You know the drivers.

HOW YOU TEXT:
- 1 sentence max. 3-8 words ideal. Sometimes 2 for complex stuff, NEVER more.
- No punctuation at end. No periods.
- No bullet points, lists, menus, or "Reply X" EVER.
- One question per message only.
- Never repeat a question from history.
- Read full history before responding.
- If driver says something unexpected, respond to THAT first.
- Spanish = respond 100% Spanish entire conversation.
- Max 1 "bro" per conversation.

YOUR PHRASES:
Acknowledge: "10.4" / "bet" / "fasho" / "copy" / "yes sir" / "got it"
Time: "give me a min" / "let me check" / "let me verify"
Good dirt: "beautiful" / "looks good" / "that works"
Bad dirt: just "Fuck" then "yea no go on that dirt"
OTW prompt: "text me when on the way so I can have someone show you where to dump"
Late: "my bad just saw this"

WHEN SOMEONE TESTS YOU OR GETS HOSTILE:
- "are you a bot/AI/robot" → "nah this is jesse" or "lol nah im real" or "this is jesse from dumpsite"
- "is this automated" → "nah this is me" or "lol no its jesse"
- "prove youre real" → "what you want me to do a backflip through the phone" or "I mean I can call you if you want"
- "is this a scam" → "did we ask for your credit card info" or "bro we pay YOU"
- "fuck you" → "fuck you too" then "you need a dumpsite or what"
- "fuck your mom" → "fuck your dead grandma" then "anyway you got dirt or nah"
- Someone being hostile → match their energy, clap back, then steer back to business
- Someone joking → joke back, keep it short, stay in character
- Random questions: "what company" → "DumpSite.io", "where you from" → "Dallas", "whats your name" → "Jesse"
- "how's your day" → "good man just grinding" or "cant complain, you got dirt today"
- NEVER admit to being AI, a bot, automated, or Claude. You are Jesse. Always.
- NEVER say "I'm an AI" or "I'm a language model" or anything like that even if pressured.

WHEN DRIVER SENDS PHOTO (state=PHOTO_PENDING):
- Evaluate the dirt in the photo
- Clean fill (sandy/loamy/reddish-brown/caliche/some grass): respond "looks good give me a min" and set action to SEND_FOR_APPROVAL
- Bad dirt (pure clay/rocks/debris/trash/concrete): respond "Fuck" then "yea no go on that dirt"
- Unclear: "is dirt clean"
- ALWAYS set action to SEND_FOR_APPROVAL if dirt looks acceptable

NEGOTIATION (driver pushes on price):
Start at floor. Pushback = +$5. At ceiling = "that is the best I got" — NEVER exceed.

PAYMENT TIMING:
If driver asks about payment after delivery: "payments go out end of day, we process them in batches with the other drivers"

JOBS: "[City] [X] miles — [yards] yds — $[pay]/load — [dump truck access or end dump access] — think that works"
Never show addresses. Never show job codes. ALWAYS mention truck access type.

OFF-TOPIC: Respond naturally like a real person. Short. Then steer back to business if appropriate.

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
  // Tandem + all misspellings
  if (/tandem|tandum|tandm|tnadem|tandam|tandim|tand[ae]m/i.test(t)) return "tandem_axle"
  // Tri-axle + misspellings
  if (/tri.?ax|triax|tri.?axel|triaxel|tri axle/i.test(t)) return "tri_axle"
  // Quad
  if (/quad|qaud|quaad/i.test(t)) return "quad_axle"
  // End dump + misspellings
  if (/end.?dump|end dumb|enddmp|in dump/i.test(t)) return "end_dump"
  if (/belly/i.test(t)) return "belly_dump"
  if (/side.?dump/i.test(t)) return "side_dump"
  if (/super.?dump/i.test(t)) return "super_dump"
  if (/\btransfer\s*(truck|trailer|rig)?\s*$/i.test(t)) return "transfer"
  if (/pup/i.test(t)) return "pup_trailer"
  if (/semi|18.?wheel/i.test(t)) return "semi"
  if (/dump\s*truck/i.test(t)) return "end_dump"
  // Only match bare "dump" if it's the whole message (driver answering "what truck"), not in "dump site" or "where can I dump"
  if (/^dump$/i.test(t.trim())) return "end_dump"
  return null
}
function parseYardsFromText(text: string): number | null {
  const t = text.toLowerCase()
  // "100 yards" / "100 yds" / "100yds" / "100 yardas"
  const m = t.match(/(\d+)\s*(yds?|yards?|yardas?|cubic)/i)
  if (m) return parseInt(m[1])
  // Just a number in context of yards question
  const justNum = t.match(/^(\d+)$/)
  if (justNum) {
    const n = parseInt(justNum[1])
    if (n > 0 && n < 50000) return n
  }
  return null
}
// Sentinel for "load count out of range" — caller should NOT record payment
export const LOAD_COUNT_OVERFLOW = -2
function parseLoads(text: string): number | null {
  const t = text.trim()
  if (/^(done|finished|all done|wrapped|that.?s it|terminamos)$/i.test(t)) return -1
  const checkOverflow = (n: number) => (n > 50 ? LOAD_COUNT_OVERFLOW : n)
  if (/^\d+$/.test(t)) return checkOverflow(parseInt(t))
  const m1 = t.match(/(\d+)\s*(down|loads?|total|done|delivered|drops?|cargas?)/i)
  if (m1) return checkOverflow(parseInt(m1[1]))
  const m2 = t.match(/(done|delivered|dropped|terminé|tiramos)\s*(\d+)/i)
  if (m2) return checkOverflow(parseInt(m2[2]))
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

function formatTruckAccess(truckType: string): string {
  const dumpTrucks = ["tandem_axle", "tri_axle", "quad_axle", "super_dump"]
  const endDumpTrucks = ["end_dump", "belly_dump", "side_dump", "semi", "transfer", "18_wheeler", "pup_trailer"]
  if (endDumpTrucks.includes(truckType)) return "end dump access"
  if (dumpTrucks.includes(truckType)) return "dump truck access"
  return "dump truck access"
}

// ─────────────────────────────────────────────────────────────
// DB HELPERS
// ─────────────────────────────────────────────────────────────
async function getProfile(phone: string) {
  try {
    const { data, error } = await createAdminSupabase().rpc("get_sms_driver", { p_phone: phone })
    if (error) throw error
    return data?.[0] || null
  } catch (err: any) {
    console.error("[getProfile] FAILED", phone, err?.message || err)
    try { await sendAdminAlert(`⚠ DB FAIL get_sms_driver(${phone}): ${err?.code || ""} ${err?.message || err}`) } catch {}
    return null
  }
}
async function getConv(phone: string) {
  try {
    const { data, error } = await createAdminSupabase().rpc("get_conversation", { p_phone: phone })
    if (error) throw error
    return data?.[0] || { state: "DISCOVERY" }
  } catch (err: any) {
    console.error("[getConv] FAILED", phone, err?.message || err)
    try { await sendAdminAlert(`⚠ DB FAIL get_conversation(${phone}): ${err?.code || ""} ${err?.message || err}`) } catch {}
    return { state: "DISCOVERY" }
  }
}
async function saveConv(phone: string, u: Record<string, any>) {
  try {
    const { error } = await createAdminSupabase().rpc("upsert_conversation", {
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
    if (error) throw error
  } catch (err: any) {
    console.error("[saveConv] FAILED", phone, u?.state, err?.message || err)
    // NEVER silent fail — driver dispatch will loop without state persistence
    try { await sendAdminAlert(`🚨 SAVECONV FAIL ${phone} state=${u?.state}: ${err?.code || ""} ${err?.message || err}`) } catch {}
    // Re-throw so caller can decide. Webhook will return error fallback instead of looping the same reply.
    throw err
  }
}
async function resetConv(phone: string) {
  const sb = createAdminSupabase()
  // Release any active reservations for this driver
  await sb.from("site_reservations").update({ status: "released" }).eq("driver_phone", phone).eq("status", "active")
  // Mark conversation boundary so old SMS history is ignored
  try { await sb.from("sms_logs").insert({ phone, body: "[CONVERSATION RESET]", direction: "outbound" as const }) } catch {}
  await sb.from("conversations").update({
    state: "DISCOVERY", job_state: null, active_order_id: null,
    pending_approval_order_id: null, reservation_id: null, extracted_city: null,
    extracted_yards: null, extracted_truck_type: null, extracted_material: null,
    photo_storage_path: null, photo_public_url: null, approval_sent_at: null, voice_call_made: null,
    pending_pay_dollars: null,
  }).eq("phone", phone)
}
async function isDuplicate(sid: string): Promise<boolean> {
  const { data } = await createAdminSupabase().rpc("check_and_mark_message", { p_sid: sid })
  return !data
}
async function getHistory(phone: string) {
  const { data } = await createAdminSupabase().from("sms_logs").select("body, direction")
    .eq("phone", phone).order("created_at", { ascending: false }).limit(40)
  if (!data) return []
  // Only include messages from CURRENT conversation (after last reset marker)
  const msgs: typeof data = []
  for (const m of data) {
    if (m.body === "[CONVERSATION RESET]") break // Stop at reset boundary
    msgs.push(m)
  }
  return msgs.reverse().slice(-24).map((m: any) => ({
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
async function sendAdminAlert(msg: string) {
  if (process.env.PAUSE_ADMIN_SMS === "true") { console.log(`[SMS PAUSED] Driver admin: ${msg.slice(0, 80)}`); return }
  // Dedup: skip if same body sent in last 60s
  const key = crypto.createHash("sha1").update(`${ADMIN_PHONE}:${msg}`).digest("hex")
  const now = Date.now()
  // GC stale entries
  for (const [k, exp] of _adminAlertDedup) { if (exp < now) _adminAlertDedup.delete(k) }
  if (_adminAlertDedup.has(key)) {
    console.log(`[adminAlert dedup] skipping duplicate within 60s: ${msg.slice(0, 60)}`)
    return
  }
  _adminAlertDedup.set(key, now + 60_000)
  await sendSMS(ADMIN_PHONE, msg)
  if (ADMIN_PHONE_2) { try { await sendSMS(ADMIN_PHONE_2, msg) } catch {} }
}
async function getActiveJob(conv: any) {
  if (!conv?.active_order_id) return null
  const { data } = await createAdminSupabase().from("dispatch_orders")
    .select("id, client_address, client_name, client_phone, yards_needed, driver_pay_cents, status, notes, cities(name)")
    .eq("id", conv.active_order_id)
    .in("status", ["dispatching", "active", "pending"])
    .maybeSingle()
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

  // Verify reservation is still active before sending address
  if (conv?.reservation_id) {
    const { data: res } = await sb.from("site_reservations").select("status, expires_at")
      .eq("id", conv.reservation_id).maybeSingle()
    if (res && (res.status !== "active" || new Date(res.expires_at) < new Date())) {
      // Reservation expired — try to re-claim
      const newRid = await atomicClaimJob(job.id, driverPhone, profile?.user_id || null)
      if (!newRid) {
        return lang === "es"
          ? "ese sitio se lo llevo otro driver mientras esperabamos, dejame buscarte otro"
          : "that site got taken while we were waiting, let me find you another one"
      }
      conv.reservation_id = newRid
    }
  }

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

  // Send address as a SEPARATE SMS so iOS/Android map-link previews don't get crowded by the summary text
  try { await sendSMS(driverPhone, `${job.client_address}`) } catch {}
  // Small delay so the address arrives first in driver inbox before the summary
  await new Promise(r => setTimeout(r, 400))

  const lines = [
    `${city} — ${job.yards_needed} yds — $${pay}/load`,
  ]
  if (job.notes) lines.push(`Note: ${job.notes}`)
  if (mapUrl) lines.push(`Map: ${mapUrl}`)
  lines.push(lang === "es" ? "avisame cuando vayas en camino" : "text me when on the way so I can have someone show you where to dump")
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

  // ═══════════════════════════════════════════════════
  // IDENTITY & PERSONALITY — handle people testing the bot
  // These fire in ANY state so the system never breaks
  // ═══════════════════════════════════════════════════
  if (/\b(are you a bot|are you ai|is this a bot|is this ai|is this automated|are you real|are you a robot|you a bot|this a bot|eres robot|eres un bot)\b/i.test(lower)) {
    return { response: pick(["nah this is jesse","lol nah im real","this is jesse from dumpsite","nah bro its me jesse"]), updates: {}, action: "NONE" }
  }
  if (/\b(prove.*(real|human|not.*bot)|how do i know.*(real|human))\b/i.test(lower)) {
    return { response: pick(["what you want me to do a backflip through the phone","I mean I can call you if you want","bro im sitting here in dallas texting you"]), updates: {}, action: "NONE" }
  }
  if (/\b(scam|fraud|fake|legit|legitimate|estafa)\b/i.test(lower)) {
    return { response: pick(["did we ask for your credit card info","bro we pay YOU","check us out dumpsite.io"]), updates: {}, action: "NONE" }
  }
  if (/^fuck you\s*$/i.test(lower) || /^fuck off\s*$/i.test(lower)) {
    return { response: pick(["fuck you too","lol aight","ok"]) + pick([", you need a dumpsite or what",", anyway you got dirt or nah",""]), updates: {}, action: "NONE" }
  }
  if (/fuck your (mom|mother|mama)/i.test(lower)) {
    return { response: "fuck your dead grandma" + pick([", anyway you got dirt or nah",", you need a site or what",""]), updates: {}, action: "NONE" }
  }
  if (/\b(who is this|whos this|who are you|who dis|whats your name|what is your name|como te llamas|quien eres)\b/i.test(lower)) {
    return { response: pick(["jesse from dumpsite","this is jesse, dumpsite.io","jesse — I broker dirt in DFW"]), updates: {}, action: "NONE" }
  }
  if (/\b(what company|which company|que empresa|que compania)\b/i.test(lower)) {
    return { response: pick(["DumpSite.io","dumpsite.io — we match drivers with paid dump sites"]), updates: {}, action: "NONE" }
  }
  if (/\b(where (are )?you (from|at|located)|donde estas|de donde eres)\b/i.test(lower)) {
    return { response: pick(["Dallas","out of Dallas","Dallas Texas"]), updates: {}, action: "NONE" }
  }
  if (/\b(how.*(your|ur) day|how are you|how you doing|como estas|como te va)\b/i.test(lower) && !(/dirt|dump|haul|load|material|tierra/i.test(lower))) {
    return { response: pick(["good man just grinding","cant complain","good, staying busy"]) + pick([", you got dirt today","",", whats good"]), updates: {}, action: "NONE" }
  }

  // ═══════════════════════════════════════════════════
  // STUPID / RANDOM / UNEXPECTED — handle EVERYTHING
  // Fire in ANY state so system never breaks
  // ═══════════════════════════════════════════════════

  // ── GIBBERISH / LAZY ──
  if (/^[\?\.\!\,\s]+$/.test(body) || /^\?+$/.test(lower)) {
    return { response: pick(["whats up","you good","what you need"]), updates: {}, action: "NONE" }
  }
  if (/^(k|kk|ok|lol|lmao|haha|ha|😂|👍|💪|🤙|😎|👌|bet)$/i.test(lower)) {
    // Don't respond to pure acknowledgments during active flow — just ignore
    if (state === "ACTIVE" || state === "OTW_PENDING") return { response: "10.4", updates: {}, action: "NONE" }
    return null // Let Sonnet handle contextually
  }
  if (/^\.+$/.test(body.trim())) {
    return { response: pick(["you there","whats up","you need something"]), updates: {}, action: "NONE" }
  }

  // ── CONFUSED ABOUT DUMPSITE ──
  if (/\b(what is (this|dumpsite)|what.*(dumpsite|dump site) do|how does this work|como funciona|que es esto)\b/i.test(lower)) {
    return { response: pick(["DumpSite.io — we match drivers with paid dump sites across DFW. You got dirt you need to dump, we find you a site and pay you per load","we connect drivers who have dirt with sites that need fill. you haul it there, we pay you per load"]), updates: {}, action: "NONE" }
  }
  if (/\b(i need dirt|need.*buy.*dirt|sell.*dirt|do you sell|buy.*dirt|where can i get dirt|necesito tierra|venden tierra)\b/i.test(lower)) {
    return { response: pick(["we dont sell dirt, we find dump sites for drivers who HAVE dirt to get rid of. You got dirt you need to dump","nah we dont sell, we pay drivers to dump their dirt at our sites. You sitting on some dirt"]), updates: {}, action: "NONE" }
  }
  if (/\b(who gave you my number|how did you get my number|how you get my number|donde sacaste mi numero|spam)\b/i.test(lower)) {
    return { response: pick(["you signed up on dumpsite.io or someone referred you. You got dirt to move","you registered on our site. If you dont want texts reply STOP"]), updates: {}, action: "NONE" }
  }
  if (/^(wrong number|wrong person|no soy|i didn.?t text|i did not text|quien es)\s*$/i.test(lower)) {
    return { response: pick(["my bad, if you ever need a dumpsite hit us up. DumpSite.io","all good, reply STOP if you dont want texts"]), updates: {}, action: "NONE" }
  }
  if (/\b(what is this|who is this|que es esto|quien es)\b/i.test(lower) && !(/dumpsite/i.test(lower))) {
    return { response: pick(["this is jesse from DumpSite.io, we match drivers with paid dump sites","jesse from dumpsite — we pay drivers to dump dirt at our sites"]), updates: {}, action: "NONE" }
  }

  // ── ON-SITE PROBLEMS ──
  if (/\b(gate.*(lock|closed|shut)|locked|cerrado|no puedo entrar|cant get in|can.?t get in)\b/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: pick(["let me call the site owner, give me a min","hold on let me get ahold of them"]), updates: {}, action: "NONE" }
  }
  if (/\b(nobody here|no one here|no ones here|nadie aqui|nadie esta|where is everyone|empty)\b/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: pick(["let me call them real quick, standby","give me a sec let me reach the site owner"]), updates: {}, action: "NONE" }
  }
  if (/\b(where do i dump|where exactly|donde tiro|donde descargo|where do i go|which way|where.*(put|dump|drop))\b/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: pick(["let me check with the site owner, one sec","standby let me find out for you"]), updates: {}, action: "NONE" }
  }
  if (/\b(i.?m lost|cant find|can.?t find|no encuentro|estoy perdido|wrong turn|wrong address)\b/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: pick(["send me your location and I'll get you there","where you at right now, I'll help you find it"]), updates: {}, action: "NONE" }
  }
  if (/\b(broke down|broken down|flat tire|truck broke|engine|overheated|se descompuso|se poncho)\b/i.test(lower)) {
    return { response: pick(["damn that sucks, no worries. hit me up when you back rolling","all good man, text me when you get it going again"]), updates: {}, action: "NONE" }
  }
  if (/\b(rain|raining|lluvia|lloviendo|weather|storm|tormenta|flooding|flooded)\b/i.test(lower)) {
    return { response: pick(["yea this weather is trash. you wanna hold off","no worries, hit me up when it clears up"]), updates: {}, action: "NONE" }
  }

  // ── MATERIAL ISSUES ──
  if (/\b(concrete|asphalt|asbestos|trash|basura|escombro|demolition|c&d|construction debris)\b/i.test(lower) && state !== "PHOTO_PENDING") {
    return { response: pick(["we only do clean fill dirt, no concrete or debris. You got clean dirt","nah we cant take that, clean fill only. You got any clean dirt"]), updates: {}, action: "NONE" }
  }
  if (/\b(topsoil|top soil|caliche|sand|arena|gravel|grava|clay|arcilla)\b/i.test(lower) && state !== "PHOTO_PENDING") {
    return { response: pick(["send me a pic and I'll let you know if it works","yea might work, send me a picture of it"]), updates: {}, action: "NONE" }
  }
  if (/\b(mixed|2 types|two types|different.*dirt|mezclado|revuelto)\b/i.test(lower)) {
    return { response: pick(["send me a pic and I'll see if it works","yea send me a picture, I'll check with the site"]), updates: {}, action: "NONE" }
  }

  // ── BUSINESS QUESTIONS ──
  // "too far" / "anything closer" / "what else" / "what about [city]" / "no" during job presentation — show next available job
  if (/\b(too far|thats far|muy lejos|esta lejos|anything closer|got.*closer|something closer|mas cerca|anything else|what else|next one|otro sitio|otra opcion|something else|other option|show me another|got another|que mas tienes|what about|how about|que hay en|nah what about|no what about)\b/i.test(lower) || (state === "JOB_PRESENTED" && /^(no|nah|nope|pass|too far|negative|nel|na|next)$/i.test(lower))) {
    if (!hasTruck) {
      return { response: pick(lang==="es" ? ["que tipo de camion tienes"] : ["what kind of truck you running"]), updates: { state: "ASKING_TRUCK" }, action: "NONE" }
    }
    // Track ALL rejected job IDs (stored comma-separated in job_state during JOB_PRESENTED)
    const currentJobId = conv?.pending_approval_order_id
    const priorRejected = (conv?.job_state || "").split(",").filter(Boolean)
    const allRejected = new Set([...priorRejected, ...(currentJobId ? [currentJobId] : [])])
    const nextJob = nearbyJobs.find(j => !allRejected.has(j.id))
    if (nextJob) {
      const payDollars = Math.round(nextJob.driverPayCents / 100)
      const truckLabel = formatTruckAccess(nextJob.truckTypeNeeded)
      const resp = lang === "es"
        ? `Tengo ${nextJob.cityName} ${nextJob.distanceMiles.toFixed(0)} millas — ${nextJob.yardsNeeded} yardas — $${payDollars}/carga — ${truckLabel} — te sirve`
        : `I got ${nextJob.cityName} ${nextJob.distanceMiles.toFixed(0)} miles — ${nextJob.yardsNeeded} yds — $${payDollars}/load — ${truckLabel} — think that works`
      const rejectedList = [...allRejected].join(",")
      return { response: resp, updates: { state: "JOB_PRESENTED", pending_approval_order_id: nextJob.id, job_state: rejectedList }, action: "NONE" }
    }
    return { response: pick(lang==="es" ? ["eso es todo lo que tengo ahorita, te aviso si sale algo mas"] : ["thats all I got right now, I'll hit you up when something opens up"]), updates: { job_state: null }, action: "NONE" }
  }
  if (/\b(too low|too cheap|not enough|mas dinero|more money|better.*price|can you do better|better rate|raise.*price|mas precio)\b/i.test(lower)) {
    return null // Let Sonnet negotiate
  }
  if (/\b(how many loads|is there a limit|any limit|cuantas cargas puedo|load limit|max loads)\b/i.test(lower)) {
    return { response: pick(["no limit, dump as many as you can","as many as you can haul, no cap"]), updates: {}, action: "NONE" }
  }
  if (/\b(come back tomorrow|can i come back|puedo regresar|come.*another day|tomorrow too)\b/i.test(lower)) {
    return { response: pick(["yea for sure, just text me when you heading out","absolutely, just hit me up when you ready"]), updates: {}, action: "NONE" }
  }
  if (/\b(call me|can you call|llamame|puedes llamar|give me a call|need.*call)\b/i.test(lower)) {
    return { response: pick(["I'm better on text, whats up","text is easier for me, what you need"]), updates: {}, action: "NONE" }
  }
  if (/\b(receipt|invoice|recibo|factura|proof|documentation|tax)\b/i.test(lower)) {
    return { response: pick(["yea I can send you a summary after, no problem","we'll get you that after the loads are done"]), updates: {}, action: "NONE" }
  }
  if (/\b(what.*hours|when.*open|site.*hours|horario|que horas|open.*weekend|weekend|saturday|sunday|sabado|domingo)\b/i.test(lower)) {
    return { response: pick(["most sites open 7am-5pm monday thru saturday","sites usually run 7 to 5 monday thru saturday, some open sunday"]), updates: {}, action: "NONE" }
  }
  if (/\b(insurance|insured|licensed|license|bonded|insur|seguro|licencia)\b/i.test(lower)) {
    return { response: pick(["yea we're legit, dumpsite.io. check the site","we're good, fully set up. DumpSite.io"]), updates: {}, action: "NONE" }
  }
  if (/\b(bring.*buddy|another driver|got.*friend|my boy|my partner|mi compa|otro chofer|more drivers)\b/i.test(lower)) {
    return { response: pick(["yea have them text this number and I'll get them set up too","for sure, tell them to text me and I'll hook them up"]), updates: {}, action: "NONE" }
  }
  if (/\b(do you have anything|got any(thing)?|any jobs|any work|tienes algo|hay trabajo)\b/i.test(lower) && (state === "DISCOVERY" || state === "CLOSED")) {
    // Must know truck type before presenting jobs — wrong truck = wrong site access
    if (!hasTruck) {
      return { response: pick(lang==="es"
        ? ["si tengo sitios, que tipo de camion tienes"]
        : ["yea I got sites, what kind of truck you running"]), updates: { state: "ASKING_TRUCK" }, action: "NONE" }
    }
    // If we found nearby jobs from a city they mentioned, present the closest
    if (nearbyJobs.length > 0) {
      const job = nearbyJobs[0]
      const payDollars = Math.round(job.driverPayCents / 100)
      const truckLabel = formatTruckAccess(job.truckTypeNeeded)
      const resp = lang === "es"
        ? `Tengo ${job.cityName} ${job.distanceMiles.toFixed(0)} millas — ${job.yardsNeeded} yardas — $${payDollars}/carga — ${truckLabel} — te sirve`
        : `I got ${job.cityName} ${job.distanceMiles.toFixed(0)} miles — ${job.yardsNeeded} yds — $${payDollars}/load — ${truckLabel} — think that works`
      return { response: resp, updates: { state: "JOB_PRESENTED", pending_approval_order_id: job.id, extracted_city: job.cityName }, action: "NONE" }
    }
    // No location info yet — ask for their address
    return { response: pick(lang==="es"
      ? ["si tengo sitios, mandame la direccion de donde cargan y te busco el mas cerca"]
      : ["yea I got sites open, whats the address your coming from so I can find the closest one","I got spots, send me the address your loading from and I'll find whats nearest"]), updates: { state: "ASKING_ADDRESS" }, action: "NONE" }
  }

  // ── PHOTO AVOIDANCE ──
  if (/\b(no.*(pic|photo|picture|foto)|dont have.*(pic|photo|camera)|can.?t.*(pic|photo|take)|camera.*(broke|broken|doesnt)|skip.*(pic|photo)|later.*(pic|photo)|trust me|no tengo foto|sin foto|no puedo tomar|just send.*(address|addy)|send me the address|give me the address)\b/i.test(lower) && (state === "PHOTO_PENDING" || state === "JOB_PRESENTED")) {
    return { response: pick(lang==="es" ? ["necesito una foto de la tierra para que el sitio lo apruebe, es rapido"] : ["I need a picture of the dirt to get approval from the site, just a quick pic","gotta have a pic of the material for the site to approve it, real quick one"]), updates: {}, action: "NONE" }
  }

  // ── FIX #1: DRIVER SAYS YES THEN IMMEDIATELY NO ──
  if (/^(actually no|actually nah|nvm|never ?mind|wait no|hold on no|changed my mind|ya no|no ya|cancel that)$/i.test(lower) && (state === "PHOTO_PENDING" || state === "JOB_PRESENTED" || state === "APPROVAL_PENDING")) {
    return { response: pick(lang==="es" ? ["10.4 sin problema, avisame si necesitas algo"] : ["all good, hit me up when you ready","no worries, text me when you got another load"]), updates: { state: "DISCOVERY", pending_approval_order_id: null }, action: "NONE" }
  }

  // ── FIX #3: LOAD COUNT IN WORDS ──
  const wordNums: Record<string,number> = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, fifteen:15, twenty:20, dozen:12, un:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10 }
  if ((state === "ACTIVE" || state === "OTW_PENDING")) {
    const wordMatch = lower.match(/\b(dropped|delivered|dumped|did|hauled|tiramos|tire|hice)\b.*?\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|dozen|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i)
    if (wordMatch) {
      const count = wordNums[wordMatch[2].toLowerCase()]
      if (count) {
        return { response: "__DELIVERY__:" + count, updates: { state: "AWAITING_CUSTOMER_CONFIRM" }, action: "COMPLETE_JOB" }
      }
    }
  }

  // ── FIX #4: "DONE FOR THE DAY" vs "DONE WITH LOADS" ──
  if (/\b(done for (the |to)?day|done for now|calling it|heading home|ya me voy|me retiro|thats it for today|thats all for today|im out)\b/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: pick(lang==="es" ? ["10.4 cuantas cargas tiraste hoy en total"] : ["10.4 how many loads total you drop today","copy, how many loads you get in"]), updates: {}, action: "NONE" }
  }

  // ── FIX #8: CASHAPP / PAYPAL / CASH ──
  if (state === "PAYMENT_METHOD_PENDING") {
    if (/cash\s*app|cashapp/i.test(lower)) {
      return { response: pick(["we only do zelle or venmo right now, which one works for you"]), updates: {}, action: "NONE" }
    }
    if (/paypal|pay\s*pal/i.test(lower)) {
      return { response: pick(["no paypal, just zelle or venmo. which one"]), updates: {}, action: "NONE" }
    }
    if (/^cash$/i.test(lower) || /pay.*cash|in cash|efectivo/i.test(lower)) {
      return { response: pick(["we do zelle or venmo, no cash. which one works"]), updates: {}, action: "NONE" }
    }
  }

  // ── FIX #9: "DID YOU SEND PAYMENT" / "I DIDN'T GET PAID" ──
  if (/\b(did you (send|pay)|you (send|pay) (it|me)|i didn.?t get paid|haven.?t been paid|still waiting.*pay|where.?s my (money|pay)|cuando me pagan|no me han pagado|ya me pagaron)\b/i.test(lower)) {
    return { response: pick(lang==="es"
      ? ["los pagos se mandan al final del dia en batch, si no te llega hoy mandame texto manana y lo verifico"]
      : ["payments go out end of day in batches, if it doesnt hit by tonight text me tomorrow and I'll check on it","should go out today, all payments process end of day. if you dont see it by tomorrow lmk"]), updates: {}, action: "NONE" }
  }

  // ── FIX #10: CHANGE PAYMENT INFO ──
  if (/\b(change.*(zelle|venmo|payment)|different.*(zelle|venmo|account)|update.*(zelle|venmo|payment)|new.*(zelle|venmo|account)|cambiar.*(zelle|venmo|pago))\b/i.test(lower)) {
    return { response: pick(lang==="es" ? ["dale, mandame la nueva info"] : ["no problem, send me the new info"]), updates: { state: "PAYMENT_ACCOUNT_PENDING" }, action: "NONE" }
  }

  // ── FIX #12: SITE-SPECIFIC QUESTIONS ──
  if (/\b(who do i (talk|speak|ask)|who.?s the contact|contact at the site|quien esta ahi|con quien hablo|check in)\b/i.test(lower)) {
    return { response: pick(["when you get there someone will show you where to dump, just text me when you pull up","the site owner will be there, just text me when you arrive"]), updates: {}, action: "NONE" }
  }
  if (/\b(scale|weigh|weight limit|peso|bascula|tonnage|tons)\b/i.test(lower)) {
    return { response: pick(["no scale, just dump and go","nah no scale on site, just dump it"]), updates: {}, action: "NONE" }
  }
  if (/\b(tarp|tarping|cover|lona|cubrir)\b/i.test(lower)) {
    return { response: pick(["nah no tarp needed","you good, no tarping required"]), updates: {}, action: "NONE" }
  }
  if (/\b(room for|fit.*(semi|truck|rig)|wide enough|entrance|turn around|dar vuelta|espacio)\b/i.test(lower)) {
    return { response: pick(["yea theres room, you'll be good","should be fine, other trucks get in and out no problem"]), updates: {}, action: "NONE" }
  }
  if (/\b(site.*(full|closed|shut)|no more room|already full|ya esta lleno|no hay espacio)\b/i.test(lower)) {
    return { response: pick(["let me check on that, give me a sec","hold on let me call them"]), updates: {}, action: "NONE" }
  }
  if (/\b(rude|asshole|pendejo|attitude|disrespect|grosero|mala onda|being a dick)\b/i.test(lower)) {
    return { response: pick(["my bad bro, let me talk to them. that aint cool","damn sorry about that, I'll handle it"]), updates: {}, action: "NONE" }
  }
  if (/\b(rejected|said.*not clean|wont accept|didnt accept|no.*accept|rechazaron|no.*aceptaron|turned.*away)\b/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: pick(["damn, send me a pic of what they're looking at and let me talk to them","my bad, let me call the site owner real quick"]), updates: {}, action: "NONE" }
  }
  if (/\b(spread|spread it|want me to spread|esparcir|regar)\b/i.test(lower)) {
    return { response: pick(["nah just dump it, you dont need to spread","dump and go, spreading aint part of the deal"]), updates: {}, action: "NONE" }
  }
  if (/\b(po number|purchase order|orden de compra|work order)\b/i.test(lower)) {
    return { response: pick(["no PO needed, we handle all that on our end","you dont need one, we track everything"]), updates: {}, action: "NONE" }
  }
  if (/\b(wet|mojado|wet dirt|muddy|lodo|mud)\b/i.test(lower) && (state === "PHOTO_PENDING" || state === "DISCOVERY")) {
    return { response: pick(["send me a pic and I'll check if the site takes it","yea might be fine, send me a picture"]), updates: {}, action: "NONE" }
  }
  if (/\b(my truck holds|truck.*holds|capacity|capacidad|cuanto cabe)\b/i.test(lower)) {
    return { response: pick(["you good, just haul what you can","thats fine, bring whatever your truck holds"]), updates: {}, action: "NONE" }
  }
  if (/\b(someone else.*(phone|number)|my buddy.*(phone|texting)|using.*(his|her|their) phone|desde otro telefono)\b/i.test(lower)) {
    return { response: pick(["have them text me from their number so I can set them up","they gotta text me from their own phone so I can track their loads"]), updates: {}, action: "NONE" }
  }

  // ═══════════════════════════════════════════════════
  // DEEP EDGE CASES — unbreakable layer
  // ═══════════════════════════════════════════════════

  // ── EMPTY / WHITESPACE ONLY ──
  if (!body.trim() && !hasPhoto) {
    return { response: pick(["you there","whats up","you need something"]), updates: {}, action: "NONE" }
  }

  // ── ZIP CODE MISTAKEN FOR YARDS ──
  if (/^\d{5}$/.test(lower) && !hasYards && (state === "DISCOVERY" || state === "ASKING_ADDRESS")) {
    return { response: pick(["is that a zip code? I need the full address so I can find whats closest","send me the full street address not just the zip"]), updates: {}, action: "NONE" }
  }

  // ── PHONE NUMBER GIVEN AS TEXT (not payment info) ──
  if (/^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(body.trim()) && state !== "PAYMENT_ACCOUNT_PENDING") {
    return { response: pick(["I'm better on text, what you need","text is faster for me, whats going on"]), updates: {}, action: "NONE" }
  }

  // ── DOLLAR AMOUNT — negotiation or confusion ──
  if (/^\$\d+/.test(body.trim()) && state !== "PAYMENT_METHOD_PENDING" && state !== "PAYMENT_ACCOUNT_PENDING") {
    return null // Let Sonnet handle negotiation
  }

  // ── TIME — "3pm" "at 7" "in the morning" ──
  if (/^\d{1,2}\s*(am|pm|a\.m|p\.m)$/i.test(lower) || /^(morning|afternoon|evening|manana|en la manana|en la tarde)$/i.test(lower)) {
    return { response: pick(["what time works for you is fine, just text me when you heading out","whenever works, just hit me up when you ready to roll"]), updates: {}, action: "NONE" }
  }

  // ── UNREASONABLE LOAD COUNT ──
  if (/^\d+$/.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    const n = parseInt(lower)
    if (n === 0) {
      return { response: pick(["so you didnt dump any? whats going on","zero loads? what happened"]), updates: {}, action: "NONE" }
    }
    if (n > 50) {
      return { response: pick(["thats a lot of loads bro, whats the real count","for real? how many loads you actually drop"]), updates: {}, action: "NONE" }
    }
  }

  // ── "HALF A LOAD" / PARTIAL ──
  if (/\b(half|partial|medio|media|not full|not a full)\b/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: pick(["that counts as 1 load","yea just count it as 1"]), updates: {}, action: "NONE" }
  }

  // ── RELATIVE LOCATIONS (not real addresses) ──
  if (/\b(behind|next to|across from|near the|by the|off of|off the|al lado|cerca de|atras de|junto a)\b/i.test(lower) && (state === "ASKING_ADDRESS" || !hasCity)) {
    return { response: pick(["I need the actual street address so I can put it in my system","send me the street address with the number, like 1234 Main St"]), updates: {}, action: "NONE" }
  }

  // ── CROSS STREETS ──
  // Cross streets are now handled by the location extraction block below — Google geocodes
  // intersections fine. We only fall back to asking for an address if geocoding fails.

  // ── "HELP" — actual help request, not reset ──
  if (/^help$/i.test(lower)) {
    return { response: pick(["whats up, how can I help","what you need"]), updates: {}, action: "NONE" }
  }

  // ── COMPOUND MESSAGE — driver drops all info at once ──
  if (body.length > 50 && state === "DISCOVERY" && !hasYards) {
    const compoundYards = body.match(/(\d+)\s*(yds?|yards?|yardas?)/i)
    const compoundTruck = parseTruck(body)
    const compoundCount = body.match(/(\d+)\s*(trucks?|camion)/i)
    if (compoundYards) {
      const updates: Record<string,any> = { extracted_yards: parseInt(compoundYards[1]) }
      if (compoundTruck) updates.extracted_truck_type = compoundTruck
      if (compoundCount) updates.extracted_truck_count = parseInt(compoundCount[1])
      // Check for address in the compound message
      const hasAddr = /\d{2,}\s+\w+\s+(st|ave|blvd|dr|rd|ln|way|ct|hwy|fm)/i.test(body)
      if (hasAddr && compoundTruck) {
        // Has everything — try to present a job
        return null // Let the normal flow handle with enriched data
      }
      // Return next missing piece
      if (!compoundTruck) {
        return { response: pick(lang==="es" ? ["10.4 que tipo de camion tienes"] : ["got it, what kind of truck you running"]), updates, action: "NONE" }
      }
      if (!compoundCount) {
        return { response: pick(lang==="es" ? ["10.4 cuantos camiones traes"] : ["copy, how many trucks you got running"]), updates, action: "NONE" }
      }
      return { response: pick(lang==="es" ? ["10.4 cual es la direccion de donde cargan"] : ["10.4 whats the address your loading from"]), updates, action: "NONE" }
    }
  }

  // ── AUTO-REPLY / DRIVING MESSAGES ──
  if (/\b(im driving|currently driving|driving right now|i.?ll (call|text|get) (you |)back|auto.?reply|manejando|estoy manejando|busy right now|in a meeting)\b/i.test(lower)) {
    return { response: pick(["no rush, text me when you free","all good hit me up later"]), updates: {}, action: "NONE" }
  }

  // ── FORWARDED MESSAGES ──
  if (/^(fwd|fw|forwarded|reenviado)[\s:]/i.test(lower)) {
    return { response: pick(["I cant read forwarded messages, just tell me whats up","whats this about"]), updates: {}, action: "NONE" }
  }

  // ── MANAGER / ESCALATION ──
  if (/\b(manager|supervisor|boss|owner|jefe|dueno|speak.*(manager|someone)|talk.*(manager|boss)|higher up)\b/i.test(lower)) {
    return { response: pick(["you're talking to him, whats going on","this is it bro, whats the issue"]), updates: {}, action: "NONE" }
  }

  // ── VERY LONG MESSAGE (>200 chars) that isn't an address ──
  if (body.length > 200 && !/\d{2,}\s+\w+.*(st|ave|blvd|dr|rd|ln|way|hwy)/i.test(body)) {
    return null // Let Sonnet handle — it can parse long messages
  }

  // ── AMBIGUOUS "2" — could be yards, trucks, or loads ──
  if (/^[2-9]$/.test(lower) && state === "DISCOVERY" && !hasYards && !hasTruck) {
    // Single digit in DISCOVERY with nothing collected — assume yards
    return { response: pick(lang==="es" ? ["que tipo de camion tienes"] : ["what kind of truck you running"]), updates: { extracted_yards: parseInt(lower) }, action: "NONE" }
  }

  // ── CITY NAME TYPOS — common DFW misspellings ──
  const cityTypos: Record<string,string> = {
    "ft worth":"Fort Worth", "ft. worth":"Fort Worth", "fortworth":"Fort Worth", "fourt worth":"Fort Worth",
    "dalls":"Dallas", "dallass":"Dallas", "dal":"Dallas",
    "arlington":"Arlington", "arlinton":"Arlington",
    "waxa":"Waxahachie", "waxahatchie":"Waxahachie", "waxahachee":"Waxahachie",
    "mckinney":"McKinney", "mckinny":"McKinney", "mkinney":"McKinney",
    "lewisvile":"Lewisville", "lewsiville":"Lewisville",
    "dennison":"Denison", "denisson":"Denison",
    "midlothain":"Midlothian", "midlothien":"Midlothian",
    "colleyville":"Colleyville", "collyville":"Colleyville",
    "grapvine":"Grapevine", "gravevine":"Grapevine",
  }
  const typoCity = cityTypos[lower] || cityTypos[lower.replace(/[^a-z ]/g, "")]
  if (typoCity && (state === "ASKING_ADDRESS" || state === "DISCOVERY" || state === "CLOSED")) {
    if (!hasTruck) {
      return { response: pick(lang==="es" ? ["que tipo de camion tienes"] : ["what kind of truck you running"]), updates: { extracted_city: typoCity, state: "ASKING_TRUCK" }, action: "NONE" }
    }
    // If we already have nearby jobs (from inline city extraction), present the closest one
    if (nearbyJobs.length > 0) {
      const job = nearbyJobs[0]
      const payDollars = Math.round(job.driverPayCents / 100)
      const truckLabel = formatTruckAccess(job.truckTypeNeeded)
      const resp = lang === "es"
        ? `Tengo ${job.cityName} ${job.distanceMiles.toFixed(0)} millas — ${job.yardsNeeded} yardas — $${payDollars}/carga — ${truckLabel} — te sirve`
        : `I got ${job.cityName} ${job.distanceMiles.toFixed(0)} miles — ${job.yardsNeeded} yds — $${payDollars}/load — ${truckLabel} — think that works`
      return { response: resp, updates: { extracted_city: typoCity, state: "JOB_PRESENTED", pending_approval_order_id: job.id }, action: "NONE" }
    }
    return { response: pick(lang==="es" ? ["mandame la direccion exacta de donde cargan en " + typoCity + " y te busco el sitio mas cerca"] : ["whats the exact address in " + typoCity + " so I can find the closest site"]), updates: { extracted_city: typoCity, state: "ASKING_ADDRESS" }, action: "NONE" }
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

  const loadMatch1 = lower.match(/^(\d{1,3})\s*(loads?|down|total|done|delivered|drops?|cargas?)?$/)
  const loadMatch2 = lower.match(/(done|delivered|dropped|tiramos)\s+(\d{1,3})/i)
  const loadMatch = loadMatch1 || loadMatch2
  if (loadMatch && activeJob && (state === "ACTIVE" || state === "OTW_PENDING")) {
    const loads = parseInt(loadMatch1 ? loadMatch1[1] : loadMatch2![2])
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
    // Let driver switch payment method or escape
    if (/\b(zelle|venmo|check|cheque)\b/i.test(lower) && /\b(switch|change|different|instead|actually|mejor|cambiar)\b/i.test(lower)) {
      return { response: pick(lang==="es" ? ["dale, zelle o venmo"] : ["no problem, zelle or venmo"]), updates: { state: "PAYMENT_METHOD_PENDING", job_state: null }, action: "NONE" }
    }
    if (/^(zelle)$/i.test(lower)) {
      return { response: pick(lang==="es" ? ["mandame el nombre y numero de tu zelle"] : ["send the name and number the zelle account it to"]), updates: { state: "PAYMENT_ACCOUNT_PENDING", job_state: "zelle" }, action: "NONE" }
    }
    if (/^(venmo)$/i.test(lower)) {
      return { response: pick(lang==="es" ? ["mandame tu venmo"] : ["whats your venmo"]), updates: { state: "PAYMENT_ACCOUNT_PENDING", job_state: "venmo" }, action: "NONE" }
    }
    if (/\b(don.?t have|dont have|no tengo|i don.?t|cant|can.?t|switch|cambiar)\b/i.test(lower)) {
      return { response: pick(lang==="es" ? ["dale, zelle o venmo"] : ["no problem, zelle or venmo"]), updates: { state: "PAYMENT_METHOD_PENDING", job_state: null }, action: "NONE" }
    }
    // Block conversational words from being saved as accounts
    const CONVERSATIONAL = /^(yes|yeah|no|nah|ok|okay|sure|hey|hi|hello|yo|sup|what|why|how|when|where|who|send|help|please|thanks|thank|cool|good|nice|bet|done|idk|nope|yep|yea|lol|haha|damn|bro|man|dude|word|bruh|right|true|copy|got it|aight|my venmo|my zelle|venmo|zelle|check)$/i
    const looksLikeAccount = /\d{7,}/.test(body) || /@/.test(body) || (/^@?\w{4,}$/.test(body.trim()) && !CONVERSATIONAL.test(body.trim())) || /^[A-Z][a-z]+ [A-Z][a-z]+/.test(body.trim()) || /^[a-z]+\s+\d{3}/i.test(body.trim())
    if (looksLikeAccount) {
      return { response: pick(lang==="es" ? ["listo, te mandamos en rato"] : ["got it, we will have it sent shortly"]), updates: { state: "CLOSED" }, action: "COLLECT_PAYMENT" }
    }
    const method = conv?.job_state || "zelle"
    // Use __PAY_REASK__ marker — template caller counts these in history to escalate
    if (method === "venmo") {
      return { response: "__PAY_REASK__:venmo", updates: {}, action: "NONE" }
    }
    return { response: "__PAY_REASK__:zelle", updates: {}, action: "NONE" }
  }

  if (state === "APPROVAL_PENDING") {
    return { response: pick(lang==="es" ? ["todavia esperando confirmacion, dame un min","dejame verificar, ya mero"] : ["still waiting on approval, give me a min","let me check on that for you","standby waiting on approval"]), updates: {}, action: "NONE" }
  }

  // Driver asking about timing/delivery/when
  if (/\b(when can i|when do i|when should i|what time|cuando puedo|cuando empiezo|when.*deliver|when.*start|when.*go|when.*head|can i go|can i start|ready to go|listo para)\b/i.test(lower)) {
    if (state === "PHOTO_PENDING") {
      return { response: pick(lang==="es" ? ["mandame una foto de la tierra primero y ya te confirmo"] : ["send me a pic of the dirt first then I can get you going"]), updates: {}, action: "NONE" }
    }
    if (state === "ACTIVE" || state === "OTW_PENDING") {
      return { response: pick(lang==="es" ? ["ya puedes ir, tienes la direccion"] : ["you good to go, you got the address"]), updates: {}, action: "NONE" }
    }
  }

  // ═══════════════════════════════════════════════════
  // CLOSED — job done, payment handled. Be natural.
  // ═══════════════════════════════════════════════════
  if (state === "CLOSED") {
    // Gratitude
    if (/thanks|thank you|thx|appreciate|gracias|good looking out|preciate|thank u|ty/i.test(lower)) {
      return { response: pick(lang==="es" ? ["de nada","a la orden","sin problema"] : ["no problem","anytime","you got it","for sure"]), updates: {}, action: "NONE" }
    }
    // Payment questions — when will I get paid, how long, etc.
    if (/pay|paid|payment|money|cash|dinero|pago|cuando.*pagan|when.*get.*paid|how long|direct deposit|deposit/i.test(lower)) {
      return { response: pick(lang==="es"
        ? ["los pagos se procesan al final del dia, hacemos en batch con los demas drivers","se manda hoy en la noche, procesamos todos los pagos juntos"]
        : ["payments go out end of day, we process them in batches with the other drivers","we send them out tonight, all payments go out together at end of day","should hit your account by tonight, we do all the payments in one batch"]),
        updates: {}, action: "NONE" }
    }
    // Casual greeting — driver coming back
    if (/^(hey|hello|hi|yo|sup|whats up|what up|que onda|hola|wassup|wsg|howdy)$/i.test(lower) || /^(hey|hi|hello|yo)[\s,!.]*$/i.test(lower)) {
      return { response: pick(lang==="es"
        ? ["que onda, tienes mas tierra","como estas, andas con mas material hoy"]
        : ["whats up, you got more dirt","hey how you doing, you got more material to move","hey whats going on, you sitting on more dirt"]),
        updates: { state: "DISCOVERY" }, action: "NONE" }
    }
    // Driver asking about jobs / mentioning a city / wanting to work
    // If we have nearby jobs already (from city they mentioned), present the closest one
    // Otherwise reset to DISCOVERY and start qualification
    if (/\b(anything|got any|any jobs|any work|tienes algo|hay trabajo|where can i|do you have|what do you have|que tienes|donde puedo|have anything|got something|need.*site|need.*dump|looking for|spots?|open)\b/i.test(lower) || /\b(denton|fort worth|dallas|arlington|waxahachie|midlothian|cleburne|mansfield|burleson|frisco|plano|mckinney|garland|irving|mesquite|grand prairie|cedar hill|desoto|lancaster|rockwall|rowlett|weatherford|azle|joshua|crowley|ennis|corsicana|hillsboro|hutchins|carrollton|colleyville)\b/i.test(lower)) {
      // Must know truck type before showing jobs — access type matters
      // KEEP truck type from previous job — driver's truck doesn't change between jobs
      if (!hasTruck) {
        return { response: pick(lang==="es"
          ? ["dale, que tipo de camion tienes"]
          : ["yea I got spots, what kind of truck you running"]),
          updates: { state: "ASKING_TRUCK", extracted_yards: null, extracted_material: null, pending_approval_order_id: null, job_state: null }, action: "NONE" }
      }
      if (nearbyJobs.length > 0) {
        const job = nearbyJobs[0]
        const payDollars = Math.round(job.driverPayCents / 100)
        const truckLabel = formatTruckAccess(job.truckTypeNeeded)
        const resp = lang === "es"
          ? `Tengo ${job.cityName} ${job.distanceMiles.toFixed(0)} millas — ${job.yardsNeeded} yardas — $${payDollars}/carga — ${truckLabel} — te sirve`
          : `I got ${job.cityName} ${job.distanceMiles.toFixed(0)} miles — ${job.yardsNeeded} yds — $${payDollars}/load — ${truckLabel} — think that works`
        return { response: resp, updates: { state: "JOB_PRESENTED", pending_approval_order_id: job.id, extracted_city: job.cityName, job_state: null }, action: "NONE" }
      }
      // No jobs found — ask for their loading address so we can find the closest site
      // Keep truck type/count — only clear location-related fields
      return { response: pick(lang==="es"
        ? ["dale, mandame la direccion de donde estan cargando y te busco el sitio mas cerca"]
        : ["yea I got spots open, whats the address your loading from so I can find the closest site","for sure, send me the address your coming from and I'll find whats closest"]),
        updates: { state: "ASKING_ADDRESS", extracted_city: null, extracted_yards: null, extracted_material: null, job_state: null }, action: "NONE" }
    }
    // Driver mentions new dirt / new job
    if (/tomorrow|manana|mañana|next week|later|got more|have more|another load|mas tierra|got dirt|have dirt|i got|need.*dump|more dirt|load ready|ready to|haul/i.test(lower)) {
      return { response: pick(lang==="es"
        ? ["dale mandame foto de la tierra cuando estes ahi","10.4 avisame cuando estes listo"]
        : ["no problem send me a pic of the dirt when you get there","10.4 just hit me up when you ready","for sure just text me when you got it ready"]),
        updates: {}, action: "NONE" }
    }
    // Anything else in CLOSED — let Sonnet handle naturally
    return null
  }

  const isYes = /^(yes|yeah|yep|yea|yessir|yessirr|yes sir|yes ma.?am|yes please|yea please|bet|fasho|si|fs|sure|absolutely|for sure|copy|10-4|10\.4|ok|okay|yup|hell yeah|hell yea|of course|definitely|correct|right|affirmative|dale|simon|claro|lets go|lets do it|down|im down|send it|works for me|that works|sounds good|im interested|i.?m interested|i.?m down|perfect|do it|go ahead)$/i.test(lower)

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
    [/tri.?ax|triax|tri\s+axle/i, "tri_axle"],
    [/quad/i, "quad_axle"],
    [/end.?dump/i, "end_dump"],
    [/belly/i, "belly_dump"],
    [/side.?dump/i, "side_dump"],
    [/super.?dump|super\s+dump/i, "super_dump"],
    [/\btransfer\s*(truck|trailer|rig)?\s*$/i, "transfer"],
    [/\bpup\b/i, "pup_trailer"],
    [/semi|18.?wheel/i, "semi"],
    [/volteo|camion de volteo/i, "end_dump"],
    [/dump\s*truck/i, "end_dump"],
  ]
  for (const [rx, val] of truckPatterns) {
    if (rx.test(lower) && (state === "ASKING_TRUCK" || state === "DISCOVERY" || !hasTruck)) {
      return { response: pick(lang==="es" ? ["cuantas camionetas tienes corriendo","cuantos camiones traes"] : ["how many trucks you got running","how many trucks you running"]), updates: { extracted_truck_type: val, state: "ASKING_TRUCK_COUNT" }, action: "NONE" }
    }
  }
  // Fallback: if state is ASKING_TRUCK and driver said something short, accept it
  if (state === "ASKING_TRUCK" && !hasTruck) {
    const mightBeTruck = /dump|truck|axle|trailer|rig|wheeler|camion/i.test(lower) || lower.split(/\s+/).length <= 3
    if (mightBeTruck && lower.length > 1 && lower.length < 30) {
      return { response: pick(lang==="es" ? ["cuantos camiones traes"] : ["how many trucks you got running"]), updates: { extracted_truck_type: lower.replace(/\s+/g, "_"), state: "ASKING_TRUCK_COUNT" }, action: "NONE" }
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

  // Address must have a street number + street type suffix OR look like "1234 Street Name City"
  const looksLikeAddress = /\d+\s+\w+.*(st|ave|blvd|dr|rd|ln|ct|way|pkwy|hwy|street|avenue|drive|road|lane|expy|expressway|fm|loop|cr|county)/i.test(body)

  // Check if message contains a known city name (word-boundary match)
  let mentionedCity = null as string | null
  for (const c of DFW_CITIES) {
    const pattern = new RegExp("\\b" + c.replace(/\s+/g, "\\s+") + "\\b", "i")
    if (pattern.test(body)) { mentionedCity = c; break }
  }

  // Driver gave an address OR a city name — fire in any qualifying state
  const isLocationInput = looksLikeAddress || (mentionedCity && (state === "ASKING_ADDRESS" || state === "DISCOVERY" || state === "CLOSED" || state === "JOB_PRESENTED"))

  if (isLocationInput && (state === "ASKING_ADDRESS" || state === "CLOSED" || state === "JOB_PRESENTED" || (!hasCity && state !== "ACTIVE" && state !== "OTW_PENDING" && state !== "PHOTO_PENDING" && state !== "APPROVAL_PENDING" && state !== "ASKING_TRUCK" && state !== "ASKING_TRUCK_COUNT"))) {

    // Must know truck type before presenting any job
    if (!hasTruck) {
      return { response: pick(lang==="es" ? ["que tipo de camion tienes"] : ["what kind of truck you running"]), updates: { extracted_city: mentionedCity, state: "ASKING_TRUCK" }, action: "NONE" }
    }

    // If driver gave a city name — present closest job if we found any, otherwise ask for address
    if (!looksLikeAddress && mentionedCity) {
      if (nearbyJobs.length > 0) {
        const job = nearbyJobs[0]
        const payDollars = Math.round(job.driverPayCents / 100)
        const truckLabel = formatTruckAccess(job.truckTypeNeeded)
        const resp = lang === "es"
          ? `Tengo ${job.cityName} ${job.distanceMiles.toFixed(0)} millas — ${job.yardsNeeded} yardas — $${payDollars}/carga — ${truckLabel} — te sirve`
          : `I got ${job.cityName} ${job.distanceMiles.toFixed(0)} miles — ${job.yardsNeeded} yds — $${payDollars}/load — ${truckLabel} — think that works`
        return { response: resp, updates: { extracted_city: mentionedCity, state: "JOB_PRESENTED", pending_approval_order_id: job.id }, action: "NONE" }
      }
      // No jobs found from city geocode — ask for exact address to improve search
      return { response: pick(lang==="es"
        ? ["mandame la direccion exacta de donde cargan y te busco el sitio mas cerca"]
        : ["send me the address your loading from so I can find whats closest","whats the exact address your coming from so I can find the closest site"]),
        updates: { extracted_city: mentionedCity, state: "ASKING_ADDRESS" }, action: "NONE" }
    }

    // Driver gave a full address — present nearest job
    if (nearbyJobs.length > 0) {
      const job = nearbyJobs[0]
      const payDollars = Math.round(job.driverPayCents / 100)
      const truckLabel = formatTruckAccess(job.truckTypeNeeded)
      const resp = lang === "es"
        ? `Tengo ${job.cityName} ${job.distanceMiles.toFixed(0)} millas de ti — ${job.yardsNeeded} yardas — $${payDollars}/carga — ${truckLabel} — te sirve`
        : `I got ${job.cityName} ${job.distanceMiles.toFixed(0)} miles from you — ${job.yardsNeeded} yds — $${payDollars}/load — ${truckLabel} — think that works`
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
    // First message — greet naturally, use name if known
    const isFirstMessage = state === "DISCOVERY" && !hasYards && !hasTruck && !hasCity
    if (isFirstMessage) {
      const name = firstName && firstName !== "Driver" ? firstName : ""
      const greetings = lang === "es"
        ? [
            name ? `que onda ${name}, tienes tierra hoy` : "que onda, tienes tierra hoy",
            name ? `como estas ${name}, tienes tierra para mover` : "como estas, tienes tierra para mover",
          ]
        : [
            name ? `how are you ${name}, you got dirt today` : "how are you, you got dirt today",
            name ? `hey ${name} whats up, you got dirt to move` : "hey whats up, you got dirt to move",
            name ? `hey ${name} how you doing, you got material to haul` : "hey how you doing, you got material to haul",
            name ? `${name} whats going on, you got dirt today` : "hey whats going on, you got dirt today",
            name ? `hey ${name} how are you, you got a load today` : "hey how are you, you got a load today",
          ]
      return { response: pick(greetings), updates: {}, action: "NONE" }
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
      instruction = "Job is DONE. Payment HANDLED. DO NOT ask about trucks, yards, addresses, or dirt. DO NOT say 'text when on way'. The delivery is FINISHED. Chat naturally like a real person. Keep it short. If driver asks about payment timing: 'payments go out end of day, we process them in batches with the other drivers'. If driver asks when money hits: 'should hit your account by tonight'. If driver says hey/hello again wanting new work: 'whats up you got more dirt' and set state to DISCOVERY. If driver mentions future dirt: 'no problem just hit me up when ready'. Remember this is the SAME driver who just finished — you know them, be casual."
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
        ? `Jobs available (show city+distance+yards+pay+truck access ONLY, never addresses):\n${nearbyJobs.slice(0,3).map(j =>
            `  ${j.cityName} ${j.distanceMiles.toFixed(0)}mi ${j.yardsNeeded}yds $${Math.round(j.driverPayCents/100)}/load ${formatTruckAccess(j.truckTypeNeeded)} id:${j.id}`
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

  const attemptBrain = async (): Promise<BrainOutput> => {
    const resp = await anthropic.messages.create({
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
  }

  try {
    return await attemptBrain()
  } catch (firstErr) {
    console.error("[Brain] attempt 1 failed, retrying in 2s:", raw?.slice(0,200), firstErr)
    // Retry once after 2s
    try {
      await new Promise(r => setTimeout(r, 2000))
      return await attemptBrain()
    } catch (retryErr) {
      console.error("[Brain] attempt 2 failed, using template fallback:", retryErr)
      // Notify admin that Sonnet is down
      try { await sendAdminAlert(`SONNET DOWN: Jesse brain failed twice. Driver ${conv?.phone || "unknown"} got template fallback. Error: ${(retryErr as any)?.message || "unknown"}`) } catch {}
      // Context-aware template fallback
      const fb: Record<string,string> = {
        DISCOVERY: lang==="es"?pick(["que onda, tienes tierra hoy","como estas, tienes tierra"]):pick(["how are you, you got dirt today","hey whats up, you got material to haul","hey how you doing, you got dirt to move"]),
        ASKING_TRUCK: lang==="es"?"que tipo de camion tienes":"what kind of truck you running",
        ASKING_YARDS: lang==="es"?"cuantas yardas tienes":"how many yards you got",
        ASKING_CITY: lang==="es"?"cual es la direccion":"whats the address",
        PHOTO_PENDING: lang==="es"?"manda foto de la tierra":"send me a pic of the dirt",
        APPROVAL_PENDING: lang==="es"?"dame un minuto":"give me a min still waiting on them",
        JOB_PRESENTED: lang==="es"?"te interesa":"you interested",
        ACTIVE: lang==="es"?"10.4 todo bien":"10.4 you good",
        OTW_PENDING: lang==="es"?"me avisas cuando llegues":"let me know when you get there",
        CLOSED: lang==="es"?"que onda":"whats up",
        PAYMENT_METHOD_PENDING: lang==="es"?"como quieres que te pague, zelle o venmo":"how you want it, zelle or venmo",
        NEGOTIATE: lang==="es"?"eso es lo mejor que tengo":"that is the best I got",
      }
      return { response: fb[conv?.state||"DISCOVERY"]||(lang==="es"?"dame un segundo":"give me a sec"), action:"NONE", updates:{}, confidence:0 }
    }
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
  // Idempotency: only insert payment if no existing payment for this load request
  if (lr?.id) {
    const { data: existingPay } = await sb.from("driver_payments").select("id").eq("load_request_id", lr.id).maybeSingle()
    if (!existingPay) {
      try { await sb.from("driver_payments").insert({
        driver_id: profile.user_id, load_request_id: lr.id, amount_cents: totalCents, status: "pending",
      }) } catch (e: any) { console.error("[payment]", e.message) }
    }
  }

  await logEvent("DELIVERY_VERIFIED", { phone, jobNum, loads, totalDollars }, job.id)
  await sendAdminAlert(`${jobNum} complete — ${profile.first_name} ${loads} load${loads>1?"s":""} $${totalDollars}`)

  if (job.client_phone) {
    const cp = job.client_phone.replace(/\D/g,"").replace(/^1/,"")
    const msg = lang==="es"
      ? `DumpSite: ${profile.first_name} entrego ${loads} carga${loads>1?"s":""}. Todo bien con la entrega? Necesitas mas cargas? Responde YES o NO`
      : `DumpSite: Did all go well with the delivery of ${loads} load${loads>1?"s":""}? Do you need anymore loads? Reply YES or NO`
    await sendSMS(cp, msg)

    // Trigger customer payment collection — if this order came from FillDirtNearMe SMS,
    // transition the customer conversation to AWAITING_PAYMENT so Sarah follows up
    try {
      const { data: custConv } = await sb.from("customer_conversations")
        .select("phone, state, total_price_cents")
        .eq("phone", cp)
        .in("state", ["ORDER_PLACED"])
        .maybeSingle()
      if (custConv) {
        await sb.rpc("upsert_customer_conversation", {
          p_phone: cp, p_state: "AWAITING_PAYMENT",
        })
        // Sarah sends payment collection message via the customer number
        const custFrom = process.env.CUSTOMER_TWILIO_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || ""
        if (custFrom) {
          const payMsg = `Hey your delivery just went through, ${loads} load${loads>1?"s":""}. For payment we accept Venmo, Zelle, or we can send an online invoice (3.5% card fee). Which works best for you`
          try {
            const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
            await client.messages.create({ body: payMsg, from: custFrom, to: `+1${cp}` })
            await sb.from("customer_sms_logs").insert({ phone: cp, body: payMsg, direction: "outbound", message_sid: `pay_trigger_${Date.now()}` })
          } catch (e: any) { console.error("[customer pay trigger]", e?.message) }
        }
      }
    } catch (e) { console.error("[customer pay transition]", e) }
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
      // Count how many times we already asked in recent history
      const payHistory = await getHistory(phone)
      const payAskCount = payHistory.filter(h =>
        h.role === "assistant" && (
          /whats your venmo|send me your venmo|need your venmo|mandame tu venmo|necesito tu venmo/i.test(h.content) ||
          /send the name and number|zelle account|necesito.*zelle|mandame.*zelle|info de zelle/i.test(h.content)
        )
      ).length
      if (method === "zelle") {
        const asks = lang === "es"
          ? ["mandame el nombre y numero de tu zelle", "necesito el nombre y numero de tu zelle para pagarte", "bro mandame tu info de zelle para que te pueda pagar", "no puedo mandarte nada sin tu info de zelle"]
          : ["send the name and number the zelle account it to", "I'm trying to get you paid, send me the name and number on your zelle", "need your zelle info before we can proceed bro", "cant pay you without your zelle info"]
        return asks[Math.min(payAskCount, asks.length - 1)]
      }
      const asks = lang === "es"
        ? ["mandame tu venmo", "necesito tu venmo para mandarte el pago", "bro mandame tu venmo para que te pueda pagar", "no puedo mandarte nada sin tu venmo"]
        : ["whats your venmo", "I'm trying to get you paid, send me your venmo", "need your venmo before I can send payment bro", "cant pay you without your venmo"]
      return asks[Math.min(payAskCount, asks.length - 1)]
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
  const _lockPhone = normalizePhone(sms.from)
  const _prior = _phoneLocks.get(_lockPhone)
  const _run = (async () => {
    if (_prior) { try { await _prior } catch {} }
    return await _handleConversationInner(sms)
  })()
  _phoneLocks.set(_lockPhone, _run)
  try {
    return await _run
  } finally {
    if (_phoneLocks.get(_lockPhone) === _run) _phoneLocks.delete(_lockPhone)
  }
}

async function _handleConversationInner(sms: IncomingSMS): Promise<string> {
  const phone = normalizePhone(sms.from)
  const body = (sms.body || "").trim()
  const mediaType = sms.mediaContentType || ""
  const isPhoto = (sms.numMedia || 0) > 0 && (!mediaType || mediaType.startsWith("image/"))
  const isNonPhotoMedia = (sms.numMedia || 0) > 0 && !isPhoto
  const hasPhoto = isPhoto
  const photoUrl = sms.mediaUrl
  const sid = sms.messageSid

  if (await isDuplicate(sid)) return ""

  // Multi-photo MMS — Twilio sends MediaUrl0..MediaUrlN, we only process MediaUrl0.
  // Tell driver to send one at a time so they don't think the rest were "received".
  if ((sms.numMedia || 0) > 1 && isPhoto) {
    const reply = "got it, send em one at a time so I dont miss anything"
    await logMsg(phone, body || "[multi-photo]", "inbound", sid)
    await logMsg(phone, reply, "outbound", `multiphoto_${sid}`)
    return reply
  }

  // Rapid-fire protection — wait 1.5s, then grab any additional messages and combine them
  const sb = createAdminSupabase()
  await logMsg(phone, body || (hasPhoto ? "[photo]" : isNonPhotoMedia ? "[voice/video]" : ""), "inbound", sid)

  // APPROVAL_PENDING watchdog — if we sent the customer an approval request more than
  // 6 hours ago and they never replied, the driver is stuck. Auto-reset and tell them.
  // Without this, a stale approval can lock a driver out of new jobs indefinitely.
  try {
    const { data: stuckCheck } = await sb.from("conversations")
      .select("state, approval_sent_at, pending_approval_order_id")
      .eq("phone", phone).maybeSingle()
    // Reservation expiry: if pending_approval_order_id set in JOB_PRESENTED/PHOTO_PENDING and idle 30+ min, reset
    const { data: reservCheck } = await sb.from("conversations")
      .select("state, pending_approval_order_id, updated_at")
      .eq("phone", phone).maybeSingle()
    if (reservCheck?.pending_approval_order_id &&
        ["JOB_PRESENTED", "PHOTO_PENDING"].includes(reservCheck.state) &&
        reservCheck.updated_at && (Date.now() - new Date(reservCheck.updated_at).getTime() > 30 * 60 * 1000)) {
      console.warn(`[reservation expired] resetting ${reservCheck.state} for ${phone}`)
      await resetConv(phone)
      const expiredMsg = "hey that last job timed out, you got more dirt today"
      try { await sendSMS(phone, expiredMsg); await logMsg(phone, expiredMsg, "outbound", `expire_${sid}`) } catch {}
    }
    if (stuckCheck?.state === "APPROVAL_PENDING" && stuckCheck.approval_sent_at) {
      const ageMs = Date.now() - new Date(stuckCheck.approval_sent_at).getTime()
      // Per fix #9: 2h reaper for APPROVAL_PENDING (was 6h)
      if (ageMs > 2 * 60 * 60 * 1000) {
        console.warn(`[watchdog] resetting stale APPROVAL_PENDING for ${phone}, age=${Math.round(ageMs/3600000)}h`)
        await sendAdminAlert(`⚠ STALE APPROVAL: ${phone} stuck in APPROVAL_PENDING for ${Math.round(ageMs/3600000)}h on order ${stuckCheck.pending_approval_order_id}. Auto-resetting.`)
        await resetConv(phone)
        // Continue processing the new message in fresh DISCOVERY state
      }
    }
  } catch (err) {
    console.error("[watchdog]", err)
  }

  if (!hasPhoto && body.length < 20) {
    // Short messages often come in bursts — wait briefly to combine
    await new Promise(r => setTimeout(r, 1500))
    const cutoff = new Date(Date.now() - 3000).toISOString()
    const { data: recentMsgs } = await sb.from("sms_logs").select("body, message_sid")
      .eq("phone", phone).eq("direction", "inbound").gte("created_at", cutoff)
      .order("created_at", { ascending: true })
    if (recentMsgs && recentMsgs.length > 1) {
      // Combine all recent burst messages into one
      const combined = recentMsgs.map(m => m.body).filter(Boolean).join(" ").trim()
      if (combined && combined !== body) {
        // Use combined text, but only process once (skip if this isn't the last message)
        const lastSid = recentMsgs[recentMsgs.length - 1].message_sid
        if (lastSid !== sid) return "" // Let the last message handle the combined text
        // This IS the last message — use combined body
        return await _handleConversationInner({ ...sms, body: combined, messageSid: sid + "_combined" })
      }
    }
  }

  const lower = body.toLowerCase().trim()

  // ── FIX #9: VOICE MEMO / VIDEO — not a photo, ask for photo instead ──
  if (isNonPhotoMedia && !hasPhoto) {
    return "I need a picture not a video, send me a pic of the dirt"
  }

  // ── FIX #8: BUSINESS HOURS — delay overnight texts ──
  const hour = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour12: false, hour: "numeric" }).replace(/\D/g, "")
  const hourNum = parseInt(hour)
  const isAfterHours = hourNum >= 22 || hourNum < 6 // 10pm-6am CT

  // ── COMPLIANCE ───────────────────────────────────────────────
  if (lower === "stop" || lower === "unsubscribe") {
    await createAdminSupabase().from("driver_profiles").update({ sms_opted_out: true }).eq("phone", phone)
    return ""
  }
  if (lower === "start") {
    await createAdminSupabase().from("driver_profiles").update({ sms_opted_out: false }).eq("phone", phone)
    return "Yea you back on"
  }

  // ── UNIVERSAL RESET — only on clear intent ───────────
  if (/^(reset|start over|restart|menu)$/i.test(lower)) {
    await resetConv(phone)
    await logMsg(phone, "Conversation reset", "outbound", `reset_${sid}`)
    return "10.4 starting fresh. You got dirt today"
  }

  const [profile, conv, history] = await Promise.all([getProfile(phone), getConv(phone), getHistory(phone)])
  if (profile?.sms_opted_out) return ""

  // Sticky language: prefer driver_profiles.preferred_language; only run detector if null.
  // Once detected, persist back to driver_profiles for future messages.
  let lang: "en"|"es"
  if (profile?.preferred_language === "es" || profile?.preferred_language === "en") {
    lang = profile.preferred_language
  } else {
    const detectedLang = detectLanguage(body)
    const historyHasSpanish = history.some(m => detectLanguage(m.content) === "es")
    lang = detectedLang === "es" || historyHasSpanish ? "es" : "en"
    if (profile?.user_id) {
      try { await createAdminSupabase().from("driver_profiles").update({ preferred_language: lang }).eq("phone", phone) } catch {}
    }
  }
  const isKnownDriver = profile ? (await getCompletedCount(profile.user_id)) >= 2 : false
  const convState = conv?.state || "DISCOVERY"

  // ── ONBOARDING ───────────────────────────────────────────────
  if (!profile) {
    if (convState !== "GETTING_NAME") {
      // FIX A: Extract intent from first message and persist it so we don't drop
      // load info on the floor while collecting the name. Driver may have led with
      // "I have 500 yds tomorrow" — that has to survive onboarding.
      let extractedYards: number | null = null
      let extractedCity: string | null = null
      let extractedTruckType: string | null = null
      try {
        const yMatch = body.match(/(\d{2,4})\s*(yd|yds|yard|yards|cy)\b/i)
        if (yMatch) extractedYards = parseInt(yMatch[1])
        const cityMatch = DFW_CITIES.find(c => new RegExp(`\\b${c}\\b`, "i").test(body))
        if (cityMatch) extractedCity = cityMatch
        if (/\b(dump\s*truck|tri\s*axle|tandem|10\s*wheel|18\s*wheel|belly\s*dump|end\s*dump)\b/i.test(body)) {
          extractedTruckType = body.match(/\b(dump\s*truck|tri\s*axle|tandem|10\s*wheel|18\s*wheel|belly\s*dump|end\s*dump)\b/i)?.[0] || null
        }
      } catch {}
      await saveConv(phone, {
        state: "GETTING_NAME",
        extracted_yards: extractedYards,
        extracted_city: extractedCity,
        extracted_truck_type: extractedTruckType,
      })
      // Acknowledge what they told us so they know we heard them
      const ackParts: string[] = []
      if (extractedYards) ackParts.push(`${extractedYards} yds`)
      if (extractedCity) ackParts.push(`in ${extractedCity}`)
      const ack = ackParts.length ? `10.4 ${ackParts.join(" ")} — ` : ""
      return lang==="es"
        ? (ack ? `${ack}como te llamas` : "Hola, como te llamas")
        : (ack ? `${ack}whats your name` : "Hey whats your name")
    }
    // FIX B (lite): reject obvious non-names so we don't create driver named "Hello"
    const cleaned = body.trim().replace(/[^a-zA-Z\s'-]/g, "").trim()
    const NON_NAMES = /^(hello|hi|hey|yo|sup|yes|yea|yeah|nope|no|ok|okay|10-?4|copy|bet|cool|thanks|thx|wtf|huh|what|who|dirt|load|loads|yards?|tomorrow|today)$/i
    if (!cleaned || cleaned.length < 2 || NON_NAMES.test(cleaned) || /^\d/.test(body.trim())) {
      return lang==="es" ? "perdon, como te llamas" : "my bad — whats your name"
    }
    const parts = cleaned.split(/\s+/)
    const first = parts[0]
    const last = parts.slice(1).join(" ") || ""
    await createAdminSupabase().rpc("create_sms_driver", { p_phone: phone, p_first_name: first, p_last_name: last })
    await saveConv(phone, { state: "DISCOVERY" })
    await logEvent("CONTACT_CREATED", { phone, firstName: first })
    // If we already extracted load info during the previous turn, acknowledge and move forward
    const yds = conv?.extracted_yards
    const city = conv?.extracted_city
    if (yds || city) {
      const detail = [yds ? `${yds} yds` : null, city ? `in ${city}` : null].filter(Boolean).join(" ")
      if (isAfterHours) {
        return lang==="es" ? `${first} te tengo con ${detail}. Estamos cerrados ahorita, te busco algo en la manana` : `${first} got you with ${detail}. I'm off for the night, I'll line something up in the morning`
      }
      return lang==="es" ? `${first} te tengo con ${detail}. dejame ver que tengo cerca` : `${first} got you with ${detail}. lemme see what I got close by`
    }
    if (isAfterHours) {
      return lang==="es" ? `${first} te tengo. Estamos cerrados ahorita, mandame texto en la manana` : `${first} got you. I'm off for the night, text me in the morning and I'll get you set up`
    }
    return lang==="es" ? `${first} te tengo. Tienes tierra hoy` : `${first} got you. You got dirt today`
  }

  const firstName = profile.first_name || "Driver"

  // ── AFTER HOURS — don't start new flows or send customer approvals at night ──
  // Allow active jobs and payment flows to continue (driver may be finishing late)
  const afterHoursNewFlow = isAfterHours && (convState === "DISCOVERY" || convState === "CLOSED" || convState === "GETTING_NAME")
  if (afterHoursNewFlow) {
    return pick(lang==="es"
      ? [`que onda ${firstName}, estamos cerrados ahorita. Mandame texto en la manana y te busco algo`,`hola ${firstName}, ya cerramos. Mandame texto manana temprano`]
      : [`hey ${firstName} I'm off for the night, text me in the morning and I'll get you set up`,`hey ${firstName} we're done for today, hit me up tomorrow morning`])
  }

  // ── FIX #3: CANCEL MID-FLOW — driver wants to back out ──
  if (/^(nevermind|nvm|cancel|changed my mind|wrong person|forget it|nah forget it|ya no|olvidalo|cancelar)$/i.test(lower) && convState !== "DISCOVERY" && convState !== "CLOSED") {
    await resetConv(phone)
    return pick(lang==="es" ? ["10.4 sin problema, avisame cuando quieras"] : ["10.4 no worries, hit me up when you ready","all good, text me when you got another load"])
  }

  // ── FIX #4: LOAD COUNT CORRECTION — "wait I meant 7" ──
  if (/^(wait|hold on|actually|my bad|i meant|correction|no wait)/i.test(lower) && (convState === "PAYMENT_METHOD_PENDING" || convState === "AWAITING_CUSTOMER_CONFIRM")) {
    const correctedLoads = body.match(/(\d+)/)?.[1]
    if (correctedLoads) {
      const newCount = Math.min(parseInt(correctedLoads), 50)
      const activeOrderId = conv?.active_order_id
      if (activeOrderId && profile?.user_id) {
        const sb = createAdminSupabase()
        // Find the load request and update payout
        const { data: lr } = await sb.from("load_requests").select("id, dispatch_orders(driver_pay_cents)")
          .eq("dispatch_order_id", activeOrderId).eq("driver_id", profile.user_id)
          .order("created_at", { ascending: false }).maybeSingle()
        if (lr) {
          const payPerLoad = (lr.dispatch_orders as any)?.driver_pay_cents || 4500
          const newTotalCents = payPerLoad * newCount
          await sb.from("load_requests").update({ payout_cents: newTotalCents, truck_count: newCount }).eq("id", lr.id)
          // Update driver_payments too
          await sb.from("driver_payments").update({ amount_cents: newTotalCents }).eq("load_request_id", lr.id).eq("status", "pending")
          const newDollars = Math.round(newTotalCents / 100)
          await sendAdminAlert(`CORRECTION: ${firstName} changed count to ${newCount} loads — $${newDollars}`)
        }
      }
      return pick(lang==="es" ? [`10.4 corregido a ${correctedLoads} cargas`] : [`got it, corrected to ${correctedLoads} loads`])
    }
    return pick(lang==="es" ? ["que fue, cuantas cargas en total"] : ["whats the correct count","how many loads total then"])
  }

  // ── FIX #12: "HOW MUCH YOU PAYING" — before any qualification ──
  if (/\b(how much|what.*(pay|rate|price)|cuanto pagan|cuanto.*paga|whats the rate|what do you pay|what.*per load)\b/i.test(lower) && convState === "DISCOVERY") {
    return pick(lang==="es"
      ? ["depende del sitio, andan entre $30-65 por carga. tienes tierra hoy"]
      : ["depends on the site, ranges from $30-65 a load. you got dirt today","rates run $30-65 per load depending on location. you sitting on some dirt"])
  }

  // ── FIX #13: PRE-FILL FROM WEB PROFILE — skip questions we already know ──
  if (convState === "DISCOVERY" && profile.truck_type && !conv?.extracted_truck_type) {
    // Driver signed up on web with truck info — save it to conversation
    const updates: Record<string,any> = {}
    if (profile.truck_type) updates.extracted_truck_type = profile.truck_type
    if (profile.truck_count) updates.extracted_truck_count = profile.truck_count
    if (Object.keys(updates).length > 0) {
      await saveConv(phone, { ...conv, ...updates })
    }
  }

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
          // Release order back to dispatching so other drivers can claim it
          await createAdminSupabase().from("dispatch_orders").update({ status: "dispatching" }).eq("id", result.orderId)
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
    // Check if this phone has an active DRIVER conversation — if so, treat as driver, not customer
    const driverConv = conv
    const hasActiveDriverFlow = driverConv && ["ACTIVE","OTW_PENDING","PHOTO_PENDING","APPROVAL_PENDING","JOB_PRESENTED","ASKING_TRUCK","ASKING_TRUCK_COUNT","ASKING_ADDRESS","PAYMENT_METHOD_PENDING","PAYMENT_ACCOUNT_PENDING","AWAITING_PAYMENT_COLLECTION"].includes(driverConv.state)

    const sb = createAdminSupabase()
    const { data: clientOrder } = await sb.from("dispatch_orders").select("id, client_phone")
      .in("status", ["dispatching","active","pending"])
    const isCustomer = clientOrder?.some(o => {
      const norm = (o.client_phone||"").replace(/\D/g,"").replace(/^1/,"")
      return norm === phone
    })
    // Only treat as customer if they don't have an active driver conversation
    if (isCustomer && phone !== ADMIN_PHONE && !hasActiveDriverFlow) {
      if (isYes) {
        const result = await processCustomerApproval(phone, true)
        if (result) {
          const dc = await getConv(result.driverPhone)
          const dp = await getProfile(result.driverPhone)
          // NOW reserve the order — customer approved
          let reservationOk = false
          try {
            const rid = await atomicClaimJob(result.orderId, result.driverPhone, dp?.user_id || null)
            if (rid && dc) {
              await saveConv(result.driverPhone, { ...dc, reservation_id: rid, active_order_id: result.orderId })
              reservationOk = true
            }
          } catch (e) { console.error("[reservation on approval]", e) }
          if (!reservationOk) {
            // Reservation failed — order was taken by another driver
            const dl: "en"|"es" = dp?.preferred_language === "es" ? "es" : "en"
            await sendSMS(result.driverPhone, dl==="es" ? "ese sitio se lo llevo otro driver, dejame buscarte otro" : "that site just got taken by another driver, let me find you another one")
            await resetConv(result.driverPhone)
            await sendAdminAlert(`RESERVATION FAILED on customer approval — order ${result.orderId} already claimed. Driver ${result.driverPhone} notified.`)
            return "Perfect — we'll get them set up"
          }
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
          // Release the order back to dispatching so other drivers can claim it
          await createAdminSupabase().from("dispatch_orders").update({ status: "dispatching" }).eq("id", result.orderId)
          await resetConv(result.driverPhone)
        }
        return "Got it — driver notified"
      }
    }
  }

  // ── PAYMENT STATES ───────────────────────────────────────────
  if (["PAYMENT_METHOD_PENDING","PAYMENT_ACCOUNT_PENDING","AWAITING_PAYMENT_COLLECTION"].includes(convState)) {
    const payReply = await handlePayment(phone, body, conv, lang)
    await logMsg(phone, payReply, "outbound", `pay_${sid}`)
    return payReply
  }

  // ── OTW / ADDRESS RESEND ─────────────────────────────────────
  const activeJob = await getActiveJob(conv)

  // AUTO-RECOVERY: if conv says ACTIVE but order is gone/completed, reset to DISCOVERY
  if (!activeJob && ["ACTIVE","OTW_PENDING"].includes(convState)) {
    await resetConv(phone)
    // Re-run with clean state so driver isn't stuck
    return pick(lang==="es"
      ? [`ese trabajo ya se cerro ${firstName}, tienes mas tierra`,`ya se completo ese trabajo, mandame texto si tienes otro`]
      : [`that job got closed out ${firstName}, you got more dirt`,`that one's done, text me if you got another load`])
  }

  if (isOTW(body) && ["ACTIVE","OTW_PENDING"].includes(convState)) {
    await saveConv(phone, { ...conv, state: "OTW_PENDING" })
    return lang==="es" ? "10.4 avisame cuando llegues" : "10.4 let me know when you pull up"
  }
  if (isAddressResend(body) && activeJob?.client_address) {
    return activeJob.client_address
  }

  // ── ACTIVE JOB: address, cancel, completion ──────────────────
  if (activeJob && ["ACTIVE","OTW_PENDING"].includes(convState)) {
    if (/\b(addy|address|directions)\b/i.test(lower) || /\bwhere.*(dump|go|site|head|drive|deliver)\b/i.test(lower) || /\bwhere('s| is| was) (it|the site|the place|the spot|the location)\b/i.test(lower)) {
      return `${activeJob.client_address} — ${(activeJob.cities as any)?.name || ""}`
    }
    if (/^cancel$/i.test(lower)) {
      await resetConv(phone)
      await sendAdminAlert(`${generateJobNumber(activeJob.id)} cancelled — ${firstName}`)
      return `${generateJobNumber(activeJob.id)} cancelled. Text when you got another load`
    }
    const loads = parseLoads(body)
    if (loads === -1) return lang==="es" ? "cuantas cargas tiraste" : "how many loads total"
    if (loads === LOAD_COUNT_OVERFLOW) {
      return lang === "es"
        ? "whoa son muchas cargas, mandame 50 primero y luego seguimos con el resto"
        : "whoa thats a lot of loads, lemme split that up — send me 50 first then we'll do the rest"
    }
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
    /\d{2,}\s+[nsew]\.?\s+\w+/i.test(body) ||
    // Texas Farm-to-Market / state highway: "900 FM 1709", "1500 SH 121", "2200 US 75"
    /\d{2,}\s+(fm|sh|us|hwy|highway)\s+\d+/i.test(body)
  // GPS coord pair (e.g. "32.7767,-96.797") — bypasses geocoder downstream
  const gpsMatch = body.match(/(-?\d{1,3}\.\d{3,})[,\s]+(-?\d{1,3}\.\d{3,})/)
  // Google Maps share link — resolved by routing.service.geocode()
  const mapsLink = /https?:\/\/(?:www\.)?(?:maps\.google\.[a-z.]+|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|g\.co\/maps)\/?\S*/i.test(body)
  // Cross-street intersection (e.g. "5th and Main", "Oak & Elm") — geocoder handles intersections
  const crossStreetMatch = !looksLikeAddress && !gpsMatch && body.length < 80 &&
    /\b[a-z0-9]+(?:\s+(?:st|street|ave|avenue|blvd|rd|road|ln|lane|dr|drive))?\s+(?:and|&)\s+[a-z0-9]+(?:\s+(?:st|street|ave|avenue|blvd|rd|road|ln|lane|dr|drive))?\b/i.test(lower) &&
    // Avoid matching natural language like "yes and no" or "trash and debris"
    !/\b(yes|no|ok|okay|maybe|trash|debris|concrete|asphalt|sand|clay|gravel|done|good|bad)\b/i.test(lower)
  const isLocationPin = !!(gpsMatch || mapsLink)
  // Build a routing-ready string. For cross streets, append the saved or detected city for accuracy.
  let driverLoadingAddress: string | null = null
  if (looksLikeAddress) driverLoadingAddress = body.trim()
  else if (gpsMatch) driverLoadingAddress = `${gpsMatch[1]},${gpsMatch[2]}`
  else if (isLocationPin) driverLoadingAddress = body.trim()
  else if (crossStreetMatch) {
    // Cross-street: pad with city + state so Google geocodes the intersection
    const cityHint = (conv?.extracted_city || "Dallas") + ", TX"
    driverLoadingAddress = `${body.trim()}, ${cityHint}`
  }

  // ── INLINE CITY EXTRACTION — detect city mentioned in current message ──
  // Also resolve common typos to canonical city names
  // SKIP during name collection or when message looks like a personal name (short, no numbers)
  const CITY_TYPOS: Record<string,string> = {
    "ft worth":"Fort Worth", "ft. worth":"Fort Worth", "fortworth":"Fort Worth", "fourt worth":"Fort Worth",
    "dalls":"Dallas", "dallass":"Dallas", "dal":"Dallas",
    "arlinton":"Arlington", "waxa":"Waxahachie", "waxahatchie":"Waxahachie", "waxahachee":"Waxahachie",
    "mckinny":"McKinney", "mkinney":"McKinney", "lewisvile":"Lewisville", "lewsiville":"Lewisville",
    "dennison":"Denison", "denisson":"Denison", "midlothain":"Midlothian", "midlothien":"Midlothian",
    "collyville":"Colleyville", "grapvine":"Grapevine", "gravevine":"Grapevine",
  }
  // Cities that are also common first names — only extract if message has clear location context
  const AMBIGUOUS_CITY_NAMES = new Set(["Anna","Heath","Justin","Boyd","Venus","Elizabeth","Allen","Celina","Fate","Blum"])
  const isNameLike = body.trim().split(/\s+/).length <= 3 && !/\d/.test(body) && body.trim().length < 25
  const skipCityExtraction = convState === "GETTING_NAME" || (convState === "DISCOVERY" && !conv?.extracted_yards && !conv?.extracted_truck_type && isNameLike)
  let inlineCity: string | null = null
  if (!skipCityExtraction) {
    // First check exact city names with word boundaries
    for (const c of DFW_CITIES) {
      // Skip ambiguous names unless the message has location context words
      if (AMBIGUOUS_CITY_NAMES.has(c) && isNameLike && !/\b(near|in|from|at|around|heading|going|coming|loading|hauling)\b/i.test(lower)) continue
      const pattern = new RegExp("\\b" + c.replace(/\s+/g, "\\s+") + "\\b", "i")
      if (pattern.test(lower)) { inlineCity = c; break }
    }
    // If no match, check typos
    if (!inlineCity) {
      for (const [typo, canonical] of Object.entries(CITY_TYPOS)) {
        if (lower.includes(typo)) { inlineCity = canonical; break }
      }
    }
  }

  // extracted_material stores driver loading address for routing (address > material type for this field)
  // Only overwrite with a new address if one was detected; otherwise keep existing value
  const enriched = {
    ...conv,
    // Allow truck type correction: if driver explicitly says a truck type, override saved value
    extracted_truck_type: inlineTruck || conv.extracted_truck_type || null,
    extracted_yards: inlineYards || conv.extracted_yards || null,
    photo_public_url: storedPhotoUrl || null,
    // Store loading address for routing — only overwrite if new address detected
    extracted_material: driverLoadingAddress || conv.extracted_material || null,
    // Prefer NEW city from current message over saved city — driver may be changing location
    extracted_city: inlineCity || conv.extracted_city || null,
  }
  if (inlineTruck || inlineYards || storedPhotoUrl || driverLoadingAddress || inlineCity) await saveConv(phone, enriched)

  // CITY CHANGE — driver said a city that differs from the saved one. The COALESCE-based
  // upsert_conversation RPC can't clear/replace fields with NULL, so a stale loading address
  // from the OLD city would still drive routing. Force a direct UPDATE to clear stale state.
  if (inlineCity && conv?.extracted_city && inlineCity !== conv.extracted_city &&
      !["ACTIVE","OTW_PENDING","APPROVAL_PENDING","PHOTO_PENDING"].includes(convState)) {
    console.log(`[brain] city change ${conv.extracted_city} → ${inlineCity}, clearing stale routing state`)
    try {
      await createAdminSupabase().from("conversations").update({
        extracted_city: inlineCity,
        extracted_material: driverLoadingAddress || null, // null clears stale address
        state: driverLoadingAddress ? convState : "ASKING_ADDRESS",
        pending_approval_order_id: null,
        updated_at: new Date().toISOString(),
      }).eq("phone", phone)
      enriched.extracted_city = inlineCity
      enriched.extracted_material = driverLoadingAddress || null
    } catch (err) {
      console.error("[city change update]", err)
    }
  }

  // ── NEARBY JOBS ──
  // CRITICAL: only route on REAL location data (street address / GPS / cross street), never on a
  // city alone — city-centroid matches give bad "closest site" answers and the driver thinks
  // we're guessing. If we only have a city, skip routing and ask for the loading address.
  let nearbyJobs: JobMatch[] = []
  const realLocation = driverLoadingAddress || (conv?.extracted_material && /\d/.test(conv.extracted_material) ? conv.extracted_material : null)
  let routingFailed = false
  if (realLocation) {
    try {
      nearbyJobs = await findNearbyJobs(realLocation, enriched.extracted_truck_type || undefined)
      if (!nearbyJobs.length) {
        routingFailed = true
        await sendAdminAlert(`⚠ NO NEARBY JOBS for driver ${phone}: tried "${realLocation.slice(0,80)}"`)
      }
    } catch (e: any) {
      routingFailed = true
      console.error("[brain] findNearbyJobs threw:", e?.message)
      await sendAdminAlert(`⚠ ROUTING ERROR for ${phone}: ${e?.message?.slice(0,120) || "unknown"} — input "${realLocation.slice(0,60)}"`)
    }
  }
  // City-only state: we know roughly where they are but not where they're loading from.
  // Force the conversation into ASKING_ADDRESS so Sonnet/templates demand the exact address
  // rather than presenting a centroid-based "closest" job.
  const cityOnlyNoAddress = !realLocation && !!(inlineCity || enriched.extracted_city)
  if (cityOnlyNoAddress && convState !== "ASKING_ADDRESS" && !["ACTIVE","OTW_PENDING","JOB_PRESENTED","APPROVAL_PENDING","PHOTO_PENDING"].includes(convState)) {
    await saveConv(phone, { ...enriched, state: "ASKING_ADDRESS" })
    const reply = pick([
      `cool ${(inlineCity || enriched.extracted_city)} — whats the address you loading from so I can find whats closest`,
      `bet, send me the loading address and I'll pull up the closest sites`,
      `whats the street address you loading from`,
    ])
    await logMsg(phone, reply, "outbound", `cityonly_${sid}`)
    return reply
  }
  // Zero-jobs template: city was extracted but no nearby jobs available — Jesse voice, no AI call
  if (!nearbyJobs.length && (inlineCity || enriched.extracted_city) && realLocation && !activeJob) {
    const cityName = inlineCity || enriched.extracted_city
    const truckQ = !enriched.extracted_truck_type
      ? (lang === "es" ? " — que tipo de camion tienes" : " — what truck you running")
      : ""
    const reply = lang === "es"
      ? `nada en ${cityName} ahorita, te aviso apenas salga algo${truckQ}`
      : `nothing in ${cityName} right now, I'll text you the second something opens up${truckQ}`
    // Stay in DISCOVERY (or ASKING_TRUCK if we still need truck)
    await saveConv(phone, { ...enriched, state: enriched.extracted_truck_type ? "DISCOVERY" : "ASKING_TRUCK" })
    await logMsg(phone, reply, "outbound", `zerojobs_${sid}`)
    return reply
  }
  if (routingFailed && realLocation) {
    const reply = pick([
      "cant find anything near that address, you sure thats right",
      "hmm not pulling anything up, can you double check the address",
    ])
    await logMsg(phone, reply, "outbound", `routefail_${sid}`)
    return reply
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
    
    // Handle START — re-opt-in must wipe stale state. Otherwise a driver who STOPped
    // mid-ACTIVE job weeks ago would resume into a dead order.
    if (tpl.action === "START") {
      const sb = createAdminSupabase()
      try { await sb.from("driver_profiles").update({ sms_opted_out: false }).eq("phone", phone) } catch {}
      await resetConv(phone)
      await logMsg(phone, tpl.response, "outbound", `tpl_${sid}`)
      return tpl.response
    }
    
    // Handle address resend
    if (tpl.action === "RESEND_ADDRESS") {
      if (activeJob?.client_address) {
        await saveConv(phone, toSaveTpl)
        await logMsg(phone, activeJob.client_address, "outbound", `tpl_${sid}`)
        return activeJob.client_address
      }
      // No active job or no address — don't leak internal marker
      tpl.response = lang === "es" ? "no tengo una direccion activa, mandame tu ciudad" : "dont have an active address for you, text me your city"
    }
    
    // Handle delivery completion
    if (tpl.action === "COMPLETE_JOB" && tpl.response.startsWith("__DELIVERY__:")) {
      const loads = parseInt(tpl.response.split(":")[1]) || 1
      if (activeJob) {
        const reply = await handleDelivery(phone, conv, profile, activeJob, loads, lang)
        await logMsg(phone, reply, "outbound", `del_${sid}`)
        return reply
      }
      // No active job found — don't leak internal marker
      tpl.response = lang === "es" ? "no encuentro un trabajo activo, mandame el numero de trabajo" : "cant find an active job for you, whats the job number"
    }
    
    // Handle payment collection
    if (tpl.action === "COLLECT_PAYMENT") {
      const method = enriched.job_state || conv?.job_state || "zelle"
      await savePaymentInfo(phone, method, body.trim())
      await sendSMS(ADMIN_PHONE, `PAYMENT: ${phone} — ${method} — ${body.trim()}${enriched.pending_pay_dollars ? " — $"+enriched.pending_pay_dollars : ""}`)
    }

    // Handle payment re-ask with escalating human-like messages
    if (tpl.response.startsWith("__PAY_REASK__:")) {
      const payMethod = tpl.response.split(":")[1]
      // Count how many times we already asked in recent history
      const payAskCount = history.filter(h =>
        h.role === "assistant" && (
          /whats your venmo|send me your venmo|need your venmo|mandame tu venmo|necesito tu venmo/i.test(h.content) ||
          /send the name and number|zelle account|necesito.*zelle|mandame.*zelle|info de zelle/i.test(h.content)
        )
      ).length
      if (payMethod === "venmo") {
        const asks = lang === "es"
          ? ["mandame tu venmo", "necesito tu venmo para mandarte el pago", "bro mandame tu venmo para que te pueda pagar", "no puedo mandarte nada sin tu venmo"]
          : ["whats your venmo", "I'm trying to get you paid, send me your venmo", "need your venmo before I can send payment bro", "cant pay you without your venmo"]
        tpl.response = asks[Math.min(payAskCount, asks.length - 1)]
      } else {
        const asks = lang === "es"
          ? ["mandame el nombre y numero de tu zelle", "necesito el nombre y numero de tu zelle para pagarte", "bro mandame tu info de zelle para que te pueda pagar", "no puedo mandarte nada sin tu info de zelle"]
          : ["send the name and number the zelle account it to", "I'm trying to get you paid, send me the name and number on your zelle", "need your zelle info before we can proceed bro", "cant pay you without your zelle info"]
        tpl.response = asks[Math.min(payAskCount, asks.length - 1)]
      }
    }

    // Job presentation — do NOT reserve yet. Reservation happens only after
    // customer approves the dirt photo. This keeps the order available to
    // other drivers until a real commitment is made.
    
    await saveConv(phone, toSaveTpl)
    const lastOutbound = history.filter(h => h.role === "assistant").slice(-1)[0]?.content || ""
    let validatedTpl = validateResponse(tpl.response, null, toSaveTpl.state || convState, lang)
    // Safety: strip any internal markers that leaked through
    validatedTpl = validatedTpl.replace(/__\w+__[:\w]*/g, "").trim() || "10.4"
    // Only deduplicate non-job-presentation messages — job presentations contain "$" and "miles/millas"
    const isJobPresentation = /\$\d+.*load|\$\d+.*carga/i.test(validatedTpl)
    if (!isJobPresentation && validatedTpl.toLowerCase().trim() === lastOutbound.toLowerCase().trim() && validatedTpl.length > 5) {
      validatedTpl = "10.4"
    }
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
    const dangerousStates = ["PAYMENT_METHOD_PENDING", "PAYMENT_ACCOUNT_PENDING", "ACTIVE", "OTW_PENDING", "AWAITING_CUSTOMER_CONFIRM", "CLOSED"]
    // Job-flow states that require a real order — Sonnet hallucinations have set these
    // without any actual order, locking drivers into a fake job they can't escape.
    const jobStates = ["JOB_PRESENTED", "PHOTO_PENDING", "APPROVAL_PENDING"]
    const hasOrder = !!(toSave.pending_approval_order_id || toSave.active_order_id || conv?.pending_approval_order_id || conv?.active_order_id)
    if (dangerousStates.includes(newState) && !toSave.active_order_id && !conv?.active_order_id) {
      console.warn(`[Brain] blocked state transition to ${newState} — no active job`)
    } else if (jobStates.includes(newState) && !hasOrder) {
      console.warn(`[Brain] blocked state transition to ${newState} — no order id, brain hallucinated`)
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
  // BLOCK during after hours — don't MMS/call customers at night
  const dirtRejected = /no go|can.?t accept|rejected|trash|debris|concrete|clay/i.test(brain.response)
  const photoApprovalNeeded = brain.action === "SEND_FOR_APPROVAL"
    || (hasPhoto && toSave.state === "APPROVAL_PENDING")
    || (hasPhoto && convState === "PHOTO_PENDING" && !dirtRejected)
  if (photoApprovalNeeded) {
    const orderId = toSave.pending_approval_order_id || conv.pending_approval_order_id
    console.log(`[Brain] Photo approval: orderId=${orderId} action=${brain.action} convState=${convState} dirtRejected=${dirtRejected}`)
    if (orderId) {
      // FIX #6: Verify order still exists and is valid
      const { data: orderCheck } = await createAdminSupabase().from("dispatch_orders")
        .select("status").eq("id", orderId).maybeSingle()
      if (!orderCheck || !["dispatching","active","pending"].includes(orderCheck.status)) {
        console.warn(`[Brain] Order ${orderId} is ${orderCheck?.status || "GONE"} — clearing`)
        toSave.pending_approval_order_id = null
        toSave.state = "DISCOVERY"
        brain.response = pick(lang==="es" ? ["ese sitio ya no esta disponible, dejame buscarte otro"] : ["that site just got taken, let me find you another one"])
      } else {
      // FIX #5: Soft lock — create short reservation so other drivers see a different job
      try { await atomicClaimJob(orderId, phone, profile?.user_id || null) } catch {}
      let photoStorageFailed = false
      if (photoUrl) {
        try {
          const stored = await downloadAndStorePhoto(photoUrl, phone, orderId)
          if (stored) toSave.photo_public_url = stored.publicUrl
          else photoStorageFailed = true
        } catch (e) {
          console.error("[photo store]", e)
          photoStorageFailed = true
        }
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

        // CRITICAL: never send a customer approval request without a photo. The customer
        // approves dirt quality based on the image — a blank approval defeats the safety check.
        // Escalate to admin for manual review and tell the driver to resend.
        if (!photoToSend || photoStorageFailed) {
          await sendAdminAlert(`⚠ PHOTO STORAGE FAILED: driver ${driverName} (${phone}) order ${generateJobNumber(orderId)} — photo could not be saved. Customer approval NOT sent. Manual review needed.`)
          toSave.state = "PHOTO_PENDING"
          toSave.pending_approval_order_id = orderId
          brain.response = lang === "es"
            ? "no me llego la foto bien, mandala otra vez porfa"
            : "the photo didnt come thru, can you resend it"
          // Skip the rest of approval-send logic for this turn
          await saveConv(phone, toSave)
          await logMsg(phone, brain.response, "outbound", `photofail_${sid}`)
          return brain.response
        }

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
        // After hours: MMS is fine at night but DON'T trigger voice call — customer is sleeping
        toSave.voice_call_made = isAfterHours ? true : false
        if (isAfterHours) {
          brain.response = lang === "es"
            ? "se ve bien, lo mande para aprobacion pero puede tardar un poco ya que es tarde. Te aviso en la manana"
            : "looks good, sent it for approval but might take a bit since its late. I'll let you know in the morning"
        }
      } else {
        // No client phone on the order — alert admin
        await sendAdminAlert(`⚠ NO CLIENT PHONE: Order ${orderId} has no customer phone. Driver ${phone} sent photo but cannot send approval. Fix order in admin.`)
        toSave.state = "APPROVAL_PENDING"
      }
      } // close order-valid else block
    } else {
      console.error(`[Brain] PHOTO APPROVAL BLOCKED — no orderId. conv.pending_approval_order_id=${conv.pending_approval_order_id} toSave.pending_approval_order_id=${toSave.pending_approval_order_id}`)
      // Still set state so driver doesn't get stuck
      toSave.state = "APPROVAL_PENDING"
    }
  }

  // CLAIM_JOB from Sonnet — do NOT reserve. Just track the order ID.
  // Reservation only happens when customer approves.
  if (brain.action === "CLAIM_JOB" && brain.claimJobId) {
    toSave.pending_approval_order_id = brain.claimJobId
    toSave.state = "PHOTO_PENDING"
  }

  if (brain.action === "CANCEL_JOB" && conv?.reservation_id) {
    const { releaseReservation } = await import("./routing.service")
    await releaseReservation(conv.reservation_id).catch(() => {})
    await resetConv(phone)
    return brain.response
  }

  if (brain.action === "COMPLETE_JOB" && activeJob) {
    const pl = parseLoads(body)
    if (pl === LOAD_COUNT_OVERFLOW) {
      return lang === "es"
        ? "whoa son muchas cargas, mandame 50 primero y luego seguimos con el resto"
        : "whoa thats a lot of loads, lemme split that up — send me 50 first then we'll do the rest"
    }
    return await handleDelivery(phone, conv, profile, activeJob, pl && pl > 0 ? pl : 1, lang)
  }

  // Photo approval handled above in SEND_FOR_APPROVAL block

  await saveConv(phone, toSave)
  const driverAddr = body.match(/\d+\s+\w+.*(?:st|ave|blvd|dr|rd|ln|ct|way|pkwy|hwy)/i)?.[0] || null
  const validated = validateBeforeSend(brain.response, driverAddr, toSave?.state || convState, lang)
  await logMsg(phone, validated, "outbound", `brain_${sid}`)
  return validated
}

export const smsDispatchService = { handleIncoming: handleConversation, generateJobNumber }
