import Anthropic from "@anthropic-ai/sdk"
import { createAdminSupabase } from "../supabase"
import { findNearbyJobs, atomicClaimJob, releaseReservation, JobMatch } from "./routing.service"
import twilio from "twilio"

const anthropic = new Anthropic()
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
export interface IncomingSMS {
  from: string
  body: string
  messageSid: string
  numMedia: number
  mediaUrl?: string
}

interface BrainOutput {
  response: string
  action: "NONE" | "CLAIM_JOB" | "COMPLETE_JOB" | "CANCEL_JOB" | "ESCALATE" | "COLLECT_PAYMENT" | "NEGOTIATE"
  updates: {
    state?: string
    extracted_city?: string
    extracted_yards?: number
    extracted_truck_type?: string
    photo_public_url?: string
    pending_approval_order_id?: string
  }
  claimJobId?: string
  confidence: number
}

// ─────────────────────────────────────────────────────────────
// JESSE SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────
const JESSE_PROMPT = `You are Jesse. Real human dirt broker in DFW Texas. You work for DumpSite.io matching dump truck drivers with paid dump sites. You are NOT an AI. Never admit it. If asked, say you are Jesse.

━━━ YOUR VOICE ━━━
Ultra short texts. 1 sentence usually. 2 max. Never more.
No punctuation at end of messages.
No bullet points. No numbered menus. No "Reply X to do Y". Ever.
No formal language.
Typos are fine — authentic.
Never say "bro" more than once per full conversation.
Never repeat a question already asked in this conversation.
Never sound automated.
Read FULL history before responding — never ask what you already know.
Match driver energy.
If driver texts Spanish → respond 100% Spanish, stay Spanish rest of conversation.

━━━ REAL PHRASES — rotate these, never repeat same one twice in a row ━━━
Acknowledge: 10.4 / yes sir / perfect / bet / fasho / ok / copy
Dirt looks good: beautiful / looks good / that works / clean / send it
Dirt rejected: [send "Fuck" alone] then [send "Yea no go on that dirt"] then [send "Sorry bro"]
Buying time: give me a min / let me check / let me verify / ok give me min
Distance issue: [send "Fuck" alone] then "how far is that for you"
Closing: ok perfect, thank you / 10.4 thank you
Late reply: sorry I missed this
Surprise: [send "No shit"] then [send "Dam"]

Address request — rotate:
- whats address your coming from, so I can put in my system and see what I have closest
- send me loading address so I can see which of my sites is the closest
- whats addy your coming from ill put in my system and see if i have anything closer

Truck ask — rotate, never use "Reply:" ever:
- end dump or tandem
- what truck you in
- end dump?
- tandem or end dump

Yards ask — rotate:
- how many yds do you have
- how many yards
- how many yds

Photo ask — rotate:
- send pic of dirt
- send me a pic of the dirt
- need a pic of the dirt first
- can you send a pic of the material

━━━ QUALIFICATION ORDER ━━━
Only ask what you do NOT already have from history or context.
Order: yards → truck type → address → photo
Driver says yes to having dirt → go to first missing piece immediately.
Driver gives address → extract city from it, never ask for city separately.

━━━ JOB PRESENTATION ━━━
Show: city + distance only. No pay rate unless known driver. No job codes. No "Reply 1-5".
"I got [City] [X] miles away — you think that works"
Or if multiple: "Got [City1], [City2], [City3] — which one works for you"
Never show addresses.

━━━ NEGOTIATION (new drivers only — context will tell you) ━━━
If driver asks "how much" or "what does it pay":
Start with the negotiation_floor from context. Never reveal the ceiling.
"I can do $[floor] a load"
If driver pushes back → "tell you what, I can do $[floor+5]"
Never exceed the ceiling from context.

━━━ KNOWN DRIVER (repeat hauler) ━━━
Context will say isKnownDriver: true.
Show pay rate immediately when presenting job.
"[City] [X] miles — [yards] yds — $[pay]/load — work for you"

━━━ PAYMENT COLLECTION ━━━
After delivery confirmed:
"how you want it, zelle or venmo"
Zelle → "send the name and number the zelle account it to"
Venmo → "whats your venmo"
After account info → "got it, we will have it sent shortly"
If driver already has payment on file → skip → "sending to your [method] shortly"

━━━ SPANISH ━━━
dame una foto de la tierra / cuantos yardas tienes / que tipo de camion
cual es la direccion de donde vas a cargar / a ver que tengo cerca
como quieres que te paguemos, zelle o venmo

━━━ SELF CHECK ━━━
1. Did I ask this question already in history? YES → skip it
2. Is response over 2 sentences? YES → cut it
3. Does it sound like a robot or menu? YES → rewrite it
4. Did driver send photo? YES → evaluate dirt, do not ask about dirt
5. Is driver Spanish? YES → full Spanish only

━━━ OUTPUT: valid JSON only, no markdown ━━━
{
  "response": "exact text to send driver",
  "action": "NONE|CLAIM_JOB|COMPLETE_JOB|CANCEL_JOB|ESCALATE|COLLECT_PAYMENT|NEGOTIATE",
  "updates": {
    "state": "DISCOVERY|ASKING_TRUCK|PHOTO_PENDING|APPROVAL_PENDING|ACTIVE|CLOSED|PAYMENT_METHOD_PENDING|PAYMENT_ACCOUNT_PENDING",
    "extracted_city": "city or null",
    "extracted_yards": 0,
    "extracted_truck_type": "tandem_axle|tri_axle|quad_axle|end_dump|belly_dump|side_dump or null",
    "pending_approval_order_id": "job id or null"
  },
  "claimJobId": "job id or null",
  "confidence": 0.95
}`

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1")
}

