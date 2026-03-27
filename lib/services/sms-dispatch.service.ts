import { createAdminSupabase } from '../supabase'
import { sendAdminAlert } from '../sms'
import Anthropic from '@anthropic-ai/sdk'

interface IncomingSMS { from: string; body: string; messageSid: string }

export function generateJobNumber(id: string): string {
  return `DS-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`
}

function normalizePhone(phone: string): string {
  return phone.replace(/^\+1/, '').replace(/\D/g, '')
}

async function doneReply(name: string, loads: number, dollars: number, job: string): Promise<string> {
  try {
    const a = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const m = await a.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 50,
      system: 'Text like Juan, a chill dirt broker. 1 sentence, no period, casual. Examples: "10.4 got you" | "Perfect" | "Ok np". Acknowledge loads and payment coming. Under 10 words.',
      messages: [{ role: 'user', content: `${name} completed ${loads} loads. Payout $${dollars}. Job ${job}.` }]
    })
    const b = m.content[0]
    return (b.type === 'text' ? b.text : '').trim()
  } catch { return `10.4 — ${loads} load${loads > 1 ? 's' : ''}. $${dollars} otw` }
}

async function getSession(phone: string) {
  const { data } = await createAdminSupabase().rpc('get_sms_session', { p_phone: phone })
  return data?.[0] || null
}

async function setSession(phone: string, u: Record<string, any>) {
  await createAdminSupabase().rpc('upsert_sms_session', {
    p_phone: phone, p_state: u.state || 'idle',
    p_zip: u.zip_code || null, p_city: u.city_name || null,
    p_material: u.material_type || null, p_yards: u.estimated_yards || null,
    p_sites: u.sites_shown || null,
  })
}

async function clearSession(phone: string) {
  await createAdminSupabase().rpc('clear_sms_session', { p_phone: phone })
}

async function getProfile(phone: string) {
  const { data } = await createAdminSupabase().rpc('get_sms_driver', { p_phone: phone })
  return data?.[0] || null
}

function isYes(t: string): boolean {
  const s = t.toLowerCase().trim()
  return ['yes','yeah','yep','yup','yea','sure','ok','okay','correct',
    '10-4','10.4','104','fs','for sure','jobs','work','ready',
    'got a load','have dirt','need site','haul'].some(w => s === w || s.includes(w))
}

function isNo(t: string): boolean {
  return ['no','nope','nah','not yet','nevermind'].some(w => t.toLowerCase().trim() === w)
}

async function getOpenJobs(cityId: string | null) {
  const supabase = createAdminSupabase()
  const { data, error } = await supabase
    .from('dispatch_orders')
    .select('id, client_name, city_id, yards_needed, driver_pay_cents, truck_type_needed, status, cities(name)')
    .in('status', ['dispatching', 'active', 'pending'])
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) console.error('[getOpenJobs]', error.message)
  if (!data || data.length === 0) return []
  if (cityId) {
    const same = data.filter(o => o.city_id === cityId)
    const other = data.filter(o => o.city_id !== cityId)
    return [...same, ...other].slice(0, 3)
  }
  return data.slice(0, 3)
}

async function buildJobsMessage(phone: string, orders: any[]): Promise<string> {
  const lines: string[] = ['Open jobs:', '']
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i]
    const city = (o.cities as any)?.name || 'DFW'
    const pay = Math.round((o.driver_pay_cents || 4500) / 100)
    const truck = (o.truck_type_needed || 'dump truck').replace(/_/g, ' ')
    lines.push(`${i + 1}. ${city} — ${o.yards_needed} yds`)
    lines.push(`   $${pay}/load — ${truck}`)
    if (i < orders.length - 1) lines.push('')
  }
  lines.push('')
  lines.push(`Reply ${orders.length === 1 ? '1' : '1-' + orders.length} to claim`)
  await setSession(phone, { state: 'jobs_shown', sites_shown: orders.map(o => o.id) })
  return lines.join('\n')
}

