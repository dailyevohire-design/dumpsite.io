import crypto from 'crypto'
import { createAdminSupabase } from '../supabase'
import { sendAdminAlert } from '../sms'
import Anthropic from '@anthropic-ai/sdk'
import { generateSiteToken } from '@/lib/utils/site-token'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'

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

const ZIP_MAP: Record<string, string> = {
  '750':'Dallas','751':'Dallas','752':'Dallas',
  '760':'Fort Worth','761':'Fort Worth','762':'Denton',
  '800':'Denver','801':'Denver','802':'Lakewood',
  '803':'Boulder','808':'Colorado Springs','809':'Colorado Springs',
}

async function zipToCity(zip: string): Promise<{ cityId: string | null; cityName: string }> {
  const s = createAdminSupabase()
  const guess = ZIP_MAP[zip.slice(0, 3)] || 'Dallas'
  const { data: c } = await s.from('cities').select('id,name').ilike('name', `%${guess}%`).maybeSingle()
  return { cityId: c?.id || null, cityName: c?.name || guess }
}

async function getSession(phone: string) {
  const { data } = await createAdminSupabase().from('sms_sessions').select('*').eq('phone', phone).maybeSingle()
  return data
}

async function setSession(phone: string, u: Record<string, any>) {
  await createAdminSupabase().from('sms_sessions')
    .upsert({ phone, ...u, updated_at: new Date().toISOString() }, { onConflict: 'phone' })
}

async function clearSession(phone: string) {
  await createAdminSupabase().from('sms_sessions')
    .upsert({ phone, state: 'idle', zip_code: null, city_name: null, material_type: null, estimated_yards: null, sites_shown: null, updated_at: new Date().toISOString() }, { onConflict: 'phone' })
}

function mat(t: string): string | null {
  const s = t.toLowerCase()
  if (s.includes('clean fill') || s.includes('cleanfill')) return 'clean fill'
  if (s.includes('sandy loam') || s.includes('sandy')) return 'sandy loam'
  if (s.includes('caliche')) return 'caliche'
  if (s.includes('topsoil') || s.includes('top soil')) return 'topsoil'
  if (s.includes('clay')) return 'clay'
  if (s.includes('concrete') || s.includes('demo')) return 'concrete'
  if (s.includes('rock') || s.includes('gravel')) return 'rock'
  if (s.includes('mixed') || s.includes('mix')) return 'mixed'
  if (s.includes('fill dirt') || s.includes('fill') || s.includes('dirt')) return 'clean fill'
  return null
}

function zip(t: string): string | null { const m = t.match(/\b(\d{5})\b/); return m ? m[1] : null }

function yds(t: string): number | null {
  const y = t.match(/(\d+)\s*(?:yards?|yds?|cubic|cy)/i)
  if (y) return parseInt(y[1])
  const tn = t.match(/(\d+)\s*(?:tons?)\b/i)
  if (tn) return Math.round(parseInt(tn[1]) * 0.7)
  return null
}

function isYes(t: string): boolean {
  const s = t.toLowerCase().trim()
  return ['yes','yeah','yep','yup','yea','sure','ok','okay','correct','10-4','10.4','104',
    'fs','for sure','need','dumpsite','dump','site','haul','load','loaded','ready'].some(w => s === w || s.includes(w))
}

function isNo(t: string): boolean {
  return ['no','nope','nah','not yet','nevermind','never mind'].some(w => t.toLowerCase().trim() === w)
}