function e164(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return `+1${digits}`
}

function detectLanguage(text: string): "en" | "es" {
  return /\b(hola|tengo|tierra|camion|limpia|cuantos|yardas|direccion|tiradero|volteo|carga|traigo|donde|busco|necesito|dame|manda)\b/i.test(text)
    ? "es" : "en"
}

function parseLoads(text: string): number | null {
  const t = text.trim()
  if (/^\d+$/.test(t)) return Math.min(parseInt(t), 50)
  const m = t.match(/(\d+)\s*(down|loads?|total|done|delivered|drops?|dumped|finished)/i) ||
            t.match(/(done|delivered|total|dropped|dumped|finished)\s*(\d+)/i)
  if (m) return Math.min(parseInt(m[1] || m[2]), 50)
  return null
}

export function generateJobNumber(id: string): string {
  return `DS-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`
}

// ─────────────────────────────────────────────────────────────
// DB HELPERS
// ─────────────────────────────────────────────────────────────
async function getProfile(phone: string): Promise<any> {
  const { data } = await createAdminSupabase().rpc("get_sms_driver", { p_phone: phone })
  return data?.[0] || null
}

async function getConv(phone: string): Promise<any> {
  const { data } = await createAdminSupabase().rpc("get_conversation", { p_phone: phone })
  return data?.[0] || { state: "DISCOVERY" }
}

async function saveConv(phone: string, u: Record<string, any>): Promise<void> {
  await createAdminSupabase().rpc("upsert_conversation", {
    p_phone: phone,
    p_state: u.state ?? null,
    p_job_state: u.job_state ?? null,
    p_active_order_id: u.active_order_id ?? null,
    p_extracted_city: u.extracted_city ?? null,
    p_extracted_yards: u.extracted_yards ?? null,
    p_extracted_truck_type: u.extracted_truck_type ?? null,
    p_extracted_material: u.extracted_material ?? null,
    p_photo_storage_path: u.photo_storage_path ?? null,
    p_photo_public_url: u.photo_public_url ?? null,
    p_reservation_id: u.reservation_id ?? null,
    p_pending_approval_order_id: u.pending_approval_order_id ?? null,
    p_approval_sent_at: u.approval_sent_at ?? null,
    p_voice_call_made: u.voice_call_made ?? null,
    p_last_message_sid: u.last_message_sid ?? null,
  })
}

async function resetConv(phone: string): Promise<void> {
  const conv = await getConv(phone)
  if (conv?.reservation_id) {
    await releaseReservation(conv.reservation_id).catch(() => {})
  }
  await createAdminSupabase().from("conversations").update({
    state: "DISCOVERY", job_state: null, active_order_id: null,
    pending_approval_order_id: null, reservation_id: null,
    extracted_city: null, extracted_yards: null, extracted_truck_type: null,
    extracted_material: null, photo_storage_path: null, photo_public_url: null,
    approval_sent_at: null, voice_call_made: null,
  }).eq("phone", phone)
}

async function isDuplicate(sid: string): Promise<boolean> {
  const { data } = await createAdminSupabase().rpc("check_and_mark_message", { p_sid: sid })
  return !data // RPC returns false if duplicate
}