async function handleConversation(sms: IncomingSMS): Promise<string> {
  const supabase = createAdminSupabase()
  const { from, body, messageSid } = sms
  const trimmed = body.trim()
  const lower = trimmed.toLowerCase()
  const phone = normalizePhone(from)

  try { await supabase.from('sms_logs').insert({ phone, body: trimmed, message_sid: messageSid, direction: 'inbound' }) } catch {}

  if (lower === 'stop' || lower === 'unsubscribe') {
    await supabase.from('driver_profiles').update({ sms_opted_out: true }).eq('phone', phone)
    return ''
  }
  if (lower === 'start') {
    await supabase.from('driver_profiles').update({ sms_opted_out: false }).eq('phone', phone)
    return "You're back on. Text YES to see open jobs"
  }
  if (lower === 'help') {
    return 'Text YES to see open jobs\nReply DONE [loads] when finished\nReply CANCEL to cancel\nReply STATUS to check your job'
  }

  const profile = await getProfile(phone)

  if (!profile) {
    const session = await getSession(phone)
    const state = session?.state || 'idle'
    if (state !== 'getting_name') {
      await setSession(phone, { state: 'getting_name' })
      return "Hey — what's your name"
    }
    if (trimmed.length < 2 || trimmed.length > 50) return "What's your name"
    const firstName = trimmed.split(' ')[0]
    const lastName = trimmed.split(' ').slice(1).join(' ') || 'Driver'
    const { error: rpcErr } = await supabase.rpc('create_sms_driver', { p_phone: phone, p_first_name: firstName, p_last_name: lastName })
    if (rpcErr) console.error('[create_sms_driver]', rpcErr.message)
    await clearSession(phone)
    const orders = await getOpenJobs(null)
    if (orders.length === 0) return `${firstName} got you. No open jobs right now — will text when something comes in`
    await setSession(phone, { state: 'jobs_shown', sites_shown: orders.map(o => o.id) })
    return `${firstName} got you. Here's what's open:\n\n${(await buildJobsMessage(phone, orders))}`
  }

  if (profile.sms_opted_out) return ''

  const firstName = profile.first_name || ''

  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, status, dispatch_order_id, dispatch_orders(driver_pay_cents, yards_needed, cities(name))')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .maybeSingle()

  if (lower.startsWith('done') || lower.startsWith('complete') || lower.startsWith('finished')) {
    if (!activeLoad) return 'No active job found. Text YES to see open jobs'
    const loadMatch = trimmed.match(/(\d+)/)
    const loads = loadMatch ? Math.min(parseInt(loadMatch[1]), 50) : 1
    const payPerLoad = (activeLoad.dispatch_orders as any)?.driver_pay_cents || 4500
    const totalCents = payPerLoad * loads
    const totalDollars = Math.round(totalCents / 100)
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    await supabase.from('load_requests').update({ status: 'completed', completed_at: new Date().toISOString(), payout_cents: totalCents, truck_count: loads }).eq('id', activeLoad.id)
    await supabase.from('driver_payments').insert({ driver_id: profile.user_id, load_request_id: activeLoad.id, amount_cents: totalCents, status: 'pending' }).then(() => null, () => null)
    try { await sendAdminAlert(`${jobNum} complete — ${firstName} ${loads} loads $${totalDollars}`) } catch {}
    await clearSession(phone)
    return await doneReply(firstName, loads, totalDollars, jobNum)
  }

  if (lower === 'cancel' || lower === 'stop job') {
    await clearSession(phone)
    if (!activeLoad) return 'No active job to cancel'
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    await supabase.from('load_requests').update({ status: 'rejected', rejected_reason: 'Cancelled by driver via SMS', reviewed_at: new Date().toISOString() }).eq('id', activeLoad.id)
    try { await sendAdminAlert(`${jobNum} cancelled — ${firstName}`) } catch {}
    return `${jobNum} cancelled. Text YES for other jobs`
  }

  if (lower === 'status' || lower === 'job') {
    if (!activeLoad) return 'No active jobs. Text YES to see what\'s available'
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    const city = (activeLoad.dispatch_orders as any)?.cities?.name || ''
    const yards = (activeLoad.dispatch_orders as any)?.yards_needed || ''
    return `${jobNum} — ${city} — ${yards} yds — ${activeLoad.status}\nReply DONE [loads] when finished`
  }

  if (activeLoad) {
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    return `You got ${jobNum} active. Reply DONE [loads] when finished or CANCEL to cancel`
  }

  const session = await getSession(phone)
  const state = session?.state || 'idle'

  if ((lower === '1' || lower === '2' || lower === '3') && state === 'jobs_shown' && session?.sites_shown?.length) {
    const choice = parseInt(lower)
    const orderId = session.sites_shown[choice - 1]
    if (!orderId) return `Reply 1-${session.sites_shown.length} to claim a job`
    const { data: order } = await supabase.from('dispatch_orders').select('*, cities(name)').eq('id', orderId).single()
    if (!order || order.status === 'completed' || order.status === 'cancelled') return 'That job is no longer available. Text YES for new jobs'
    const { data: loadReq, error: loadErr } = await supabase.from('load_requests').insert({
      driver_id: profile.user_id, dispatch_order_id: orderId,
      status: 'approved', yards_estimated: order.yards_needed,
    }).select().single()
    if (loadErr) { console.error('[load_requests]', loadErr.message); return 'Something went wrong. Text YES to try again' }
    let tokenRow: any = null
    try {
      const { data: tr } = await supabase.from('job_access_tokens').insert({
        load_request_id: loadReq.id, dispatch_order_id: orderId,
        driver_id: profile.user_id,
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      }).select('token').single()
      tokenRow = tr
    } catch {}
    await clearSession(phone)
    const jobNum = generateJobNumber(orderId)
    const city = (order.cities as any)?.name || ''
    const payDollars = Math.round((order.driver_pay_cents || 4500) / 100)
    const link = tokenRow?.token
      ? `${process.env.NEXT_PUBLIC_APP_URL}/driver/job/${(tokenRow as any).token}`
      : `${process.env.NEXT_PUBLIC_APP_URL}/driver/dashboard`
    return `${jobNum} — ${city} — ${order.yards_needed} yds\nPay: $${payDollars}/load\nAddress: ${link}\nReply DONE [loads] when finished`
  }

  if (isNo(lower)) { await clearSession(phone); return 'Ok np. Text YES when ready' }

  if (isYes(lower)) {
    const orders = await getOpenJobs(null)
    if (orders.length === 0) return 'No open jobs right now. Will text you when something comes in'
    return await buildJobsMessage(phone, orders)
  }

  const orders = await getOpenJobs(null)
  if (orders.length === 0) return 'No open jobs right now. Will text you when something comes in'
  return await buildJobsMessage(phone, orders)
}

