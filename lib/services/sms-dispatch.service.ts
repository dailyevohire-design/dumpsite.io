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

// ─── Job number ───────────────────────────────────────────────────────
export function generateJobNumber(dispatchId: string): string {
  const short = dispatchId.replace(/-/g, '').slice(0, 6).toUpperCase()
  return `DS-${short}`
}

// ─── Human-like reply via Claude Haiku ───────────────────────────────
async function humanReply(
  situation: string,
  driverName: string,
  context: Record<string, any> = {}
): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const system = [
      'You text exactly like Juan, a dirt broker in DFW/Colorado.',
      'Style: ultra short, 1-2 sentences max, no period at end, casual.',
      'Real examples of his texts: Yes sir | 10.4 | Ok np | Perfect | Morning | Send pic of dirt | Being sent rn | Give me hour max | 3 miles | Fs that | Yo | How many yards | Sounds good | Got you',
      'NEVER sound like customer service. NEVER use emojis. NEVER say "I". Use first name occasionally not every message. Typos ok.',
      'Situation: ' + situation,
      'Driver name: ' + driverName,
      'Context: ' + JSON.stringify(context)
    ].join(' ')
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      system,
      messages: [{ role: 'user', content: 'Write only the SMS text. Nothing else.' }]
    })
    const block = msg.content[0]
    return (block.type === 'text' ? block.text : '').trim()
  } catch (err: any) {
    console.error('[humanReply] error:', err?.message)
    return 'One sec'
  }
}

// ─── AI text parser ───────────────────────────────────────────────────
async function parseText(body: string): Promise<{
  intent: 'need_site' | 'have_dirt' | 'unknown'
  zip: string | null
  material: string | null
  yards: number | null
}> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const system = [
      'Parse a dirt hauling SMS. Return ONLY valid JSON.',
      'Detect:',
      '  intent: need_site (driver has dirt and needs somewhere to dump it), have_dirt (someone has free dirt to give away), unknown',
      '  zip: 5-digit US zip code if mentioned, else null',
      '  material: clean fill|clay|sandy loam|caliche|topsoil|mixed|concrete|rock — if "dirt" or "fill dirt" = clean fill, else null',
      '  yards: number if mentioned, tons x 0.7 = yards, else null',
      'Return: {"intent":"need_site|have_dirt|unknown","zip":string or null,"material":string or null,"yards":number or null}',
      'Examples:',
      '  "I need a dumpsite" -> need_site',
      '  "got a load ready" -> need_site',
      '  "75201" -> zip=75201',
      '  "clean fill" -> material=clean fill',
      '  "100 yards" -> yards=100',
    ].join(' ')
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      system,
      messages: [{ role: 'user', content: body }]
    })
    const block = msg.content[0]
    const raw = block.type === 'text' ? block.text : '{}'
    return JSON.parse(raw.replace(/```json|```/g, '').trim())
  } catch {
    return { intent: 'unknown', zip: null, material: null, yards: null }
  }
}

// ─── Zip code to city lookup ──────────────────────────────────────────
async function zipToCity(zip: string): Promise<{ cityId: string | null, cityName: string }> {
  const supabase = createAdminSupabase()
  const zipPrefixMap: Record<string, string[]> = {
    'dallas': ['750','751','752'],
    'fort worth': ['760','761'],
    'arlington': ['760'],
    'plano': ['750'],
    'frisco': ['750'],
    'mckinney': ['750'],
    'garland': ['750'],
    'irving': ['750'],
    'denton': ['762'],
    'carrollton': ['750'],
    'lewisville': ['750'],
    'grand prairie': ['750'],
    'mansfield': ['760'],
    'denver': ['802'],
    'colorado springs': ['808','809'],
    'aurora': ['800','801'],
    'lakewood': ['802'],
    'arvada': ['800'],
    'boulder': ['803'],
    'thornton': ['802'],
    'westminster': ['800'],
  }
  
  const prefix3 = zip.slice(0, 3)
  let matchedCity = 'Dallas'
  
  for (const [city, prefixes] of Object.entries(zipPrefixMap)) {
    if (prefixes.includes(prefix3)) {
      matchedCity = city.charAt(0).toUpperCase() + city.slice(1)
      break
    }
  }

  const { data: city } = await supabase
    .from('cities')
    .select('id, name')
    .ilike('name', '%' + matchedCity + '%')
    .maybeSingle()

  return { cityId: city?.id || null, cityName: city?.name || matchedCity }
}

