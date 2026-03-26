import { createAdminSupabase } from '../supabase'
import { sendAdminAlert } from '../sms'
import Anthropic from '@anthropic-ai/sdk'
import { generateSiteToken } from '@/lib/utils/site-token'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'

/**
 * SMS Dispatch Service — handles advanced dispatch workflows:
 * - Re-dispatch to additional drivers
 * - Dispatch status tracking
 * - Job number generation (DS- prefix)
 * - Inbound SMS handling (status, done, cancel, free-text requests)
 */

interface IncomingSMS {
  from: string
  body: string
  messageSid: string
}

export function generateJobNumber(dispatchId: string): string {
  // Use first 6 chars of UUID for human-readable job number
  const short = dispatchId.replace(/-/g, '').slice(0, 6).toUpperCase()
  return `DS-${short}`
}

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

  if (error || !order) {
    return { success: false, error: 'Dispatch order not found' }
  }

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
    .select('id, city_id, yards_needed, driver_pay_cents, status, cities(name)')
    .eq('id', dispatchId)
    .single()

  if (orderErr || !order) {
    return { success: false, error: 'Dispatch order not found' }
  }

  if (order.status === 'completed' || order.status === 'cancelled') {
    return { success: false, error: `Cannot re-dispatch a ${order.status} order` }
  }

  // Find drivers who were NOT already notified for this dispatch
  const { data: alreadyNotified } = await supabase
    .from('sms_log')
    .select('to_phone')
    .eq('related_id', dispatchId)
    .eq('message_type', 'dispatch')

  const notifiedPhones = new Set((alreadyNotified || []).map(s => s.to_phone))

  const { data: drivers } = await supabase
    .from('driver_profiles')
    .select('user_id, phone, phone_verified, tiers(slug, dispatch_priority)')
    .eq('city_id', order.city_id)
    .eq('status', 'active')
    .eq('phone_verified', true)
    .limit(500)

  if (!drivers || drivers.length === 0) {
    return { success: false, error: 'No active drivers in this city' }
  }

  const newDrivers = drivers.filter(d => !notifiedPhones.has(d.phone))
  if (newDrivers.length === 0) {
    return { success: false, error: 'All drivers in this city have already been notified' }
  }

  const { batchDispatchSMS } = await import('../sms')
  const haulDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const cityName = (order.cities as any)?.name || 'DFW'
  const payDollars = order.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 35

  const dispatchDrivers = newDrivers.map(d => ({
    phone: d.phone,
    tierSlug: (d.tiers as any)?.slug || 'trial',
    dispatchId: order.id,
    cityName,
    yardsNeeded: order.yards_needed,
    payDollars,
    haulDate,
  }))

  const { sent, failed } = await batchDispatchSMS(dispatchDrivers)

  // Update total notified count
  await supabase
    .from('dispatch_orders')
    .update({
      drivers_notified: (order as any).drivers_notified ? (order as any).drivers_notified + sent : sent,
      status: 'dispatching',
    })
    .eq('id', dispatchId)

  await supabase.from('audit_logs').insert({
    actor_id: adminUserId,
    action: 'dispatch_order.redispatched',
    entity_type: 'dispatch_order',
    entity_id: dispatchId,
    metadata: { new_drivers_notified: sent, failed, city: cityName },
  })

  try {
    await sendAdminAlert(`Re-dispatch ${generateJobNumber(dispatchId)}: ${sent} new drivers notified in ${cityName}`)
  } catch {}

  return { success: true, driversNotified: sent }
}

export async function cancelDispatch(dispatchId: string, adminUserId: string, reason: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminSupabase()

  const { data: order, error } = await supabase
    .from('dispatch_orders')
    .update({ status: 'cancelled' })
    .eq('id', dispatchId)
    .not('status', 'eq', 'completed')
    .select('id, cities(name)')
    .single()

  if (error || !order) {
    return { success: false, error: 'Order not found or already completed' }
  }

  await supabase.from('audit_logs').insert({
    actor_id: adminUserId,
    action: 'dispatch_order.cancelled',
    entity_type: 'dispatch_order',
    entity_id: dispatchId,
    metadata: { reason, city: (order.cities as any)?.name },
  })

  return { success: true }
}