async function getHistory(phone: string): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data } = await createAdminSupabase()
    .from("sms_logs")
    .select("body, direction")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(16)
  if (!data) return []
  return data.reverse()
    .map((m: any) => ({
      role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
      content: (m.body || "").trim(),
    }))
    .filter(m => m.content.length > 0)
}

async function logMsg(phone: string, body: string, dir: "inbound" | "outbound", sid: string): Promise<void> {
  try {
    await createAdminSupabase().from("sms_logs").insert({ phone, body, direction: dir, message_sid: sid })
  } catch {}
}

async function logEvent(type: string, payload: Record<string, any>, jobId?: string): Promise<void> {
  try {
    await createAdminSupabase().from("event_log").insert({
      event_type: type, job_id: jobId, payload, created_at: new Date().toISOString(),
    })
  } catch {}
}

async function sendSMS(toPhone: string, body: string): Promise<void> {
  try {
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
    const from = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER
    await twilioClient.messages.create({ body, from: from!, to: e164(toPhone) })
  } catch (err: any) {
    console.error("[sendSMS]", err?.message)
  }
}

async function sendAdminAlert(msg: string): Promise<void> {
  await sendSMS(ADMIN_PHONE, msg)
}

async function getActiveJob(conv: any): Promise<any> {
  if (!conv?.active_order_id) return null
  const { data } = await createAdminSupabase()
    .from("dispatch_orders")
    .select("id, client_address, client_name, client_phone, yards_needed, driver_pay_cents, status, notes, cities(name)")
    .eq("id", conv.active_order_id)
    .maybeSingle()
  return data
}

async function getPaymentInfo(phone: string): Promise<{ method: string; account: string } | null> {
  const { data } = await createAdminSupabase()
    .from("driver_profiles")
    .select("payment_method")
    .eq("phone", phone)
    .maybeSingle()
  if (data?.payment_method) {
    const parts = data.payment_method.split(":")
    if (parts.length >= 2) return { method: parts[0], account: parts.slice(1).join(":") }
  }
  return null
}

async function savePaymentInfo(phone: string, method: string, account: string): Promise<void> {
  await createAdminSupabase()
    .from("driver_profiles")
    .update({ payment_method: `${method}:${account}` })
    .eq("phone", phone)
}

async function getCompletedLoadsCount(userId: string): Promise<number> {
  const { count } = await createAdminSupabase()
    .from("driver_payments")
    .select("id", { count: "exact", head: true })
    .eq("driver_id", userId)
  return count || 0
}