// ─── Session management ───────────────────────────────────────────────
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
      phone,
      state: 'idle',
      zip_code: null,
      city_name: null,
      material_type: null,
      estimated_yards: null,
      sites_shown: null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'phone' })
}

// ─── Site finder ──────────────────────────────────────────────────────
async function findSites(cityId: string | null, cityName: string, material: string, yards: number | null) {
  const supabase = createAdminSupabase()

  let query = supabase
    .from('dump_sites')
    .select('id, capacity_yards, filled_yards, accepted_materials, gate_code, hours_text, access_instructions, operator_name, city_id')
    .eq('is_active', true)

  if (cityId) query = query.eq('city_id', cityId)

  const { data: sites } = await query

  if (!sites || sites.length === 0) return []

  const yardsNeeded = yards || 1
  const mt = material.toLowerCase()

  return sites.filter(s => {
    const cap = (s.capacity_yards || 0) - (s.filled_yards || 0)
    if (cap < yardsNeeded) return false
    const accepted: string[] = s.accepted_materials || ['clean fill']
    return accepted.some((m: string) =>
      m.toLowerCase() === 'all' ||
      m.toLowerCase().includes(mt) ||
      mt.includes(m.toLowerCase())
    )
  }).sort((a, b) =>
    ((b.capacity_yards || 0) - (b.filled_yards || 0)) -
    ((a.capacity_yards || 0) - (a.filled_yards || 0))
  ).slice(0, 3)
}

// ─── Main conversation handler ────────────────────────────────────────
async function handleConversation(sms: IncomingSMS): Promise<string> {
  const supabase = createAdminSupabase()
  const { from, body, messageSid } = sms
  const bodyLower = body.trim().toLowerCase()

  // Log inbound
  try {
    await supabase.from('sms_logs').insert({
      phone: from, body, message_sid: messageSid, direction: 'inbound'
    })
  } catch {}

  // Get driver profile
  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, status')
    .eq('phone', from)
    .maybeSingle()

  if (!profile) {
    return 'Sign up at dumpsite.io to get access to dump sites'
  }

  if (profile.status !== 'active') {
    return 'Your account isn\'t active yet, hit us up at dumpsite.io'
  }

  const firstName = profile.first_name || ''

  // ── Hard commands always work regardless of state ──
  if (bodyLower === 'stop' || bodyLower === 'unsubscribe') {
    await supabase.from('driver_profiles').update({ sms_opted_out: true }).eq('phone', from)
    return ''
  }

  if (bodyLower === 'start' || bodyLower === 'subscribe') {
    await supabase.from('driver_profiles').update({ sms_opted_out: false }).eq('phone', from)
    return 'You\'re back on. Text us when you got a load ready'
  }

  // Check opt-out
  const { data: driverCheck } = await supabase
    .from('driver_profiles')
    .select('sms_opted_out')
    .eq('phone', from)
    .maybeSingle()
  if (driverCheck?.sms_opted_out) return ''

  if (bodyLower === 'help' || bodyLower === '?') {
    return 'Text your zip code + material when you got a load. Reply DONE [loads] when finished. Reply CANCEL to cancel. dumpsite.io/dashboard'
  }

  // ── Check for active load ──
  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, status, dispatch_order_id, dispatch_orders(cities(name))')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .maybeSingle()

  // DONE
  if (bodyLower.startsWith('done') || bodyLower.startsWith('complete') || bodyLower.startsWith('finished')) {
    return handleDone(from, body, profile, activeLoad)
  }

  // CANCEL  
  if (bodyLower === 'cancel' || bodyLower === 'stop job') {
    return handleCancel(from, profile, activeLoad)
  }

  // STATUS
  if (bodyLower === 'status' || bodyLower === 'job') {
    return handleStatus(from, profile, activeLoad)
  }

  // Already has active load
  if (activeLoad) {
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    return await humanReply(
      'Driver already has an active job and texted something random',
      firstName,
      { job: jobNum }
    )
  }

  // ── Get or create session ──
  let session = await getSession(from)

  // Parse what they sent
  const parsed = await parseText(body)

  // ── Site selection: driver replied 1, 2, or 3 ──
  if ((bodyLower === '1' || bodyLower === '2' || bodyLower === '3') && session?.state === 'sites_shown' && session?.sites_shown?.length) {
    return handleSiteSelection(from, parseInt(bodyLower), session, profile)
  }

  // ── Merge parsed data into session ──
  const updates: Record<string, any> = {}

  if (parsed.zip) updates.zip_code = parsed.zip
  if (parsed.material) updates.material_type = parsed.material
  if (parsed.yards) updates.estimated_yards = parsed.yards

  // Merge with existing session data
  const zip = updates.zip_code || session?.zip_code || null
  const material = updates.material_type || session?.material_type || null
  const yards = updates.estimated_yards || session?.estimated_yards || null

  // ── State machine ──

  // Step 1: No intent detected and nothing useful — ask if they need a site
  if (parsed.intent === 'unknown' && !zip && !material && !session?.zip_code) {
    await setSession(from, { ...updates, state: 'asking_intent' })
    return await humanReply(
      'Driver texted something vague, not clear if they need a dump site. Ask in a natural way.',
      firstName,
      { theyTexted: body }
    )
  }

  // Step 2: We know they need a site but no zip yet
  if (!zip) {
    await setSession(from, { ...updates, state: 'asking_zip' })
    return 'What\'s the zip code you\'re hauling from'
  }

  // Step 3: Have zip but no material
  if (!material) {
    await setSession(from, { ...updates, state: 'asking_material', zip_code: zip })
    const { cityName } = await zipToCity(zip)
    return cityName + ' — what material? clean fill, clay, topsoil, mixed, or caliche'
  }

  // Step 4: Have zip + material — find sites
  await setSession(from, { ...updates, state: 'finding_sites', zip_code: zip, material_type: material })

  const { cityId, cityName } = await zipToCity(zip)
  const sites = await findSites(cityId, cityName, material, yards)

  if (sites.length === 0) {
    try {
      await supabase.from('dispatch_waitlist').insert({
        driver_id: profile.user_id,
        city_id: cityId,
        city_name: cityName,
        material_type: material,
        estimated_yards: yards,
        notified: false
      })
    } catch {}
    await clearSession(from)
    return await humanReply(
      'No dump sites available right now for that material in that area. Driver added to waitlist.',
      firstName,
      { city: cityName, material }
    )
  }

  // Build multi-site response
  const yardsText = yards ? ' (' + yards + ' yds)' : ''
  const lines: string[] = [cityName + ' — ' + material + yardsText, '']

  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]
    const cap = (s.capacity_yards || 0) - (s.filled_yards || 0)
    const token = generateSiteToken({
      siteId: s.id,
      jobId: s.id,
      driverPhone: from,
      expiresInMinutes: 240
    })
    lines.push('Site ' + (i + 1) + ' — ' + cap + ' yds')
    lines.push(APP_URL + '/api/sites/reveal?t=' + token)
    if (i < sites.length - 1) lines.push('')
  }

  lines.push('')
  lines.push('Reply ' + (sites.length === 1 ? '1' : '1-' + sites.length) + ' to claim')

  // Save sites to session
  await setSession(from, {
    ...updates,
    state: 'sites_shown',
    zip_code: zip,
    material_type: material,
    city_name: cityName,
    sites_shown: sites.map(s => s.id)
  })

  return lines.join('\n')
}