async function humanReply(situation: string, driverName: string, context: Record<string, any> = {}): Promise<string> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const systemPrompt = [
      "You text exactly like Juan, a dirt broker in DFW/Colorado.",
      "Style: ultra short 1-2 sentences max, no punctuation at end, casual and direct.",
      "His actual messages: Yes sir | 10.4 | Ok np | Perfect | Morning | Send pic of dirt | Being sent rn | Give me hour max | 3 miles | Fs that | Yo | How many yards do you have | Whats address your coming from | Were you able to get 3",
      "Never sound like customer service. No emojis. Use first name occasionally not every time. Typos ok.",
      "Situation: " + situation,
      "Driver name: " + driverName,
      "Context: " + JSON.stringify(context)
    ].join(" ")
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Write only the SMS reply text, nothing else.' }]
    })
    const block = message.content[0]
    return (block.type === 'text' ? block.text : '').trim() || 'One sec'
  } catch (err: any) {
    console.error('[humanReply] FAILED:', err?.message || err)
    const fallbacks: Record<string, string> = {
      'active job': 'You got an active job already. Reply STATUS to check it',
      'no active jobs': 'No active jobs rn. Text city + material to get a site',
      'city': 'What city you in',
      'material': 'What material type',
      'completed': '10.4 got it. Payment coming',
      'cancelled': 'Ok cancelled',
      'waitlist': 'Nothing available rn, got you on the list',
      'no account': 'Sign up at dumpsite.io first'
    }
    const key = Object.keys(fallbacks).find(k => situation.toLowerCase().includes(k))
    return key ? fallbacks[key] : 'Give me a sec'
  }
}

async function handleStatusRequest(phone: string): Promise<string> {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile) {
    return 'No driver account found for this number. Sign up at dumpsite.io'
  }

  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, status, dispatch_order_id, yards_estimated, dispatch_orders(status, cities(name))')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .maybeSingle()

  if (!activeLoad) {
    return humanReply('Driver asked for job status, has no active jobs right now', profile.first_name || 'Driver')
  }

  const cityName = (activeLoad.dispatch_orders as any)?.cities?.name || 'DFW'
  const jobNumber = generateJobNumber(activeLoad.dispatch_order_id)

  if (activeLoad.status === 'pending') {
    return humanReply('Driver job is pending approval, let them know briefly', profile.first_name || '', { job: jobNumber, city: cityName })
  }

  return humanReply('Driver has active approved job, let them know', profile.first_name || '', { job: jobNumber, city: cityName, yards: activeLoad.yards_estimated || 0 })
}

async function handleDoneRequest(phone: string, body: string): Promise<string> {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile) {
    return 'No driver account found for this number. Sign up at dumpsite.io'
  }

  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, dispatch_order_id, yards_estimated, dispatch_orders(driver_pay_cents, cities(name))')
    .eq('driver_id', profile.user_id)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .maybeSingle()

  if (!activeLoad) {
    return 'No active approved job found. Visit dumpsite.io/dashboard to check your jobs.'
  }

  // Parse load count from message like "done 3" or "complete 5 loads"
  const loadMatch = body.match(/(\d+)/)
  const loadsDelivered = loadMatch ? Math.min(parseInt(loadMatch[1], 10), 50) : 1

  const payPerLoad = (activeLoad.dispatch_orders as any)?.driver_pay_cents || 3500
  const totalPayCents = payPerLoad * loadsDelivered
  const totalPayDollars = Math.round(totalPayCents / 100)
  const jobNumber = generateJobNumber(activeLoad.dispatch_order_id)
  const cityName = (activeLoad.dispatch_orders as any)?.cities?.name || 'DFW'

  // Mark load as completed
  await supabase
    .from('load_requests')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      payout_cents: totalPayCents,
      truck_count: loadsDelivered,
    })
    .eq('id', activeLoad.id)

  // Create payment record
  await supabase.from('driver_payments').insert({
    driver_id: profile.user_id,
    load_request_id: activeLoad.id,
    amount_cents: totalPayCents,
    status: 'pending',
  })

  try {
    await sendAdminAlert(
      `Job ${jobNumber} completed via SMS by ${profile.first_name || 'driver'} in ${cityName}. ${loadsDelivered} load(s), $${totalPayDollars} payout pending.`
    )
  } catch {}

  return humanReply('Driver just completed their job, acknowledge loads and say payment is coming, be brief like a real person', profile.first_name || '', { loads: loadsDelivered, pay: '$' + totalPayDollars, job: jobNumber })
}