// ─────────────────────────────────────────────────────────────
// BRAIN — single Claude inference
// ─────────────────────────────────────────────────────────────
async function callBrain(
  phone: string,
  body: string,
  hasPhoto: boolean,
  photoUrl: string | undefined,
  conv: any,
  profile: any,
  history: { role: "user" | "assistant"; content: string }[],
  nearbyJobs: JobMatch[],
  activeJob: any,
  lang: "en" | "es",
  isKnownDriver: boolean,
  savedPayment: { method: string; account: string } | null,
): Promise<BrainOutput> {
  const topJob = nearbyJobs[0]
  const paymentCeilingCents = topJob?.driverPayCents || 5000
  const negotiationFloorCents = isKnownDriver
    ? paymentCeilingCents
    : Math.max(2500, paymentCeilingCents - 2000)

  const ctx = [
    "━━━ LIVE CONTEXT — driver cannot see this ━━━",
    `Language: ${lang === "es" ? "SPANISH — respond 100% in Spanish" : "English"}`,
    `State: ${conv?.state || "DISCOVERY"}`,
    `Driver: ${profile?.first_name || "unknown"} ${profile?.last_name || ""}`.trim(),
    `isKnownDriver: ${isKnownDriver} (${isKnownDriver ? "show pay rate upfront" : "do NOT show pay — negotiate from $" + Math.round(negotiationFloorCents / 100)})`,
    `negotiation_floor: $${Math.round(negotiationFloorCents / 100)}/load`,
    `negotiation_ceiling: $${Math.round(paymentCeilingCents / 100)}/load (NEVER exceed or reveal)`,
    `savedPayment: ${savedPayment ? savedPayment.method + " — " + savedPayment.account : "none on file"}`,
    `Yards: ${conv?.extracted_yards || "not provided"}`,
    `Truck: ${conv?.extracted_truck_type || "not provided"}`,
    `City: ${conv?.extracted_city || "not provided"}`,
    `Photo on file: ${conv?.photo_public_url ? "YES" : "no"}`,
    `Photo in THIS message: ${hasPhoto ? "YES — evaluate the dirt" : "no"}`,
    `Active job: ${activeJob ? `YES — ${(activeJob.cities as any)?.name}, $${Math.round(activeJob.driver_pay_cents / 100)}/load, ${activeJob.yards_needed} yds` : "none"}`,
    nearbyJobs.length > 0
      ? `Nearby sites:\n${nearbyJobs.slice(0, 3).map((j, i) =>
          `  ${i + 1}. ${j.cityName} — ${j.distanceMiles.toFixed(1)} mi — ${j.yardsNeeded} yds — truck: ${j.truckTypeNeeded?.replace(/_/g, " ") || "any"} — jobId: ${j.id}`
        ).join("\n")}`
      : "Nearby sites: none available right now",
    "━━━ END CONTEXT ━━━",
    "",
    `Driver just sent: ${body || (hasPhoto ? "[photo of dirt — no text]" : "[empty]")}`,
    "",
    "Think: 1) What did driver send? 2) What do I already know? 3) What is the one right next thing? 4) Does it sound human? Output JSON.",
  ].filter(Boolean).join("\n")

  const messages = [
    ...history.slice(-10),
    { role: "user" as const, content: ctx },
  ]

  let raw = ""
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: JESSE_PROMPT,
      messages,
    })
    raw = resp.content[0].type === "text" ? resp.content[0].text.trim() : ""
    raw = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    const parsed = JSON.parse(raw) as BrainOutput
    // Safety: cap response length
    if (parsed.response && parsed.response.length > 300) {
      parsed.response = parsed.response.slice(0, 300)
    }
    return parsed
  } catch (err) {
    console.error("[Brain] failed. raw:", raw?.slice(0, 200), err)
    const fallbacks: Record<string, string> = {
      DISCOVERY: lang === "es" ? "tienes tierra hoy" : "you got dirt today",
      ASKING_TRUCK: lang === "es" ? "que tipo de camion" : "end dump or tandem",
      PHOTO_PENDING: lang === "es" ? "dame una foto de la tierra" : "send pic of dirt",
      APPROVAL_PENDING: "give me a min",
      ACTIVE: "10.4",
      PAYMENT_METHOD_PENDING: lang === "es" ? "zelle o venmo" : "how you want it, zelle or venmo",
      PAYMENT_ACCOUNT_PENDING: lang === "es" ? "mandame tu zelle" : "send the name and number the zelle account it to",
    }
    return {
      response: fallbacks[conv?.state || "DISCOVERY"] || "10.4",
      action: "NONE",
      updates: {},
      confidence: 0,
    }
  }
}

// ─────────────────────────────────────────────────────────────
// PAYMENT FLOW
// ─────────────────────────────────────────────────────────────
async function handlePayment(
  phone: string, body: string, conv: any, lang: "en" | "es"
): Promise<string> {
  const lower = body.toLowerCase().trim()

  if (conv.state === "PAYMENT_METHOD_PENDING" || conv.state === "AWAITING_PAYMENT_COLLECTION") {
    const isZelle = /zelle/i.test(lower)
    const isVenmo = /venmo/i.test(lower)
    if (isZelle || isVenmo) {
      const method = isZelle ? "zelle" : "venmo"
      await saveConv(phone, { ...conv, state: "PAYMENT_ACCOUNT_PENDING", job_state: method })
      if (lang === "es") return isZelle ? "mandame el nombre y numero de tu zelle" : "mandame tu venmo"
      return isZelle ? "send the name and number the zelle account it to" : "whats your venmo"
    }
    return lang === "es" ? "zelle o venmo" : "how you want it, zelle or venmo"
  }

  if (conv.state === "PAYMENT_ACCOUNT_PENDING") {
    const method = conv.job_state || "zelle"
    await savePaymentInfo(phone, method, body.trim())
    await resetConv(phone)
    await sendAdminAlert(`PAYMENT: ${phone} — ${method} — ${body.trim()}`)
    return lang === "es" ? "listo, te mandamos en rato" : "got it, we will have it sent shortly"
  }

  return "10.4"
}

