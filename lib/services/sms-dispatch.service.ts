import { createAdminSupabase } from '../supabase'
import { sendAdminAlert } from '../sms'
import Anthropic from '@anthropic-ai/sdk'
import { generateSiteToken } from '@/lib/utils/site-token'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'

interface IncomingSMS {
  from: string
  body: string
  messageSid: string
}

// ─── Job number ───────────────────────────────────────────────────────────────
export function generateJobNumber(dispatchId: string): string {
  const short = dispatchId.replace(/-/g, '').slice(0, 6).toUpperCase()
  return `DS-${short}`
}

// ─── AI only for done/cancel — hardcoded everything else ─────────────────────
async function doneReply(firstName: string, loads: number, dollars: number, job: string): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      system: 'You are texting as Juan, a laid-back dirt broker. Style: 1 sentence, no punctuation at end, casual. Real examples: "10.4 got you" | "Perfect" | "Ok np" | "Got it". Acknowledge the loads were completed and payment is coming. Keep it under 10 words.',
      messages: [{ role: 'user', content: `Driver ${firstName} just completed ${loads} loads. Payout is $${dollars}. Job ${job}. Write the reply.` }]
    })
    const block = msg.content[0]
    return (block.type === 'text' ? block.text : '').trim()
  } catch {
    return `10.4 — ${loads} load${loads > 1 ? 's' : ''}. $${dollars} otw`
  }
}

// ─── Zip to city ──────────────────────────────────────────────────────────────
const ZIP_MAP: Record<string, string> = {
  '750': 'Dallas', '751': 'Dallas', '752': 'Dallas',
  '760': 'Fort Worth', '761': 'Fort Worth',
  '762': 'Denton',
  '800': 'Denver', '801': 'Denver', '802': 'Lakewood',
  '803': 'Boulder', '808': 'Colorado Springs', '809': 'Colorado Springs',
}

async function zipToCity(zip: string): Promise<{ cityId: string | null; cityName: string }> {
  const supabase = createAdminSupabase()
  const prefix = zip.slice(0, 3)
  const guessedCity = ZIP_MAP[prefix] || 'Dallas'

  const { data: city } = await supabase
    .from('cities')
    .select('id, name')
    .ilike('name', `%${guessedCity}%`)
    .maybeSingle()

  return { cityId: city?.id || null, cityName: city?.name || guessedCity }
}

// ─── Session management ───────────────────────────────────────────────────────
async function getSession(phone: string) {
  const supabase = createAdminSupabase()
  const { data } = await supabase
    .from('sms_sessions')
    .select('*')
    .eq('phone', phone)
    .maybeSingle()
  return data
}

async function setSession(phone: string, updates: Record<string, any>) {
  const supabase = createAdminSupabase()
  await supabase
    .from('sms_sessions')
    .upsert(
      { phone, ...updates, updated_at: new Date().toISOString() },
      { onConflict: 'phone' }
    )
}

async function clearSession(phone: string) {
  const supabase = createAdminSupabase()
  await supabase
    .from('sms_sessions')
    .upsert(
      {
        phone,
        state: 'idle',
        zip_code: null,
        city_name: null,
        material_type: null,
        estimated_yards: null,
        sites_shown: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'phone' }
    )
}

// ─── Material detector ────────────────────────────────────────────────────────
function detectMaterial(text: string): string | null {
  const t = text.toLowerCase()
  if (t.includes('clean fill') || t.includes('cleanfill')) return 'clean fill'
  if (t.includes('sandy loam') || t.includes('sandy')) return 'sandy loam'
  if (t.includes('caliche')) return 'caliche'
  if (t.includes('topsoil') || t.includes('top soil')) return 'topsoil'
  if (t.includes('clay')) return 'clay'
  if (t.includes('concrete') || t.includes('demo')) return 'concrete'
  if (t.includes('rock') || t.includes('gravel')) return 'rock'
  if (t.includes('mixed') || t.includes('mix')) return 'mixed'
  if (t.includes('fill dirt') || t.includes('fill') || t.includes('dirt')) return 'clean fill'
  return null
}

// ─── Zip detector ─────────────────────────────────────────────────────────────
function detectZip(text: string): string | null {
  const match = text.match(/\b(\d{5})\b/)
  return match ? match[1] : null
}