async function findSites(cityId: string | null, material: string, yards: number | null) {
  const s = createAdminSupabase()
  let q = s.from('dump_sites').select('id,capacity_yards,filled_yards,accepted_materials,gate_code,hours_text,access_instructions,operator_name,city_id').eq('is_active', true)
  if (cityId) q = q.eq('city_id', cityId)
  const { data, error } = await q
  if (error) console.error('[findSites]', error.message)
  if (!data || data.length === 0) return []
  const yn = yards || 1
  const mt = material.toLowerCase()
  return data.filter(s => {
    const cap = (s.capacity_yards || 0) - (s.filled_yards || 0)
    if (cap < yn) return false
    const acc: string[] = s.accepted_materials || []
    if (acc.length === 0) return true
    return acc.some((m: string) => { const ml = m.toLowerCase(); return ml === 'all' || ml.includes(mt) || mt.includes(ml) })
  }).sort((a, b) => ((b.capacity_yards||0)-(b.filled_yards||0)) - ((a.capacity_yards||0)-(a.filled_yards||0))).slice(0, 3)
}

async function showSites(phone: string, cityName: string, material: string, yards: number | null, userId: string): Promise<string> {
  const s = createAdminSupabase()
  const { data: cr } = await s.from('cities').select('id').ilike('name', `%${cityName}%`).maybeSingle()
  const sites = await findSites(cr?.id || null, material, yards)
  if (sites.length === 0) {
    try { await s.from('dispatch_waitlist').insert({ driver_id: userId, city_id: cr?.id || null, city_name: cityName, material_type: material, estimated_yards: yards, notified: false }) } catch {}
    await clearSession(phone)
    return `Nothing available right now in ${cityName} for ${material}. Got you on the list — will text when one opens up`
  }
  const yt = yards ? ` (${yards} yds)` : ''
  const lines: string[] = [`${cityName} — ${material}${yt}`, '']
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]
    const cap = (site.capacity_yards || 0) - (site.filled_yards || 0)
    const token = generateSiteToken({ siteId: site.id, jobId: site.id, driverPhone: phone, expiresInMinutes: 240 })
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
  const phone = normalizePhone(from)

  try { await supabase.from('sms_logs').insert({ phone, body: trimmed, message_sid: messageSid, direction: 'inbound' }) } catch {}

  if (lower === 'stop' || lower === 'unsubscribe') { await supabase.from('driver_profiles').update({ sms_opted_out: true }).eq('phone', phone); return '' }
  if (lower === 'start' || lower === 'subscribe') { await supabase.from('driver_profiles').update({ sms_opted_out: false }).eq('phone', phone); return "You're back on. Text us when you got a load" }
  if (lower === 'help' || lower === '?') return 'Text zip + material when you got a load\nReply DONE [loads] when finished\nReply CANCEL to cancel'

  const { data: profile, error: profileError } = await supabase.from('driver_profiles').select('user_id,first_name,status,sms_opted_out').eq('phone', phone).maybeSingle()
  console.error('[SMS DEBUG] phone:', phone, 'profile:', JSON.stringify(profile), 'error:', profileError?.message)

  // NEW DRIVER — no auth required, insert directly with random UUID
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

    // Insert profile directly — no auth user needed for SMS drivers
    const { error: insertErr } = await supabase.from('driver_profiles').insert({
      user_id: crypto.randomUUID(),
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

    if (insertErr) {
      console.error('[profile insert failed]', insertErr.message)
      await clearSession(phone)
      return `${firstName} got you. What's the zip you hauling from`
    }

    await setSession(phone, { state: 'asking_zip' })
    return `${firstName} got you. What's the zip you hauling from`
  }

  if (profile.sms_opted_out) return ''
  if (profile.status !== 'active') await supabase.from('driver_profiles').update({ status: 'active' }).eq('phone', phone)

  const firstName = profile.first_name || ''

  const { data: activeLoad } = await supabase.from('load_requests').select('id,status,dispatch_order_id,dispatch_orders(driver_pay_cents,cities(name))').eq('driver_id', profile.user_id).in('status', ['pending','approved']).order('created_at', { ascending: false }).maybeSingle()
  const { data: activeJob } = await supabase.from('dispatch_jobs').select('id,job_number,load_count').eq('driver_id', profile.user_id).eq('status', 'in_progress').order('created_at', { ascending: false }).limit(1).maybeSingle()

  // DONE
  if (lower.startsWith('done') || lower.startsWith('complete') || lower.startsWith('finished')) {
    const lm = trimmed.match(/(\d+)/)
    const loads = lm ? Math.min(parseInt(lm[1]), 50) : 1
    if (activeJob) {
      const dollars = loads * 45
      await supabase.from('dispatch_jobs').update({ status: 'completed', completed_at: new Date().toISOString(), load_count: loads, payment_amount: dollars, payment_status: 'pending' }).eq('id', activeJob.id)
      try { await supabase.from('driver_payments').insert({ driver_id: profile.user_id, job_id: activeJob.id, amount_dollars: dollars, status: 'pending' }) } catch {}
      try { await sendAdminAlert(`${activeJob.job_number} complete — ${firstName} ${loads} loads $${dollars}`) } catch {}
      await clearSession(phone)
      return await doneReply(firstName, loads, dollars, activeJob.job_number)
    }
    if (activeLoad) {
      const ppl = (activeLoad.dispatch_orders as any)?.driver_pay_cents || 3500
      const tc = ppl * loads; const td = Math.round(tc / 100)
      const jn = generateJobNumber(activeLoad.dispatch_order_id)
      await supabase.from('load_requests').update({ status: 'completed', completed_at: new Date().toISOString(), payout_cents: tc, truck_count: loads }).eq('id', activeLoad.id)
      try { await supabase.from('driver_payments').insert({ driver_id: profile.user_id, load_request_id: activeLoad.id, amount_cents: tc, status: 'pending' }) } catch {}
      try { await sendAdminAlert(`${jn} complete — ${firstName} ${loads} loads $${td}`) } catch {}
      await clearSession(phone)
      return await doneReply(firstName, loads, td, jn)
    }
    return 'No active job found'
  }

  // CANCEL
  if (lower === 'cancel' || lower === 'stop job') {
    await clearSession(phone)
    if (activeJob) { await supabase.from('dispatch_jobs').update({ status: 'cancelled' }).eq('id', activeJob.id); return `${activeJob.job_number} cancelled. Text us when you got another load` }
    if (activeLoad) { const jn = generateJobNumber(activeLoad.dispatch_order_id); await supabase.from('load_requests').update({ status: 'rejected', rejected_reason: 'Cancelled by driver via SMS', reviewed_at: new Date().toISOString() }).eq('id', activeLoad.id); return `${jn} cancelled. Text us when you got another load` }
    return 'No active job to cancel'
  }

  // STATUS
  if (lower === 'status' || lower === 'job') {
    if (activeJob) return `${activeJob.job_number} — in progress\nReply DONE [loads] when finished`
    if (activeLoad) { const jn = generateJobNumber(activeLoad.dispatch_order_id); const city = (activeLoad.dispatch_orders as any)?.cities?.name || ''; return `${jn} — ${city} — ${activeLoad.status}\nReply DONE [loads] when finished` }
    return 'No active jobs. Text your zip when you got a load ready'
  }

  if (activeJob || activeLoad) { const jn = activeJob ? activeJob.job_number : generateJobNumber(activeLoad!.dispatch_order_id); return `You got ${jn} active. Reply DONE [loads] when finished or CANCEL to cancel` }

  // STATE MACHINE
  const session = await getSession(phone)
  const state = session?.state || 'idle'
  const dz = zip(trimmed)
  const dm = mat(trimmed)
  const dy = yds(trimmed)

  // Site selection
  if ((lower === '1' || lower === '2' || lower === '3') && state === 'sites_shown' && session?.sites_shown?.length) {
    const choice = parseInt(lower)
    const siteId = session.sites_shown[choice - 1]
    if (!siteId) return `Reply 1${session.sites_shown.length > 1 ? '-' + session.sites_shown.length : ''} to pick a site`
    const { data: site } = await supabase.from('dump_sites').select('*').eq('id', siteId).single()
    if (!site) return 'That site went offline. Text your zip for new options'
    const cap = (site.capacity_yards || 0) - (site.filled_yards || 0)
    if (cap <= 0) return 'That one just filled up. Text your zip for new options'
    const jn = 'DS-' + Date.now().toString().slice(-6)
    try { await supabase.from('dispatch_jobs').insert({ job_number: jn, driver_id: profile.user_id, site_id: site.id, city_name: session.city_name, material_type: session.material_type, estimated_yards: session.estimated_yards, driver_phone: phone, status: 'in_progress', source: 'sms', updated_at: new Date().toISOString() }) } catch (e: any) { console.error('[job]', e.message) }
    if (session.estimated_yards) { try { await supabase.rpc('reserve_site_capacity', { p_site_id: site.id, p_yards: session.estimated_yards }) } catch {} }
    await clearSession(phone)
    const token = generateSiteToken({ siteId: site.id, jobId: siteId, driverPhone: phone, expiresInMinutes: 240 })
    const gate = site.gate_code ? `\nGate: ${site.gate_code}` : ''
    const hours = site.hours_text ? `\nHours: ${site.hours_text}` : ''
    return `${jn} — locked in\n${APP_URL}/api/sites/reveal?t=${token}${gate}${hours}\nReply DONE [loads] when finished`
  }

  if (state === 'asking_intent') {
    if (isNo(lower)) { await clearSession(phone); return 'Ok np. Text us when you need a site' }
    if (dz) { const { cityName } = await zipToCity(dz); if (dm) { await setSession(phone, { state: 'finding_sites', zip_code: dz, city_name: cityName, material_type: dm, estimated_yards: dy }); return await showSites(phone, cityName, dm, dy, profile.user_id) } await setSession(phone, { state: 'asking_material', zip_code: dz, city_name: cityName, estimated_yards: dy }); return `${cityName} — what material? clean fill, clay, topsoil, mixed, caliche` }
    await setSession(phone, { state: 'asking_zip' })
    return "What's the zip you hauling from"
  }

  if (state === 'asking_zip') {
    if (dz) { const { cityName } = await zipToCity(dz); if (dm) { await setSession(phone, { state: 'finding_sites', zip_code: dz, city_name: cityName, material_type: dm, estimated_yards: dy }); return await showSites(phone, cityName, dm, dy, profile.user_id) } await setSession(phone, { state: 'asking_material', zip_code: dz, city_name: cityName, estimated_yards: dy }); return `${cityName} — what material? clean fill, clay, topsoil, mixed, caliche` }
    return "Need your 5-digit zip code"
  }

  if (state === 'asking_material') {
    if (dm) { const cn = session?.city_name || 'Dallas'; const y = dy || session?.estimated_yards || null; await setSession(phone, { state: 'finding_sites', material_type: dm, estimated_yards: y }); return await showSites(phone, cn, dm, y, profile.user_id) }
    return 'What material? clean fill, clay, topsoil, mixed, or caliche'
  }

  if (state === 'sites_shown') { const count = session?.sites_shown?.length || 1; return `Reply ${count === 1 ? '1' : '1-' + count} to claim a site` }

  if (dz && dm) { const { cityName } = await zipToCity(dz); await setSession(phone, { state: 'finding_sites', zip_code: dz, city_name: cityName, material_type: dm, estimated_yards: dy }); return await showSites(phone, cityName, dm, dy, profile.user_id) }
  if (dz) { const { cityName } = await zipToCity(dz); await setSession(phone, { state: 'asking_material', zip_code: dz, city_name: cityName, estimated_yards: dy }); return `${cityName} — what material? clean fill, clay, topsoil, mixed, caliche` }
  if (dm) { await setSession(phone, { state: 'asking_zip', material_type: dm, estimated_yards: dy }); return "What's the zip you hauling from" }
  if (isYes(lower)) { await setSession(phone, { state: 'asking_zip' }); return "What's the zip you hauling from" }
  await setSession(phone, { state: 'asking_intent' })
  return 'Need a dump site?'
}