async function handleCancelRequest(phone: string): Promise<string> {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile) {
    return 'No driver account found for this number. Sign up at dumpsite.io'
  }

  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, dispatch_order_id, status, dispatch_orders(cities(name))')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .maybeSingle()

  if (!activeLoad) {
    return 'No active job to cancel. Visit dumpsite.io/dashboard to view your jobs.'
  }

  const jobNumber = generateJobNumber(activeLoad.dispatch_order_id)
  const cityName = (activeLoad.dispatch_orders as any)?.cities?.name || 'DFW'

  await supabase
    .from('load_requests')
    .update({
      status: 'rejected',
      rejected_reason: 'Cancelled by driver via SMS',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', activeLoad.id)

  try {
    await sendAdminAlert(
      `Job ${jobNumber} cancelled via SMS by ${profile.first_name || 'driver'} in ${cityName}.`
    )
  } catch {}

  return humanReply('Driver cancelled their job', profile.first_name || '', { job: jobNumber, city: cityName })
}

async function parseIncomingText(body: string): Promise<{ cityName: string | null, materialType: string | null, estimatedYards: number | null }> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const systemPrompt = [
      "Parse a dirt hauling SMS. Return ONLY valid JSON, no markdown, no explanation.",
      "DFW cities: dallas, fort worth, frisco, mckinney, allen, plano, arlington, irving, garland, denton, lewisville, flower mound, mansfield, grand prairie, hutchins, carrollton, mesquite, rowlett, cedar hill, desoto, duncanville, coppell, grapevine, keller, southlake",
      "Colorado cities: denver, colorado springs, aurora, lakewood, arvada, westminster, centennial, parker, longmont, boulder, golden, monument, hudson, thornton, englewood, pueblo, castle rock",
      'Return exactly: {"cityName":"matched city or null","materialType":"clean fill|clay|sandy loam|caliche|topsoil|mixed|concrete|rock or null","estimatedYards":number or null}',
      "Rules: fill dirt or dirt alone = clean fill. tons x 0.7 = yards. City not in list = null. I need a dumpsite in Dallas = cityName dallas, materialType null."
    ].join(" ")
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: systemPrompt,
      messages: [{ role: 'user', content: body }]
    })
    const block = message.content[0]
    const raw = block.type === 'text' ? block.text : '{}'
    return JSON.parse(raw.replace(/```json|```/g, '').trim())
  } catch {
    return { cityName: null, materialType: null, estimatedYards: null }
  }
}

