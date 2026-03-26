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

export function generateJobNumber(dispatchId: string): string {
  const short = dispatchId.replace(/-/g, '').slice(0, 6).toUpperCase()
  return `DS-${short}`
}

// CRITICAL: Strip +1 prefix — DB stores numbers without it
function normalizePhone(phone: string): string {
  return phone.replace(/^\+1/, '').replace(/\D/g, '')
}

async function doneReply(firstName: string, loads: number, dollars: number, job: string): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      system: 'You text like Juan, a chill dirt broker. 1 sentence, no period at end, very casual. Examples: "10.4 got you" | "Perfect" | "Ok np". Acknowledge loads done and payment coming. Under 10 words.',
      messages: [{ role: 'user', content: `${firstName} completed ${loads} loads. Payout $${dollars}. Job ${job}.` }]
    })
    const block = msg.content[0]
    return (block.type === 'text' ? block.text : '').trim()
  } catch {
    return `10.4 — ${loads} load${loads > 1 ? 's' : ''}. $${dollars} otw`
  }
}

const ZIP_PREFIX_MAP: Record<string, string> = {
  '750': 'Dallas', '751': 'Dallas', '752': 'Dallas',
  '760': 'Fort Worth', '761': 'Fort Worth',
  '762': 'Denton',
  '800': 'Denver', '801': 'Denver', '802': 'Lakewood',
  '803': 'Boulder',
  '808': 'Colorado Springs', '809': 'Colorado Springs',
}

async function zipToCity(zip: string): Promise<{ cityId: string | null; cityName: string }> {
  const supabase = createAdminSupabase()
  const prefix = zip.slice(0, 3)
  const guessedCity = ZIP_PREFIX_MAP[prefix] || 'Dallas'
  const { data: city } = await supabase
    .from('cities')
    .select('id, name')
    .ilike('name', `%${guessedCity}%`)
    .maybeSingle()
  return { cityId: city?.id || null, cityName: city?.name || guessedCity }
}

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
    .upsert({ phone, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'phone' })
}

async function clearSession(phone: string) {
  const supabase = createAdminSupabase()
  await supabase
    .from('sms_sessions')
    .upsert({
      phone, state: 'idle', zip_code: null, city_name: null,
      material_type: null, estimated_yards: null, sites_shown: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone' })
}

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

function detectZip(text: string): string | null {
  const match = text.match(/\b(\d{5})\b/)
  return match ? match[1] : null
}

function detectYards(text: string): number | null {
  const yardMatch = text.match(/(\d+)\s*(?:yards?|yds?|cubic|cy)/i)
  if (yardMatch) return parseInt(yardMatch[1])
  const tonMatch = text.match(/(\d+)\s*(?:tons?)\b/i)
  if (tonMatch) return Math.round(parseInt(tonMatch[1]) * 0.7)
  return null
}

function isYes(text: string): boolean {
  const t = text.toLowerCase().trim()
  return ['yes','yeah','yep','yup','yea','sure','ok','okay','correct',
    '10-4','10.4','104','fs','for sure','need','dumpsite','dump',
    'site','haul','load','loaded','ready'].some(w => t === w || t.startsWith(w + ' ') || t.includes(w))
}

function isNo(text: string): boolean {
  const t = text.toLowerCase().trim()
  return ['no','nope','nah','not yet','nevermind','never mind'].some(w => t === w)
}

async function findSites(cityId: string | null, material: string, yards: number | null) {
  const supabase = createAdminSupabase()
  let query = supabase
    .from('dump_sites')
    .select('id, capacity_yards, filled_yards, accepted_materials, gate_code, hours_text, access_instructions, operator_name, city_id')
    .eq('is_active', true)
  if (cityId) query = query.eq('city_id', cityId)
  const { data: sites, error } = await query
  if (error) console.error('[findSites]', error.message)
  if (!sites || sites.length === 0) return []
  const yardsNeeded = yards || 1
  const mt = material.toLowerCase()
  return sites
    .filter(s => {
      const cap = (s.capacity_yards || 0) - (s.filled_yards || 0)
      if (cap < yardsNeeded) return false
      const accepted: string[] = s.accepted_materials || []
      if (accepted.length === 0) return true
      return accepted.some((m: string) => {
        const ml = m.toLowerCase()
        return ml === 'all' || ml.includes(mt) || mt.includes(ml)
      })
    })
    .sort((a, b) =>
      ((b.capacity_yards || 0) - (b.filled_yards || 0)) -
      ((a.capacity_yards || 0) - (a.filled_yards || 0))
    )
    .slice(0, 3)
}

async function showSites(phone: string, cityName: string, material: string, yards: number | null, driverUserId: string): Promise<string> {
  const supabase = createAdminSupabase()
  const { data: cityRow } = await supabase.from('cities').select('id').ilike('name', `%${cityName}%`).maybeSingle()
  const sites = await findSites(cityRow?.id || null, material, yards)
  if (sites.length === 0) {
    try {
      await supabase.from('dispatch_waitlist').insert({
        driver_id: driverUserId, city_id: cityRow?.id || null,
        city_name: cityName, material_type: material,
        estimated_yards: yards, notified: false,
      })
    } catch {}
    await clearSession(phone)
    return `Nothing available right now in ${cityName} for ${material}. Got you on the list — will text when one opens up`
  }
  const yardsText = yards ? ` (${yards} yds)` : ''
  const lines: string[] = [`${cityName} — ${material}${yardsText}`, '']
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]
    const cap = (s.capacity_yards || 0) - (s.filled_yards || 0)
    const token = generateSiteToken({ siteId: s.id, jobId: s.id, driverPhone: phone, expiresInMinutes: 240 })
    lines.push(`Site ${i + 1} — ${cap} yds`)
    lines.push(`${APP_URL}/api/sites/reveal?t=${token}`)
    if (i < sites.length - 1) lines.push('')
  }
  lines.push('')
  lines.push(`Reply ${sites.length === 1 ? '1' : '1-' + sites.length} to claim`)
  await setSession(phone, { state: 'sites_shown', city_name: cityName, material_type: material, estimated_yards: yards, sites_shown: sites.map(s => s.id) })
  return lines.join('\n')
}