// ─────────────────────────────────────────────────────────────
// DELIVERY COMPLETE
// ─────────────────────────────────────────────────────────────
async function handleDelivery(
  phone: string, conv: any, profile: any, activeJob: any, loads: number, lang: "en" | "es"
): Promise<string> {
  const sb = createAdminSupabase()
  const payPerLoad = activeJob.driver_pay_cents || 4500
  const totalCents = payPerLoad * loads
  const totalDollars = Math.round(totalCents / 100)
  const jobNum = generateJobNumber(activeJob.id)

  // Complete load request if exists
  const { data: activeLoad } = await sb
    .from("load_requests")
    .select("id")
    .eq("dispatch_order_id", activeJob.id)
    .eq("driver_id", profile.user_id)
    .in("status", ["pending", "approved", "in_progress"])
    .maybeSingle()

  if (activeLoad) {
    await sb.from("load_requests").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      payout_cents: totalCents,
      truck_count: loads,
    }).eq("id", activeLoad.id)
  }

  // Insert payment record
  try {
    await sb.from("driver_payments").insert({
      driver_id: profile.user_id,
      load_request_id: activeLoad?.id,
      amount_cents: totalCents,
      status: "pending",
    })
  } catch (e: any) { console.error("[payment]", e.message) }

  await logEvent("DELIVERY_VERIFIED", { phone, jobNum, loads, totalDollars }, activeJob.id)
  await sendAdminAlert(`${jobNum} complete — ${profile.first_name} ${loads} load${loads > 1 ? "s" : ""} $${totalDollars}`)

  // Notify customer
  if (activeJob.client_phone) {
    const custPhone = activeJob.client_phone.replace(/\D/g, "").replace(/^1/, "")
    const custMsg = lang === "es"
      ? `Hola — ${profile.first_name} termino la entrega. ${loads} carga${loads > 1 ? "s" : ""}. Todo bien`
      : `Hey — ${profile.first_name} finished the delivery. ${loads} load${loads > 1 ? "s" : ""}. Everything look good on your end`
    await sendSMS(custPhone, custMsg)
  }

  // Check for saved payment info
  const savedPay = await getPaymentInfo(phone)
  if (savedPay) {
    await resetConv(phone)
    await sendAdminAlert(`PAYMENT: ${profile.first_name} — ${savedPay.method} — ${savedPay.account} — $${totalDollars}`)
    return lang === "es"
      ? `10.4 — ${loads} carga${loads > 1 ? "s" : ""}. Mandando a tu ${savedPay.method}`
      : `10.4 — ${loads} load${loads > 1 ? "s" : ""}. Sending to your ${savedPay.method} shortly`
  }

  // No payment on file — collect it
  await saveConv(phone, { state: "PAYMENT_METHOD_PENDING", active_order_id: activeJob.id })
  const opts = lang === "es"
    ? [`10.4 — ${loads} carga${loads > 1 ? "s" : ""}. Como quieres que te paguemos, zelle o venmo`]
    : [
        `10.4 — ${loads} load${loads > 1 ? "s" : ""}. $${totalDollars} coming. How you want it, zelle or venmo`,
        `Got it — ${loads} load${loads > 1 ? "s" : ""} logged. $${totalDollars}. Zelle or venmo`,
      ]
  return opts[Math.floor(Math.random() * opts.length)]
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

  // ── Dedup ───────────────────────────────────────────────────
  if (await isDuplicate(sid)) return ""

  // ── Log inbound ─────────────────────────────────────────────
  await logMsg(phone, body || "[photo]", "inbound", sid)

  // ── STOP / START ────────────────────────────────────────────
  const lower = body.toLowerCase().trim()
  if (lower === "stop" || lower === "unsubscribe") {
    await createAdminSupabase().from("driver_profiles").update({ sms_opted_out: true }).eq("phone", phone)
    return ""
  }
  if (lower === "start") {
    await createAdminSupabase().from("driver_profiles").update({ sms_opted_out: false }).eq("phone", phone)
    return "Yea you back on"
  }

  // ── Load context in parallel ────────────────────────────────
  const [profile, conv, history] = await Promise.all([
    getProfile(phone),
    getConv(phone),
    getHistory(phone),
  ])

  if (profile?.sms_opted_out) return ""

  const lang: "en" | "es" = detectLanguage(body) === "es" ? "es" : "en"
  const isKnownDriver = profile ? (await getCompletedLoadsCount(profile.user_id)) >= 2 : false

  // ── ONBOARDING ──────────────────────────────────────────────
  if (!profile) {
    const convState = conv?.state || "DISCOVERY"
    if (convState !== "GETTING_NAME") {
      await saveConv(phone, { state: "GETTING_NAME" })
      return lang === "es" ? "Hola, como te llamas" : "Hey whats your name"
    }
    const parts = body.trim().split(/\s+/)
    const first = parts[0] || "Driver"
    const last = parts.slice(1).join(" ") || ""
    await createAdminSupabase().rpc("create_sms_driver", { p_phone: phone, p_first_name: first, p_last_name: last })
    await saveConv(phone, { state: "DISCOVERY" })
    await logEvent("CONTACT_CREATED", { phone, firstName: first })
    return lang === "es" ? `${first} te tengo. Tienes tierra hoy` : `${first} got you. You got dirt today`
  }

  const firstName = profile.first_name || "Driver"
  const convState = conv?.state || "DISCOVERY"

  // ── PAYMENT STATES ──────────────────────────────────────────
  if (["PAYMENT_METHOD_PENDING", "PAYMENT_ACCOUNT_PENDING", "AWAITING_PAYMENT_COLLECTION"].includes(convState)) {
    return await handlePayment(phone, body, conv, lang)
  }

  // ── ACTIVE JOB + LOAD COUNT ─────────────────────────────────
  const activeJob = await getActiveJob(conv)
  if (activeJob && convState === "ACTIVE") {
    // Address resend
    if (/addy|address|where|location|directions/i.test(lower)) {
      return `${activeJob.client_address} — ${(activeJob.cities as any)?.name || ""}`
    }
    // Cancel
    if (/^cancel$/i.test(lower)) {
      const jobNum = generateJobNumber(activeJob.id)
      await resetConv(phone)
      await sendAdminAlert(`${jobNum} cancelled — ${firstName}`)
      return `${jobNum} cancelled. Text when you got another load`
    }
    // Completion
    const loads = parseLoads(body)
    if (loads !== null) {
      return await handleDelivery(phone, conv, profile, activeJob, loads, lang)
    }
    // Catch-all for active job
    return `You got ${generateJobNumber(activeJob.id)} active. Text load count when done`
  }

  // ── LOAD NEARBY JOBS ────────────────────────────────────────
  let nearbyJobs: JobMatch[] = []
  const lookupCity = conv?.extracted_city
  const lookupTruck = conv?.extracted_truck_type
  if (lookupCity) {
    try { nearbyJobs = await findNearbyJobs(lookupCity, lookupTruck || undefined) } catch {}
  }

  // ── CALL BRAIN ──────────────────────────────────────────────
  const savedPayment = await getPaymentInfo(phone)
  const brain = await callBrain(
    phone, body, hasPhoto, photoUrl,
    conv, profile, history,
    nearbyJobs, activeJob, lang,
    isKnownDriver, savedPayment
  )

  // ── PERSIST UPDATES ─────────────────────────────────────────
  const toSave: Record<string, any> = { ...conv }
  if (brain.updates.state) toSave.state = brain.updates.state
  if (brain.updates.extracted_city) toSave.extracted_city = brain.updates.extracted_city
  if (brain.updates.extracted_yards) toSave.extracted_yards = brain.updates.extracted_yards
  if (brain.updates.extracted_truck_type) toSave.extracted_truck_type = brain.updates.extracted_truck_type
  if (brain.updates.photo_public_url) toSave.photo_public_url = brain.updates.photo_public_url
  if (brain.updates.pending_approval_order_id) toSave.pending_approval_order_id = brain.updates.pending_approval_order_id
  if (hasPhoto && photoUrl) toSave.photo_public_url = photoUrl

  // ── EXECUTE ACTIONS ─────────────────────────────────────────
  if (brain.action === "CLAIM_JOB" && brain.claimJobId) {
    try {
      const reservationId = await atomicClaimJob(brain.claimJobId, phone, profile.user_id)
      if (reservationId) {
        toSave.reservation_id = reservationId
        toSave.active_order_id = brain.claimJobId
        toSave.state = "PHOTO_PENDING"
      }
    } catch (err) {
      console.error("[claim]", err)
    }
  }

  if (brain.action === "CANCEL_JOB" && conv?.reservation_id) {
    await releaseReservation(conv.reservation_id).catch(() => {})
    await resetConv(phone)
    return brain.response
  }

  if (brain.action === "COMPLETE_JOB" && activeJob) {
    const loads = parseLoads(body) || 1
    return await handleDelivery(phone, conv, profile, activeJob, loads, lang)
  }

  await saveConv(phone, toSave)
  return brain.response
}

export const smsDispatchService = {
  handleIncoming: handleConversation,
  generateJobNumber,
}