export interface DispatchStatus { dispatchId: string; jobNumber: string; status: string; driversNotified: number; driversAccepted: number; cityName: string; createdAt: string }
export async function getDispatchStatus(dispatchId: string): Promise<{ success: boolean; data?: DispatchStatus; error?: string }> { const s = createAdminSupabase(); const { data: o, error } = await s.from('dispatch_orders').select('id,status,drivers_notified,city_id,created_at,cities(name)').eq('id', dispatchId).single(); if (error || !o) return { success: false, error: 'Not found' }; const { count } = await s.from('load_requests').select('id', { count: 'exact', head: true }).eq('dispatch_order_id', dispatchId).in('status', ['approved','completed']); return { success: true, data: { dispatchId: o.id, jobNumber: generateJobNumber(o.id), status: o.status, driversNotified: o.drivers_notified || 0, driversAccepted: count || 0, cityName: (o.cities as any)?.name || 'Unknown', createdAt: o.created_at } } }
export async function redispatchOrder(dispatchId: string, adminUserId: string): Promise<{ success: boolean; driversNotified?: number; error?: string }> { const s = createAdminSupabase(); const { data: o, error: oe } = await s.from('dispatch_orders').select('id,city_id,yards_needed,driver_pay_cents,status,drivers_notified,cities(name)').eq('id', dispatchId).single(); if (oe || !o) return { success: false, error: 'Not found' }; if (o.status === 'completed' || o.status === 'cancelled') return { success: false, error: `Cannot re-dispatch a ${o.status} order` }; const { data: an } = await s.from('sms_log').select('to_phone').eq('related_id', dispatchId).eq('message_type', 'dispatch'); const np = new Set((an || []).map((x: any) => x.to_phone)); const { data: dr } = await s.from('driver_profiles').select('user_id,phone,phone_verified,tiers(slug,dispatch_priority)').eq('city_id', o.city_id).eq('status', 'active').eq('phone_verified', true).limit(500); if (!dr || dr.length === 0) return { success: false, error: 'No active drivers' }; const nd = dr.filter((d: any) => !np.has(d.phone)); if (nd.length === 0) return { success: false, error: 'All drivers already notified' }; const { batchDispatchSMS } = await import('../sms'); const hd = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); const cn = (o.cities as any)?.name || 'DFW'; const pd = o.driver_pay_cents ? Math.round(o.driver_pay_cents / 100) : 35; const dd = nd.map((d: any) => ({ phone: d.phone, tierSlug: (d.tiers as any)?.slug || 'trial', dispatchId: o.id, cityName: cn, yardsNeeded: o.yards_needed, payDollars: pd, haulDate: hd })); const { sent, failed } = await batchDispatchSMS(dd); await s.from('dispatch_orders').update({ drivers_notified: ((o as any).drivers_notified || 0) + sent, status: 'dispatching' }).eq('id', dispatchId); await s.from('audit_logs').insert({ actor_id: adminUserId, action: 'dispatch_order.redispatched', entity_type: 'dispatch_order', entity_id: dispatchId, metadata: { new_drivers_notified: sent, failed, city: cn } }); try { await sendAdminAlert(`Re-dispatch ${generateJobNumber(dispatchId)}: ${sent} new drivers in ${cn}`) } catch {}; return { success: true, driversNotified: sent } }
export async function cancelDispatch(dispatchId: string, adminUserId: string, reason: string): Promise<{ success: boolean; error?: string }> { const s = createAdminSupabase(); const { data: o, error } = await s.from('dispatch_orders').update({ status: 'cancelled' }).eq('id', dispatchId).not('status', 'eq', 'completed').select('id,cities(name)').single(); if (error || !o) return { success: false, error: 'Not found or already completed' }; await s.from('audit_logs').insert({ actor_id: adminUserId, action: 'dispatch_order.cancelled', entity_type: 'dispatch_order', entity_id: dispatchId, metadata: { reason, city: (o.cities as any)?.name } }); return { success: true } }

export const smsDispatchService = { handleIncoming: handleConversation, generateJobNumber, getDispatchStatus, redispatchOrder, cancelDispatch }