// ─── Site selection handler ───────────────────────────────────────────
async function handleSiteSelection(
  phone: string,
  choice: number,
  session: any,
  profile: any
): Promise<string> {
  const supabase = createAdminSupabase()
  const siteId = session.sites_shown[choice - 1]

  if (!siteId) return 'Reply 1, 2, or 3 to pick a site'

  const { data: site } = await supabase
    .from('dump_sites')
    .select('*')
    .eq('id', siteId)
    .single()

  if (!site) return 'That site isn\'t available. Text your zip again for new options'

  const cap = (site.capacity_yards || 0) - (site.filled_yards || 0)
  if (cap <= 0) return 'That one just filled up. Text your zip again'

  const jobNumber = 'DS-' + Date.now().toString().slice(-6)
  try {
    await supabase.from('dispatch_jobs').insert({
      job_number: jobNumber,
      driver_id: profile.user_id,
      site_id: site.id,
      city_name: session.city_name,
      material_type: session.material_type,
      estimated_yards: session.estimated_yards,
      driver_phone: phone,
      status: 'in_progress',
      source: 'sms',
      updated_at: new Date().toISOString()
    })
  } catch {}

  if (session.estimated_yards) {
    try {
      await supabase.rpc('reserve_site_capacity', {
        p_site_id: site.id,
        p_yards: session.estimated_yards
      })
    } catch {}
  }

  await clearSession(phone)

  const token = generateSiteToken({
    siteId: site.id,
    jobId: siteId,
    driverPhone: phone,
    expiresInMinutes: 240
  })
  const gate = site.gate_code ? '\nGate: ' + site.gate_code : ''
  const hours = site.hours_text ? '\nHours: ' + site.hours_text : ''

  return jobNumber + ' — locked in\n' + APP_URL + '/api/sites/reveal?t=' + token + gate + hours + '\nReply DONE [loads] when finished'
}