async function handleSiteSelection(phone: string, choice: number, body: string): Promise<string> {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile) return 'Sign up at dumpsite.io first'

  // Get the last sites shown to this driver
  const { data: lastLog } = await supabase
    .from('sms_logs')
    .select('body')
    .eq('phone', phone)
    .like('body', 'SITES_SHOWN:%')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!lastLog) return await humanReply('Driver replied with a number but no recent sites were shown to them', profile.first_name || '', {})

  const siteIds = lastLog.body.replace('SITES_SHOWN:', '').split(',')
  const selectedSiteId = siteIds[choice - 1]

  if (!selectedSiteId) return 'Invalid choice. Reply 1, 2, or 3'

  const { data: site } = await supabase
    .from('dump_sites')
    .select('*')
    .eq('id', selectedSiteId)
    .single()

  if (!site) return 'Site no longer available. Text your city + material for new options'

  // Check capacity still available
  const cap = (site.capacity_yards || 0) - (site.filled_yards || 0)
  if (cap <= 0) return 'That site just filled up. Text your city + material for new options'

  // Create job
  const jobNumber = 'DS-' + Date.now().toString().slice(-6)
  let job: any = null
  try {
    const result = await supabase
      .from('dispatch_jobs')
      .insert({
        job_number: jobNumber,
        driver_id: profile.user_id,
        site_id: site.id,
        city_name: site.city_id,
        material_type: 'clean fill',
        driver_phone: phone,
        status: 'in_progress',
        source: 'sms',
        updated_at: new Date().toISOString()
      })
      .select()
      .single()
    job = result.data
  } catch {}

  const token = generateSiteToken({
    siteId: site.id,
    jobId: job?.id || site.id,
    driverPhone: phone,
    expiresInMinutes: 240
  })
  const siteLink = APP_URL + '/api/sites/reveal?t=' + token
  const gate = site.gate_code ? '\nGate: ' + site.gate_code : ''
  const hours = site.hours_text ? '\nHours: ' + site.hours_text : ''

  return jobNumber + ' — site ' + choice + ' confirmed\n' + siteLink + gate + hours + '\nReply DONE [loads] when finished'
}