// ─── Yards detector ───────────────────────────────────────────────────────────
function detectYards(text: string): number | null {
  const yardMatch = text.match(/(\d+)\s*(?:yards?|yds?|cubic|cy)/i)
  if (yardMatch) return parseInt(yardMatch[1])
  const tonMatch = text.match(/(\d+)\s*(?:tons?|t\b)/i)
  if (tonMatch) return Math.round(parseInt(tonMatch[1]) * 0.7)
  const numMatch = text.match(/\b(\d{2,5})\b/)
  if (numMatch) {
    const n = parseInt(numMatch[1])
    if (n >= 10 && n <= 50000) return n
  }
  return null
}

// ─── Intent detector ─────────────────────────────────────────────────────────
function detectIntent(text: string): 'need_site' | 'yes' | 'no' | 'unknown' {
  const t = text.toLowerCase().trim()
  const needSite = ['need','dumpsite','dump site','dump','site','haul','hauling','load','loaded','ready','got dirt','moving dirt','where can','where do','i have dirt','disposal','dispose']
  const yes = ['yes','yeah','yep','yup','yea','correct','sure','ok','okay','affirmative','roger','10-4','104','10.4','fs','for sure','absolutely','definitely']
  const no = ['no','nope','nah','not yet','cancel','nevermind','never mind']

  if (no.some(w => t === w || t.startsWith(w + ' '))) return 'no'
  if (yes.some(w => t === w || t.startsWith(w + ' '))) return 'yes'
  if (needSite.some(w => t.includes(w))) return 'need_site'
  return 'unknown'
}

// ─── Site finder ──────────────────────────────────────────────────────────────
async function findSites(cityId: string | null, material: string, yards: number | null) {
  const supabase = createAdminSupabase()

  let query = supabase
    .from('dump_sites')
    .select('id, capacity_yards, filled_yards, accepted_materials, gate_code, hours_text, access_instructions, operator_name, city_id')
    .eq('is_active', true)

  if (cityId) query = query.eq('city_id', cityId)

  const { data: sites, error } = await query

  if (error) console.error('[findSites] error:', error)
  if (!sites || sites.length === 0) return []

  const yardsNeeded = yards || 1
  const mt = material.toLowerCase()

  return sites
    .filter(s => {
      const cap = (s.capacity_yards || 0) - (s.filled_yards || 0)
      if (cap < yardsNeeded) return false
      const accepted: string[] = s.accepted_materials || ['clean fill']
      // If no restrictions, accept anything
      if (accepted.length === 0) return true
      return accepted.some((m: string) => {
        const ml = m.toLowerCase()
        return ml === 'all' || ml.includes(mt) || mt.includes(ml) || ml === 'clean fill'
      })
    })
    .sort(
      (a, b) =>
        ((b.capacity_yards || 0) - (b.filled_yards || 0)) -
        ((a.capacity_yards || 0) - (a.filled_yards || 0))
    )
    .slice(0, 3)
}