// ─── Done handler ─────────────────────────────────────────────────────
async function handleDone(phone: string, body: string, profile: any, activeLoad: any): Promise<string> {
  if (!activeLoad) {
    return await humanReply('Driver said done but no active job found', profile.first_name || '', {})
  }
  const supabase = createAdminSupabase()
  const loadMatch = body.match(/(\d+)/)
  const loads = loadMatch ? Math.min(parseInt(loadMatch[1], 10), 50) : 1
  const payPerLoad = (activeLoad.dispatch_orders as any)?.driver_pay_cents || 3500
  const totalCents = payPerLoad * loads
  const totalDollars = Math.round(totalCents / 100)
  const jobNum = generateJobNumber(activeLoad.dispatch_order_id)

  await supabase.from('load_requests').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    payout_cents: totalCents,
    truck_count: loads
  }).eq('id', activeLoad.id)

  try {
    await supabase.from('driver_payments').insert({
      driver_id: profile.user_id,
      load_request_id: activeLoad.id,
      amount_cents: totalCents,
      status: 'pending'
    })
  } catch {}

  try { await sendAdminAlert(jobNum + ' complete — ' + profile.first_name + ' ' + loads + ' loads $' + totalDollars) } catch {}

  await clearSession(phone)

  return await humanReply(
    'Driver just completed job and reported loads. Acknowledge briefly, tell them payment is coming.',
    profile.first_name || '',
    { loads, pay: '$' + totalDollars, job: jobNum }
  )
}

// ─── Cancel handler ───────────────────────────────────────────────────
async function handleCancel(phone: string, profile: any, activeLoad: any): Promise<string> {
  await clearSession(phone)
  if (!activeLoad) {
    return await humanReply('Driver said cancel but no active job', profile.first_name || '', {})
  }
  const supabase = createAdminSupabase()
  const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
  await supabase.from('load_requests').update({
    status: 'rejected',
    rejected_reason: 'Cancelled by driver via SMS',
    reviewed_at: new Date().toISOString()
  }).eq('id', activeLoad.id)
  try { await sendAdminAlert(jobNum + ' cancelled via SMS — ' + profile.first_name) } catch {}
  return await humanReply('Driver cancelled their job', profile.first_name || '', { job: jobNum })
}

// ─── Status handler ───────────────────────────────────────────────────
async function handleStatus(phone: string, profile: any, activeLoad: any): Promise<string> {
  if (!activeLoad) {
    return 'No active jobs. Text your zip when you got a load ready'
  }
  const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
  const city = (activeLoad.dispatch_orders as any)?.cities?.name || ''
  return jobNum + ' — ' + city + ' — ' + activeLoad.status + '\nReply DONE [loads] when finished'
}

// ─── Exports ──────────────────────────────────────────────────────────
export async function getDispatchStatus(dispatchId: string) {
  const supabase = createAdminSupabase()
  const { data: order, error } = await supabase
    .from('dispatch_orders')
    .select('id, status, drivers_notified, city_id, created_at, cities(name)')
    .eq('id', dispatchId)
    .single()
  if (error || !order) return { success: false, error: 'Not found' }
  const { count } = await supabase
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
      driversAccepted: count || 0,
      cityName: (order.cities as any)?.name || 'Unknown',
      createdAt: order.created_at,
    }
  }
}

export async function redispatchOrder(dispatchId: string, adminUserId: string) {
  const supabase = createAdminSupabase()
  const { data: order, error: orderErr } = await supabase
    .from('dispatch_orders')
    .select('id, city_id, yards_needed, driver_pay_cents, status, cities(name)')
    .eq('id', dispatchId)
    .single()
  if (orderErr || !order) return { success: false, error: 'Not found' }
  if (order.status === 'completed' || order.status === 'cancelled') return { success: false, error: 'Cannot re-dispatch a ' + order.status + ' order' }
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
  try { await sendAdminAlert('Re-dispatch ' + generateJobNumber(dispatchId) + ': ' + sent + ' new drivers in ' + cityName) } catch {}
  return { success: true, driversNotified: sent }
}

export async function cancelDispatch(dispatchId: string, adminUserId: string, reason: string) {
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