async function handleConversation(sms: IncomingSMS): Promise<string> {
  const supabase = createAdminSupabase()
  const { from, body, messageSid } = sms
  const trimmed = body.trim()
  const lower = trimmed.toLowerCase()

  // NORMALIZE PHONE ONCE — everything below uses this
  const phone = normalizePhone(from)

  try {
    await supabase.from('sms_logs').insert({ phone, body: trimmed, message_sid: messageSid, direction: 'inbound' })
  } catch {}

  if (lower === 'stop' || lower === 'unsubscribe') {
    await supabase.from('driver_profiles').update({ sms_opted_out: true }).eq('phone', phone)
    return ''
  }
  if (lower === 'start' || lower === 'subscribe') {
    await supabase.from('driver_profiles').update({ sms_opted_out: false }).eq('phone', phone)
    return "You're back on. Text us when you got a load"
  }
  if (lower === 'help' || lower === '?') {
    return 'Text zip + material when you got a load\nReply DONE [loads] when finished\nReply CANCEL to cancel'
  }

  // Profile lookup using normalized phone
  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, status, sms_opted_out')
    .eq('phone', phone)
    .maybeSingle()

  // NEW DRIVER FLOW
  if (!profile) {
    const session = await getSession(phone)
    const state = session?.state || 'idle'

    if (state !== 'getting_name') {
      await setSession(phone, { state: 'getting_name' })
      return "Hey — what's your name"
    }

    const nameInput = trimmed.trim()
    if (nameInput.length < 2 || nameInput.length > 50) {
      return "What's your name"
    }

    const firstName = nameInput.split(' ')[0]
    const lastName = nameInput.split(' ').slice(1).join(' ') || 'Driver'

    const email = `sms_${phone}@dumpsite.io`
    let authUser: any = null
    try {
      const { data: authData } = await supabase.auth.admin.createUser({
        email,
        password: Math.random().toString(36).slice(-16) + 'Aa1!',
        email_confirm: true,
      })
      authUser = authData?.user
    } catch {}

    if (authUser) {
      try {
        await supabase.from('driver_profiles').insert({
          user_id: authUser.id,
          phone,
          first_name: firstName,
          last_name: lastName,
          tier_id: 'c51d1a6c-7572-4ca1-8424-e05786a0116b',
          truck_type: 'dump truck',
          phone_verified: true,
          status: 'active',
          trial_loads_used: 0,
          truck_count: 1,
          gps_score: 100,
        })
      } catch (e: any) {
        console.error('[profile insert]', e.message)
      }
    }

    await setSession(phone, { state: 'asking_zip' })
    return `${firstName} got you. What's the zip you hauling from`
  }

  if (profile.sms_opted_out) return ''
  if (profile.status !== 'active') {
    await supabase.from('driver_profiles').update({ status: 'active' }).eq('phone', phone)
  }

  const firstName = profile.first_name || ''

  // Check active load
  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, status, dispatch_order_id, dispatch_orders(driver_pay_cents, cities(name))')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .maybeSingle()

  // Check dispatch_jobs too
  const { data: activeJob } = await supabase
    .from('dispatch_jobs')
    .select('id, job_number, load_count, site_id')
    .eq('driver_id', profile.user_id)
    .eq('status', 'in_progress')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // DONE
  if (lower.startsWith('done') || lower.startsWith('complete') || lower.startsWith('finished')) {
    const loadMatch = trimmed.match(/(\d+)/)
    const loads = loadMatch ? Math.min(parseInt(loadMatch[1], 10), 50) : 1

    if (activeJob) {
      const dollars = loads * 45
      await supabase.from('dispatch_jobs').update({ status: 'completed', completed_at: new Date().toISOString(), load_count: loads, payment_amount: dollars, payment_status: 'pending' }).eq('id', activeJob.id)
      try {
        await supabase.from('driver_payments').insert({ driver_id: profile.user_id, job_id: activeJob.id, amount_dollars: dollars, status: 'pending' })
      } catch {}
      try { await sendAdminAlert(`${activeJob.job_number} complete — ${firstName} ${loads} loads $${dollars}`) } catch {}
      await clearSession(phone)
      return await doneReply(firstName, loads, dollars, activeJob.job_number)
    }

    if (activeLoad) {
      const payPerLoad = (activeLoad.dispatch_orders as any)?.driver_pay_cents || 3500
      const totalCents = payPerLoad * loads
      const totalDollars = Math.round(totalCents / 100)
      const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
      await supabase.from('load_requests').update({ status: 'completed', completed_at: new Date().toISOString(), payout_cents: totalCents, truck_count: loads }).eq('id', activeLoad.id)
      try {
        await supabase.from('driver_payments').insert({ driver_id: profile.user_id, load_request_id: activeLoad.id, amount_cents: totalCents, status: 'pending' })
      } catch {}
      try { await sendAdminAlert(`${jobNum} complete — ${firstName} ${loads} loads $${totalDollars}`) } catch {}
      await clearSession(phone)
      return await doneReply(firstName, loads, totalDollars, jobNum)
    }

    return 'No active job found'
  }

  // CANCEL
  if (lower === 'cancel' || lower === 'stop job') {
    await clearSession(phone)
    if (activeJob) {
      await supabase.from('dispatch_jobs').update({ status: 'cancelled' }).eq('id', activeJob.id)
      return `${activeJob.job_number} cancelled. Text us when you got another load`
    }
    if (activeLoad) {
      const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
      await supabase.from('load_requests').update({ status: 'rejected', rejected_reason: 'Cancelled by driver via SMS', reviewed_at: new Date().toISOString() }).eq('id', activeLoad.id)
      try { await sendAdminAlert(`${jobNum} cancelled — ${firstName}`) } catch {}
      return `${jobNum} cancelled. Text us when you got another load`
    }
    return 'No active job to cancel'
  }

  // STATUS
  if (lower === 'status' || lower === 'job') {
    if (activeJob) return `${activeJob.job_number} — in progress\nReply DONE [loads] when finished`
    if (activeLoad) {
      const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
      const city = (activeLoad.dispatch_orders as any)?.cities?.name || ''
      return `${jobNum} — ${city} — ${activeLoad.status}\nReply DONE [loads] when finished`
    }
    return 'No active jobs. Text your zip when you got a load ready'
  }

  // Already has active job
  if (activeJob || activeLoad) {
    const jobNum = activeJob ? activeJob.job_number : generateJobNumber(activeLoad!.dispatch_order_id)
    return `You got ${jobNum} active. Reply DONE [loads] when finished or CANCEL to cancel`
  }

  // STATE MACHINE
  const session = await getSession(phone)
  const currentState = session?.state || 'idle'
  const detectedZip = detectZip(trimmed)
  const detectedMaterial = detectMaterial(trimmed)
  const detectedYards = detectYards(trimmed)

  // Site selection
  if ((lower === '1' || lower === '2' || lower === '3') && currentState === 'sites_shown' && session?.sites_shown?.length) {
    const choice = parseInt(lower)
    const siteId = session.sites_shown[choice - 1]
    if (!siteId) return `Reply 1${session.sites_shown.length > 1 ? '-' + session.sites_shown.length : ''} to pick a site`
    const { data: site } = await supabase.from('dump_sites').select('*').eq('id', siteId).single()
    if (!site) return 'That site went offline. Text your zip for new options'
    const cap = (site.capacity_yards || 0) - (site.filled_yards || 0)
    if (cap <= 0) return 'That one just filled up. Text your zip for new options'
    const jobNumber = 'DS-' + Date.now().toString().slice(-6)
    try {
      await supabase.from('dispatch_jobs').insert({
        job_number: jobNumber, driver_id: profile.user_id, site_id: site.id,
        city_name: session.city_name, material_type: session.material_type,
        estimated_yards: session.estimated_yards, driver_phone: phone,
        status: 'in_progress', source: 'sms', updated_at: new Date().toISOString(),
      })
    } catch (e: any) {
      console.error('[job create]', e.message)
    }
    if (session.estimated_yards) {
      try {
        await supabase.rpc('reserve_site_capacity', { p_site_id: site.id, p_yards: session.estimated_yards })
      } catch {}
    }
    await clearSession(phone)
    const token = generateSiteToken({ siteId: site.id, jobId: siteId, driverPhone: phone, expiresInMinutes: 240 })
    const gate = site.gate_code ? `\nGate: ${site.gate_code}` : ''
    const hours = site.hours_text ? `\nHours: ${site.hours_text}` : ''
    return `${jobNumber} — locked in\n${APP_URL}/api/sites/reveal?t=${token}${gate}${hours}\nReply DONE [loads] when finished`
  }

  // State: asking_intent
  if (currentState === 'asking_intent') {
    if (isNo(lower)) { await clearSession(phone); return 'Ok np. Text us when you need a site' }
    if (detectedZip) {
      const { cityName } = await zipToCity(detectedZip)
      if (detectedMaterial) {
        await setSession(phone, { state: 'finding_sites', zip_code: detectedZip, city_name: cityName, material_type: detectedMaterial, estimated_yards: detectedYards })
        return await showSites(phone, cityName, detectedMaterial, detectedYards, profile.user_id)
      }
      await setSession(phone, { state: 'asking_material', zip_code: detectedZip, city_name: cityName, estimated_yards: detectedYards })
      return `${cityName} — what material? clean fill, clay, topsoil, mixed, caliche`
    }
    await setSession(phone, { state: 'asking_zip' })
    return "What's the zip you hauling from"
  }

  // State: asking_zip
  if (currentState === 'asking_zip') {
    if (detectedZip) {
      const { cityName } = await zipToCity(detectedZip)
      if (detectedMaterial) {
        await setSession(phone, { state: 'finding_sites', zip_code: detectedZip, city_name: cityName, material_type: detectedMaterial, estimated_yards: detectedYards })
        return await showSites(phone, cityName, detectedMaterial, detectedYards, profile.user_id)
      }
      await setSession(phone, { state: 'asking_material', zip_code: detectedZip, city_name: cityName, estimated_yards: detectedYards })
      return `${cityName} — what material? clean fill, clay, topsoil, mixed, caliche`
    }
    return "Need your 5-digit zip code"
  }

  // State: asking_material
  if (currentState === 'asking_material') {
    if (detectedMaterial) {
      const cityName = session?.city_name || 'Dallas'
      const yards = detectedYards || session?.estimated_yards || null
      await setSession(phone, { state: 'finding_sites', material_type: detectedMaterial, estimated_yards: yards })
      return await showSites(phone, cityName, detectedMaterial, yards, profile.user_id)
    }
    return 'What material? clean fill, clay, topsoil, mixed, or caliche'
  }

  // State: sites_shown
  if (currentState === 'sites_shown') {
    const count = session?.sites_shown?.length || 1
    return `Reply ${count === 1 ? '1' : '1-' + count} to claim a site`
  }

  // Fresh message
  if (detectedZip && detectedMaterial) {
    const { cityName } = await zipToCity(detectedZip)
    await setSession(phone, { state: 'finding_sites', zip_code: detectedZip, city_name: cityName, material_type: detectedMaterial, estimated_yards: detectedYards })
    return await showSites(phone, cityName, detectedMaterial, detectedYards, profile.user_id)
  }
  if (detectedZip) {
    const { cityName } = await zipToCity(detectedZip)
    await setSession(phone, { state: 'asking_material', zip_code: detectedZip, city_name: cityName, estimated_yards: detectedYards })
    return `${cityName} — what material? clean fill, clay, topsoil, mixed, caliche`
  }
  if (detectedMaterial) {
    await setSession(phone, { state: 'asking_zip', material_type: detectedMaterial, estimated_yards: detectedYards })
    return "What's the zip you hauling from"
  }
  if (isYes(lower)) {
    await setSession(phone, { state: 'asking_zip' })
    return "What's the zip you hauling from"
  }

  await setSession(phone, { state: 'asking_intent' })
  return 'Need a dump site?'
}