// ─── Main conversation handler ────────────────────────────────────────────────
async function handleConversation(sms: IncomingSMS): Promise<string> {
  const supabase = createAdminSupabase()
  const { from, body, messageSid } = sms
  const trimmed = body.trim()
  const lower = trimmed.toLowerCase()

  // Log inbound
  try {
    await supabase
      .from('sms_logs')
      .insert({ phone: from, body: trimmed, message_sid: messageSid, direction: 'inbound' })
  } catch {}

  // ── Opt-out handling ──────────────────────────────────────────────────────
  if (lower === 'stop' || lower === 'unsubscribe') {
    await supabase.from('driver_profiles').update({ sms_opted_out: true }).eq('phone', from)
    return ''
  }
  if (lower === 'start' || lower === 'subscribe') {
    await supabase.from('driver_profiles').update({ sms_opted_out: false }).eq('phone', from)
    return "You're back on. Text us when you got a load"
  }

  // ── Driver lookup ─────────────────────────────────────────────────────────
  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, status, sms_opted_out')
    .eq('phone', from)
    .maybeSingle()

  // Auto-create driver if they don't exist — SMS IS the signup
  if (!profile) {
    const supabaseAc = createAdminSupabase()

    // Check session for name collection
    const newSession = await getSession(from)

    if (!newSession?.state || newSession.state === 'idle') {
      await setSession(from, { state: 'getting_name' })
      return "Hey — what's your name"
    }

    if (newSession.state === 'getting_name') {
      const name = trimmed.trim()
      if (name.length < 2 || name.length > 40) {
        return "What's your name"
      }
      const firstName = name.split(' ')[0]
      const lastName = name.split(' ').slice(1).join(' ') || ''

      // Auto-create driver profile
      try {
        await supabaseAc.from('driver_profiles').insert({
          phone: from,
          first_name: firstName,
          last_name: lastName,
          status: 'active',
          phone_verified: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      } catch {}

      await setSession(from, { state: 'asking_zip' })
      return firstName + ' got you. What\'s the zip you hauling from'
    }

    // Still in name flow
    await setSession(from, { state: 'getting_name' })
    return "What's your name"
  }

  if (profile.sms_opted_out) return ''

  // Auto-activate if somehow inactive
  if (profile.status !== 'active') {
    await createAdminSupabase()
      .from('driver_profiles')
      .update({ status: 'active' })
      .eq('phone', from)
  }

  const firstName = profile.first_name || 'Driver'

  // ── Help ──────────────────────────────────────────────────────────────────
  if (lower === 'help' || lower === '?') {
    return 'Text your zip + material when you got a load ready\nReply DONE [loads] when finished\nReply CANCEL to cancel\ndumpsite.io/dashboard'
  }

  // ── Check active load ─────────────────────────────────────────────────────
  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, status, dispatch_order_id, dispatch_orders(driver_pay_cents, cities(name))')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .maybeSingle()

  // ── DONE ──────────────────────────────────────────────────────────────────
  if (lower.startsWith('done') || lower.startsWith('complete') || lower.startsWith('finished')) {
    if (!activeLoad) return 'No active job found. Check dumpsite.io/dashboard'
    const loadMatch = trimmed.match(/(\d+)/)
    const loads = loadMatch ? Math.min(parseInt(loadMatch[1], 10), 50) : 1
    const payPerLoad = (activeLoad.dispatch_orders as any)?.driver_pay_cents || 3500
    const totalCents = payPerLoad * loads
    const totalDollars = Math.round(totalCents / 100)
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)

    await supabase.from('load_requests').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      payout_cents: totalCents,
      truck_count: loads,
    }).eq('id', activeLoad.id)

    try {
      await supabase.from('driver_payments').insert({
        driver_id: profile.user_id,
        load_request_id: activeLoad.id,
        amount_cents: totalCents,
        status: 'pending',
      })
    } catch {}

    try { await sendAdminAlert(`${jobNum} complete — ${firstName} ${loads} loads $${totalDollars}`) } catch {}
    await clearSession(from)
    return await doneReply(firstName, loads, totalDollars, jobNum)
  }

  // ── CANCEL ────────────────────────────────────────────────────────────────
  if (lower === 'cancel' || lower === 'stop job') {
    await clearSession(from)
    if (!activeLoad) return 'No active job to cancel'
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    await supabase.from('load_requests').update({
      status: 'rejected',
      rejected_reason: 'Cancelled by driver via SMS',
      reviewed_at: new Date().toISOString(),
    }).eq('id', activeLoad.id)
    try { await sendAdminAlert(`${jobNum} cancelled via SMS — ${firstName}`) } catch {}
    return `${jobNum} cancelled. Text us when you got another load`
  }

  // ── STATUS ────────────────────────────────────────────────────────────────
  if (lower === 'status' || lower === 'job') {
    if (!activeLoad) return 'No active jobs. Text your zip when you got a load ready'
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    const city = (activeLoad.dispatch_orders as any)?.cities?.name || ''
    return `${jobNum} — ${city} — ${activeLoad.status}\nReply DONE [loads] when finished`
  }

  // ── Already has active load ───────────────────────────────────────────────
  if (activeLoad) {
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    return `You got ${jobNum} active. Reply DONE [loads] when finished or CANCEL to cancel`
  }

  // ── Get session ───────────────────────────────────────────────────────────
  const session = await getSession(from)
  const currentState = session?.state || 'idle'

  // ── Detect everything from current message ────────────────────────────────
  const detectedZip = detectZip(trimmed)
  const detectedMaterial = detectMaterial(trimmed)
  const detectedYards = detectYards(trimmed)
  const detectedIntent = detectIntent(trimmed)

  // ── Site selection (1, 2, 3) ──────────────────────────────────────────────
  if (
    (lower === '1' || lower === '2' || lower === '3') &&
    currentState === 'sites_shown' &&
    session?.sites_shown?.length
  ) {
    const choice = parseInt(lower)
    const siteId = session.sites_shown[choice - 1]
    if (!siteId) return `Reply 1${session.sites_shown.length > 1 ? '-' + session.sites_shown.length : ''} to pick a site`

    const { data: site } = await supabase.from('dump_sites').select('*').eq('id', siteId).single()
    if (!site) return 'That site just went offline. Text your zip for new options'

    const cap = (site.capacity_yards || 0) - (site.filled_yards || 0)
    if (cap <= 0) return 'That one just filled up. Text your zip for new options'

    const jobNumber = 'DS-' + Date.now().toString().slice(-6)
    try {
      await supabase.from('dispatch_jobs').insert({
        job_number: jobNumber,
        driver_id: profile.user_id,
        site_id: site.id,
        city_name: session.city_name,
        material_type: session.material_type,
        estimated_yards: session.estimated_yards,
        driver_phone: from,
        status: 'in_progress',
        source: 'sms',
        updated_at: new Date().toISOString(),
      })
    } catch {}

    if (session.estimated_yards) {
      try {
        await supabase.rpc('reserve_site_capacity', { p_site_id: site.id, p_yards: session.estimated_yards })
      } catch {}
    }

    await clearSession(from)

    const token = generateSiteToken({ siteId: site.id, jobId: siteId, driverPhone: from, expiresInMinutes: 240 })
    const gate = site.gate_code ? `\nGate: ${site.gate_code}` : ''
    const hours = site.hours_text ? `\nHours: ${site.hours_text}` : ''

    return `${jobNumber} — locked in\n${APP_URL}/api/sites/reveal?t=${token}${gate}${hours}\nReply DONE [loads] when finished`
  }

  // ── State: asking_intent — waiting for yes/no ─────────────────────────────
  if (currentState === 'asking_intent') {
    if (detectedIntent === 'no') {
      await clearSession(from)
      return 'Ok np. Text us when you need a site'
    }
    // Any affirmative or if they provided zip/material, move forward
    if (detectedIntent === 'yes' || detectedIntent === 'need_site' || detectedZip || detectedMaterial) {
      if (detectedZip) {
        // They gave us zip already
        const { cityName } = await zipToCity(detectedZip)
        await setSession(from, { state: 'asking_material', zip_code: detectedZip, city_name: cityName, estimated_yards: detectedYards })
        return `${cityName} — what material? clean fill, clay, topsoil, mixed, caliche`
      }
      await setSession(from, { state: 'asking_zip' })
      return "What's the zip you hauling from"
    }
    // Still unclear
    await setSession(from, { state: 'asking_zip' })
    return "What's the zip you hauling from"
  }

  // ── State: asking_zip — waiting for zip code ──────────────────────────────
  if (currentState === 'asking_zip') {
    if (detectedZip) {
      const { cityName } = await zipToCity(detectedZip)
      // Check if they also included material
      if (detectedMaterial) {
        await setSession(from, { state: 'finding_sites', zip_code: detectedZip, city_name: cityName, material_type: detectedMaterial, estimated_yards: detectedYards })
        return await showSites(from, cityName, detectedMaterial, detectedYards, profile.user_id)
      }
      await setSession(from, { state: 'asking_material', zip_code: detectedZip, city_name: cityName, estimated_yards: detectedYards })
      return `${cityName} — what material? clean fill, clay, topsoil, mixed, caliche`
    }
    // No zip detected — ask again clearly
    return "Need your 5-digit zip code"
  }

  // ── State: asking_material — waiting for material ─────────────────────────
  if (currentState === 'asking_material') {
    if (detectedMaterial) {
      const zip = session?.zip_code || detectedZip
      const cityName = session?.city_name || 'Dallas'
      const yards = detectedYards || session?.estimated_yards || null
      await setSession(from, { state: 'finding_sites', material_type: detectedMaterial, estimated_yards: yards })
      return await showSites(from, cityName, detectedMaterial, yards, profile.user_id)
    }
    // Still no material
    return 'What material? clean fill, clay, topsoil, mixed, or caliche'
  }

  // ── State: sites_shown — waiting for selection ────────────────────────────
  if (currentState === 'sites_shown') {
    // They texted something other than 1/2/3
    const count = session?.sites_shown?.length || 1
    return `Reply ${count === 1 ? '1' : '1-' + count} to claim a site`
  }

  // ── Fresh message — detect everything ─────────────────────────────────────
  // Case 1: They gave us zip + material in one message
  if (detectedZip && detectedMaterial) {
    const { cityName } = await zipToCity(detectedZip)
    await setSession(from, { state: 'finding_sites', zip_code: detectedZip, city_name: cityName, material_type: detectedMaterial, estimated_yards: detectedYards })
    return await showSites(from, cityName, detectedMaterial, detectedYards, profile.user_id)
  }

  // Case 2: They gave zip only
  if (detectedZip) {
    const { cityName } = await zipToCity(detectedZip)
    await setSession(from, { state: 'asking_material', zip_code: detectedZip, city_name: cityName, estimated_yards: detectedYards })
    return `${cityName} — what material? clean fill, clay, topsoil, mixed, caliche`
  }

  // Case 3: They gave material only
  if (detectedMaterial) {
    await setSession(from, { state: 'asking_zip', material_type: detectedMaterial, estimated_yards: detectedYards })
    return "What's the zip you hauling from"
  }

  // Case 4: Clear intent to need a site
  if (detectedIntent === 'need_site') {
    await setSession(from, { state: 'asking_zip' })
    return "What's the zip you hauling from"
  }

  // Case 5: Totally unknown — ask if they need a site
  await setSession(from, { state: 'asking_intent' })
  return 'Need a dump site?'
}