export interface DispatchStatus { dispatchId: string; jobNumber: string; status: string; driversNotified: number; driversAccepted: number; cityName: string; createdAt: string }

export async function getDispatchStatus(dispatchId: string): Promise<{ success: boolean; data?: DispatchStatus; error?: string }> {
  const s = createAdminSupabase()
  const { data: o, error } = await s.from('dispatch_orders').select('id,status,drivers_notified,city_id,created_at,cities(name)').eq('id', dispatchId).single()
  if (error || !o) return { success: false, error: 'Not found' }
  const { count } = await s.from('load_requests').select('id', { count: 'exact', head: true }).eq('dispatch_order_id', dispatchId).in('status', ['approved','completed'])
  return { success: true, data: { dispatchId: o.id, jobNumber: generateJobNumber(o.id), status: o.status, driversNotified: o.drivers_notified || 0, driversAccepted: count || 0, cityName: (o.cities as any)?.name || 'Unknown', createdAt: o.created_at } }
}

export async function redispatchOrder(dispatchId: string, adminUserId: string): Promise<{ success: boolean; driversNotified?: number; error?: string }> {
  const s = createAdminSupabase()
  const { data: o, error: oe } = await s.from('dispatch_orders').select('id,city_id,yards_needed,driver_pay_cents,status,drivers_notified,cities(name)').eq('id', dispatchId).single()
  if (oe || !o) return { success: false, error: 'Not found' }
  if (o.status === 'completed' || o.status === 'cancelled') return { success: false, error: `Cannot re-dispatch a ${o.status} order` }
  const { data: an } = await s.from('sms_log').select('to_phone').eq('related_id', dispatchId).eq('message_type', 'dispatch')
  const np = new Set((an || []).map((x: any) => x.to_phone))
  const { data: dr } = await s.from('driver_profiles').select('user_id,phone,phone_verified,tiers(slug,dispatch_priority)').eq('city_id', o.city_id).eq('status', 'active').eq('phone_verified', true).limit(500)
  if (!dr || dr.length === 0) return { success: false, error: 'No active drivers' }
  const nd = dr.filter((d: any) => !np.has(d.phone))
  if (nd.length === 0) return { success: false, error: 'All drivers already notified' }
  const { batchDispatchSMS } = await import('../sms')
  const hd = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const cn = (o.cities as any)?.name || 'DFW'
  const pd = o.driver_pay_cents ? Math.round(o.driver_pay_cents / 100) : 35
  const dd = nd.map((d: any) => ({ phone: d.phone, tierSlug: (d.tiers as any)?.slug || 'trial', dispatchId: o.id, cityName: cn, yardsNeeded: o.yards_needed, payDollars: pd, haulDate: hd }))
  const { sent, failed } = await batchDispatchSMS(dd)
  await s.from('dispatch_orders').update({ drivers_notified: ((o as any).drivers_notified || 0) + sent, status: 'dispatching' }).eq('id', dispatchId)
  await s.from('audit_logs').insert({ actor_id: adminUserId, action: 'dispatch_order.redispatched', entity_type: 'dispatch_order', entity_id: dispatchId, metadata: { new_drivers_notified: sent, failed, city: cn } })
  try { await sendAdminAlert(`Re-dispatch ${generateJobNumber(dispatchId)}: ${sent} new drivers in ${cn}`) } catch {}
  return { success: true, driversNotified: sent }
}

export async function cancelDispatch(dispatchId: string, adminUserId: string, reason: string): Promise<{ success: boolean; error?: string }> {
  const s = createAdminSupabase()
  const { data: o, error } = await s.from('dispatch_orders').update({ status: 'cancelled' }).eq('id', dispatchId).not('status', 'eq', 'completed').select('id,cities(name)').single()
  if (error || !o) return { success: false, error: 'Not found or already completed' }
  await s.from('audit_logs').insert({ actor_id: adminUserId, action: 'dispatch_order.cancelled', entity_type: 'dispatch_order', entity_id: dispatchId, metadata: { reason, city: (o.cities as any)?.name } })
  return { success: true }
}

export const smsDispatchService = {
  handleIncoming: handleConversation,
  generateJobNumber,
  getDispatchStatus,
  redispatchOrder,
  cancelDispatch,
}