async function handleFreeTextRequest(phone: string, body: string): Promise<string> {
  const supabase = createAdminSupabase()

  const { data: profile } = await supabase
    .from('driver_profiles')
    .select('user_id, first_name, city_id, cities(name)')
    .eq('phone', phone)
    .maybeSingle()

  if (!profile) {
    return 'No account found for this number. Sign up at dumpsite.io'
  }

  // Check for existing active job
  const { data: existingLoad } = await supabase
    .from('load_requests')
    .select('id')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .maybeSingle()

  if (existingLoad) {
    return await humanReply('Driver already has active job and is texting again', profile.first_name || '', {})
  }

  // Parse the incoming message with AI
  const parsed = await parseIncomingText(body)

  // Determine city to search
  const searchCity = parsed.cityName || (profile.cities as any)?.name || null

  if (!searchCity) {
    return 'What city you in? (DFW or Colorado)'
  }

  if (!parsed.materialType) {
    return searchCity + ' — what material? clean fill, clay, topsoil, mixed, or caliche'
  }

  // Find best available dump site directly
  const { data: cityRow } = await supabase
    .from('cities')
    .select('id')
    .ilike('name', '%' + searchCity + '%')
    .maybeSingle()

  let siteQuery = supabase
    .from('dump_sites')
    .select('id, capacity_yards, filled_yards, accepted_materials, gate_code, hours_text, access_instructions, operator_name, city_id')
    .eq('is_active', true)

  if (cityRow?.id) {
    siteQuery = siteQuery.eq('city_id', cityRow.id)
  }

  const { data: sites } = await siteQuery

  if (!sites || sites.length === 0) {
    // Add to waitlist
    try {
      await supabase.from('dispatch_waitlist').insert({
        driver_id: profile.user_id,
        city_id: cityRow?.id || null,
        city_name: searchCity,
        material_type: parsed.materialType,
        estimated_yards: parsed.estimatedYards,
        notified: false
      })
    } catch {}

    return await humanReply('No dump sites available right now in that city for that material. Driver added to waitlist and will be texted when a site opens.', profile.first_name || '', { city: searchCity, material: parsed.materialType })
  }

  // Filter by capacity and material
  const yardsNeeded = parsed.estimatedYards || 1
  const mt = parsed.materialType.toLowerCase()
  const available = sites.filter(s => {
    const cap = (s.capacity_yards || 0) - (s.filled_yards || 0)
    if (cap < yardsNeeded) return false
    const accepted: string[] = s.accepted_materials || ['clean fill']
    return accepted.some((m: string) => m.toLowerCase() === 'all' || m.toLowerCase().includes(mt) || mt.includes(m.toLowerCase()))
  })

  if (available.length === 0) {
    try {
      await supabase.from('dispatch_waitlist').insert({
        driver_id: profile.user_id,
        city_id: cityRow?.id || null,
        city_name: searchCity,
        material_type: parsed.materialType,
        estimated_yards: parsed.estimatedYards,
        notified: false
      })
    } catch {}

    return await humanReply('No sites with capacity available right now for that material. Driver added to waitlist.', profile.first_name || '', { city: searchCity })
  }

  const site = available.sort((a, b) =>
    ((b.capacity_yards || 0) - (b.filled_yards || 0)) -
    ((a.capacity_yards || 0) - (a.filled_yards || 0))
  )[0]

  // Create a dispatch job record
  const jobNumber = 'DS-' + Date.now().toString().slice(-6)
  // Sort by most available capacity
  const sorted = available.sort((a, b) =>
    ((b.capacity_yards || 0) - (b.filled_yards || 0)) -
    ((a.capacity_yards || 0) - (a.filled_yards || 0))
  )

  // Show up to 3 sites
  const topSites = sorted.slice(0, 3)
  const yardsText = parsed.estimatedYards ? parsed.estimatedYards + ' yds ' : ''

  // Build multi-site response
  const lines: string[] = []
  lines.push(searchCity + ' — ' + parsed.materialType + (yardsText ? ' (' + yardsText + ')' : ''))
  lines.push('')

  for (let i = 0; i < topSites.length; i++) {
    const s = topSites[i]
    const cap = (s.capacity_yards || 0) - (s.filled_yards || 0)
    const token = generateSiteToken({
      siteId: s.id,
      jobId: s.id,
      driverPhone: phone,
      expiresInMinutes: 240
    })
    const link = APP_URL + '/api/sites/reveal?t=' + token
    lines.push('Site ' + (i + 1) + ' — ' + cap + ' yds available')
    lines.push(link)
    if (i < topSites.length - 1) lines.push('')
  }

  lines.push('')
  lines.push('Reply 1, 2, or 3 to claim a site')

  // Log sites shown to driver for follow-up
  try {
    await supabase.from('sms_logs').insert({
      phone: phone,
      body: 'SITES_SHOWN: ' + topSites.map(s => s.id).join(','),
      direction: 'outbound',
      message_sid: 'system-' + Date.now()
    })
  } catch {}

  return lines.join('\n')
}

async function handleIncoming(sms: IncomingSMS): Promise<string> {
  const bodyLower = sms.body.toLowerCase().trim()

  if (bodyLower === 'status' || bodyLower === 'job') {
    return handleStatusRequest(sms.from)
  }

  if (
    bodyLower.startsWith('done') ||
    bodyLower.startsWith('complete') ||
    bodyLower.startsWith('finished')
  ) {
    return handleDoneRequest(sms.from, sms.body)
  }

  if (bodyLower === 'cancel' || bodyLower === 'stop job') {
    return handleCancelRequest(sms.from)
  }

  // Handle site selection reply (1, 2, or 3)
  if (bodyLower === '1' || bodyLower === '2' || bodyLower === '3') {
    return handleSiteSelection(sms.from, parseInt(bodyLower), sms.body)
  }

  // Free-text — try to match to available jobs
  return handleFreeTextRequest(sms.from, sms.body)
}

export const smsDispatchService = {
  handleIncoming,
  generateJobNumber,
  getDispatchStatus,
  redispatchOrder,
  cancelDispatch,
}