// ─── Show sites helper ────────────────────────────────────────────────────────
async function showSites(
  phone: string,
  cityName: string,
  material: string,
  yards: number | null,
  driverUserId: string
): Promise<string> {
  const supabase = createAdminSupabase()

  const { data: cityRow } = await supabase
    .from('cities')
    .select('id')
    .ilike('name', `%${cityName}%`)
    .maybeSingle()

  const sites = await findSites(cityRow?.id || null, material, yards)

  if (sites.length === 0) {
    // Add to waitlist
    try {
      await supabase.from('dispatch_waitlist').insert({
        driver_id: driverUserId,
        city_id: cityRow?.id || null,
        city_name: cityName,
        material_type: material,
        estimated_yards: yards,
        notified: false,
      })
    } catch {}
    await clearSession(phone)
    return `Nothing available right now in ${cityName} for ${material}. Got you on the list — will text soon as one opens`
  }

  const yardsText = yards ? ` (${yards} yds)` : ''
  const lines: string[] = [`${cityName} — ${material}${yardsText}`, '']

  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]
    const cap = (s.capacity_yards || 0) - (s.filled_yards || 0)
    const token = generateSiteToken({ siteId: s.id, jobId: s.id, driverPhone: phone, expiresInMinutes: 240 })
    lines.push(`Site ${i + 1} — ${cap} yds available`)
    lines.push(`${APP_URL}/api/sites/reveal?t=${token}`)
    if (i < sites.length - 1) lines.push('')
  }

  lines.push('')
  lines.push(`Reply ${sites.length === 1 ? '1' : '1-' + sites.length} to claim`)

  // Save site IDs to session
  await setSession(phone, {
    state: 'sites_shown',
    city_name: cityName,
    material_type: material,
    sites_shown: sites.map(s => s.id),
  })

  return lines.join('\n')
}