export interface DispatchStatus {
  dispatchId: string; jobNumber: string; status: string
  driversNotified: number; driversAccepted: number; cityName: string; createdAt: string
}

export async function getDispatchStatus(dispatchId: string): Promise<{ success: boolean; data?: DispatchStatus; error?: string }> {
  const supabase = createAdminSupabase()
  const { data: order, error } = await supabase.from('dispatch_orders').select('id, status, drivers_notified, city_id, created_at, cities(name)').eq('id', dispatchId).single()
  if (error || !order) return { success: false, error: 'Not found' }
  const { count } = await supabase.from('load_requests').select('id', { count: 'exact', head: true }).eq('dispatch_order_id', dispatchId).in('status', ['approved', 'completed'])
  return { success: true, data: { dispatchId: order.id, jobNumber: generateJobNumber(order.id), status: order.status, driversNotified: order.drivers_notified || 0, driversAccepted: count || 0, cityName: (order.cities as any)?.name || 'Unknown', createdAt: order.created_at } }
}

export async function redispatchOrder(dispatchId: string, adminUserId: string): Promise<{ success: boolean; driversNotified?: number; error?: string }> {
  const supabase = createAdminSupabase()
  const { data: order, error: orderErr } = await supabase.from('dispatch_orders').select('id, city_id, yards_needed, driver_pay_cents, status, drivers_notified, cities(name)').eq('id', dispatchId).single()
  if (orderErr || !order) return { success: false, error: 'Not found' }
  if (order.status === 'completed' || order.status === 'cancelled') return { success: false, error: `Cannot re-dispatch a ${order.status} order` }
  const { data: alreadyNotified } = await supabase.from('sms_log').select('to_phone').eq('related_id', dispatchId).eq('message_type', 'dispatch')
  const notifiedPhones = new Set((alreadyNotified || []).map((s: any) => s.to_phone))
  const { data: drivers } = await supabase.from('driver_profiles').select('user_id, phone, phone_verified, tiers(slug, dispatch_priority)').eq('city_id', order.city_id).eq('status', 'active').eq('phone_verified', true).limit(500)
  if (!drivers || drivers.length === 0) return { success: false, error: 'No active drivers' }
  const newDrivers = drivers.filter((d: any) => !notifiedPhones.has(d.phone))
  if (newDrivers.length === 0) return { success: false, error: 'All drivers already notified' }
  const { batchDispatchSMS } = await import('../sms')
  const haulDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const cityName = (order.cities as any)?.name || 'DFW'
  const payDollars = order.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 35
  const dispatchDrivers = newDrivers.map((d: any) => ({ phone: d.phone, tierSlug: (d.tiers as any)?.slug || 'trial', dispatchId: order.id, cityName, yardsNeeded: order.yards_needed, payDollars, haulDate }))
  const { sent, failed } = await batchDispatchSMS(dispatchDrivers)
  await supabase.from('dispatch_orders').update({ drivers_notified: ((order as any).drivers_notified || 0) + sent, status: 'dispatching' }).eq('id', dispatchId)
  await supabase.from('audit_logs').insert({ actor_id: adminUserId, action: 'dispatch_order.redispatched', entity_type: 'dispatch_order', entity_id: dispatchId, metadata: { new_drivers_notified: sent, failed, city: cityName } })
  try { await sendAdminAlert(`Re-dispatch ${generateJobNumber(dispatchId)}: ${sent} new drivers in ${cityName}`) } catch {}
  return { success: true, driversNotified: sent }
}

export async function cancelDispatch(dispatchId: string, adminUserId: string, reason: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminSupabase()
  const { data: order, error } = await supabase.from('dispatch_orders').update({ status: 'cancelled' }).eq('id', dispatchId).not('status', 'eq', 'completed').select('id, cities(name)').single()
  if (error || !order) return { success: false, error: 'Not found or already completed' }
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