// ─── Existing exports (unchanged for compatibility) ───────────────────────────
export interface DispatchStatus {
  dispatchId: string
  jobNumber: string
  status: string
  driversNotified: number
  driversAccepted: number
  cityName: string
  createdAt: string
}

export async function getDispatchStatus(dispatchId: string): Promise<{ success: boolean; data?: DispatchStatus; error?: string }> {
  const supabase = createAdminSupabase()
  const { data: order, error } = await supabase
    .from('dispatch_orders')
    .select('id, status, drivers_notified, city_id, created_at, cities(name)')
    .eq('id', dispatchId)
    .single()
  if (error || !order) return { success: false, error: 'Dispatch order not found' }
  const { count: acceptedCount } = await supabase
    .from('load_requests')
    .select('id', { count: 'exact', head: true })
    .eq('dispatch_order_id', dispatchId)
    .in('status', ['approved', 'completed'])
  return {
    success: true,
    data: {
      dispatchId: order.id,
      jobNumber: generateJobNumber(order.id),
      status: order.status,
      driversNotified: order.drivers_notified || 0,
      driversAccepted: acceptedCount || 0,
      cityName: (order.cities as any)?.name || 'Unknown',
      createdAt: order.created_at,
    },
  }
}

export async function redispatchOrder(dispatchId: string, adminUserId: string): Promise<{ success: boolean; driversNotified?: number; error?: string }> {
  const supabase = createAdminSupabase()
  const { data: order, error: orderErr } = await supabase
    .from('dispatch_orders')
    .select('id, city_id, yards_needed, driver_pay_cents, status, drivers_notified, cities(name)')
    .eq('id', dispatchId)
    .single()
  if (orderErr || !order) return { success: false, error: 'Dispatch order not found' }
  if (order.status === 'completed' || order.status === 'cancelled') return { success: false, error: `Cannot re-dispatch a ${order.status} order` }
  const { data: alreadyNotified } = await supabase.from('sms_log').select('to_phone').eq('related_id', dispatchId).eq('message_type', 'dispatch')
  const notifiedPhones = new Set((alreadyNotified || []).map((s: any) => s.to_phone))
  const { data: drivers } = await supabase.from('driver_profiles').select('user_id, phone, phone_verified, tiers(slug, dispatch_priority)').eq('city_id', order.city_id).eq('status', 'active').eq('phone_verified', true).limit(500)
  if (!drivers || drivers.length === 0) return { success: false, error: 'No active drivers in this city' }
  const newDrivers = drivers.filter((d: any) => !notifiedPhones.has(d.phone))
  if (newDrivers.length === 0) return { success: false, error: 'All drivers in this city have already been notified' }
  const { batchDispatchSMS } = await import('../sms')
  const haulDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const cityName = (order.cities as any)?.name || 'DFW'
  const payDollars = order.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 35
  const dispatchDrivers = newDrivers.map((d: any) => ({
    phone: d.phone,
    tierSlug: (d.tiers as any)?.slug || 'trial',
    dispatchId: order.id,
    cityName,
    yardsNeeded: order.yards_needed,
    payDollars,
    haulDate,
  }))
  const { sent, failed } = await batchDispatchSMS(dispatchDrivers)
  await supabase.from('dispatch_orders').update({ drivers_notified: ((order as any).drivers_notified || 0) + sent, status: 'dispatching' }).eq('id', dispatchId)
  await supabase.from('audit_logs').insert({ actor_id: adminUserId, action: 'dispatch_order.redispatched', entity_type: 'dispatch_order', entity_id: dispatchId, metadata: { new_drivers_notified: sent, failed, city: cityName } })
  try { await sendAdminAlert(`Re-dispatch ${generateJobNumber(dispatchId)}: ${sent} new drivers notified in ${cityName}`) } catch {}
  return { success: true, driversNotified: sent }
}

export async function cancelDispatch(dispatchId: string, adminUserId: string, reason: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminSupabase()
  const { data: order, error } = await supabase.from('dispatch_orders').update({ status: 'cancelled' }).eq('id', dispatchId).not('status', 'eq', 'completed').select('id, cities(name)').single()
  if (error || !order) return { success: false, error: 'Order not found or already completed' }
  await supabase.from('audit_logs').insert({ actor_id: adminUserId, action: 'dispatch_order.cancelled', entity_type: 'dispatch_order', entity_id: dispatchId, metadata: { reason, city: (order.cities as any)?.name } })
  return { success: true }
}

export const smsDispatchService = {
  handleIncoming: handleConversation,
  generateJobNumber,
  getDispatchStatus,
  redispatchOrder,
  cancelDispatch,
}
