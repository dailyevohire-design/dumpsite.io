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

async function getProfile(phone: string) {
  const { data } = await createAdminSupabase().rpc('get_sms_driver', { p_phone: phone })
  return data?.[0] || null
}

async function getConversationHistory(phone: string): Promise<{role: 'user'|'assistant', content: string}[]> {
  const { data } = await createAdminSupabase()
    .from('sms_logs')
    .select('body, direction, created_at')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(10)
  if (!data) return []
  return data
    .reverse()
    .slice(-8)
    .map(m => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.body
    }))
}

async function getOpenJobs(): Promise<any[]> {
  const { data } = await createAdminSupabase()
    .from('dispatch_orders')
    .select('id, city_id, yards_needed, driver_pay_cents, truck_type_needed, status, cities(name)')
    .in('status', ['dispatching', 'active', 'pending'])
    .order('created_at', { ascending: false })
    .limit(10)
  return data || []
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
    return "You're back on"
  }

  const profile = await getProfile(phone)

  // New driver
  if (!profile) {
    const { data: session } = await supabase.from('sms_sessions').select('state').eq('phone', phone).maybeSingle()
    if (!session || session.state !== 'getting_name') {
      await supabase.from('sms_sessions').upsert({ phone, state: 'getting_name', updated_at: new Date().toISOString() }, { onConflict: 'phone' })
      return "Hey — what's your name"
    }
    const firstName = trimmed.split(' ')[0]
    const lastName = trimmed.split(' ').slice(1).join(' ') || 'Driver'
    await supabase.rpc('create_sms_driver', { p_phone: phone, p_first_name: firstName, p_last_name: lastName })
    await supabase.from('sms_sessions').upsert({ phone, state: 'idle', updated_at: new Date().toISOString() }, { onConflict: 'phone' })
    // Fall through to AI with fresh profile
    const jobs = await getOpenJobs()
    const jobsSummary = jobs.slice(0,3).map((j,i) => `${i+1}. ${(j.cities as any)?.name} — ${j.yards_needed} yds, $${Math.round((j.driver_pay_cents||4500)/100)}/load, ${(j.truck_type_needed||'dump truck').replace(/_/g,' ')}`).join('\n')
    return `${firstName} got you. Here's what we got open:\n\n${jobsSummary}\n\nReply 1, 2, or 3 to claim one`
  }

  if (profile.sms_opted_out) return ''

  const firstName = profile.first_name || ''

  // Check active job
  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, status, dispatch_order_id, dispatch_orders(driver_pay_cents, yards_needed, client_address, cities(name))')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .maybeSingle()

  // Hard commands
  if (lower.startsWith('done') || lower.startsWith('complete') || lower.startsWith('finished')) {
    if (!activeLoad) return 'No active job. Text YES to see open jobs'
    const loadMatch = trimmed.match(/(\d+)/)
    const loads = loadMatch ? Math.min(parseInt(loadMatch[1]), 50) : 1
    const payPerLoad = (activeLoad.dispatch_orders as any)?.driver_pay_cents || 4500
    const totalDollars = Math.round(payPerLoad * loads / 100)
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    await supabase.from('load_requests').update({ status: 'completed', completed_at: new Date().toISOString(), payout_cents: payPerLoad * loads, truck_count: loads }).eq('id', activeLoad.id)
    try { await supabase.from('driver_payments').insert({ driver_id: profile.user_id, load_request_id: activeLoad.id, amount_cents: payPerLoad * loads, status: 'pending' }) } catch {}
    try { await sendAdminAlert(`${jobNum} complete — ${firstName} ${loads} loads $${totalDollars}`) } catch {}
    await supabase.from('sms_sessions').upsert({ phone, state: 'idle', updated_at: new Date().toISOString() }, { onConflict: 'phone' })
    return `10.4 — ${loads} load${loads > 1 ? 's' : ''}. $${totalDollars} otw`
  }

  if (lower === 'cancel' || lower === 'stop job') {
    if (!activeLoad) return 'No active job'
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    await supabase.from('load_requests').update({ status: 'rejected', rejected_reason: 'Cancelled via SMS', reviewed_at: new Date().toISOString() }).eq('id', activeLoad.id)
    try { await sendAdminAlert(`${jobNum} cancelled — ${firstName}`) } catch {}
    return `${jobNum} cancelled. Text YES when ready`
  }

  // Get open jobs and conversation history for AI
  const [jobs, history] = await Promise.all([getOpenJobs(), getConversationHistory(phone)])

  const jobsList = jobs.slice(0, 5).map((j, i) =>
    `Job ${i+1}: ${(j.cities as any)?.name} — ${j.yards_needed} yards — $${Math.round((j.driver_pay_cents||4500)/100)}/load — ${(j.truck_type_needed||'tandem').replace(/_/g,' ')} — ID: ${j.id}`
  ).join('\n')

  const activeJobInfo = activeLoad
    ? `Driver has active job ${generateJobNumber(activeLoad.dispatch_order_id)} in ${(activeLoad.dispatch_orders as any)?.cities?.name}. Status: ${activeLoad.status}.`
    : 'Driver has no active job.'

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const systemPrompt = `You are texting as Juan, a dirt broker running DumpSite.io in DFW/Colorado.

YOUR TEXTING STYLE — this is critical:
- Ultra short. 1-3 sentences max
- Casual and direct. No punctuation at end
- Real examples of your texts: "Yes sir" | "10.4" | "Ok np" | "Perfect" | "Morning" | "Send pic of dirt" | "How many yards" | "What city" | "What type of truck" | "Being sent rn" | "Got you"
- Never sound like a bot or customer service
- No emojis. Use driver first name occasionally
- If they need a job, ask qualifying questions naturally: what city, how many yards, what truck type, when they hauling
- Once you have enough info, show them matching jobs from the list below

DRIVER INFO:
Name: ${firstName}
${activeJobInfo}

OPEN JOBS RIGHT NOW:
${jobsList || 'No open jobs currently'}

RULES:
- If driver says they need a dump site or have a load — ask qualifying questions one at a time naturally
- If driver asks about a specific job number from the list — confirm it and tell them to reply with that number to claim it
- If driver replies with just a number (1-5) and jobs were shown — treat as job selection
- Never reveal client addresses in this chat — they get the address link after claiming
- If no matching jobs — tell them nothing available and you'll hit them up
- Keep all responses under 160 characters when possible
- Sound exactly like a real person texting, not an AI`

  // Build messages for Claude
  const messages: {role: 'user'|'assistant', content: string}[] = []

  // Add conversation history
  for (const h of history) {
    if (h.content !== trimmed) { // Don't duplicate current message
      messages.push({ role: h.role, content: h.content })
    }
  }

  // Add current message
  messages.push({ role: 'user', content: trimmed })

  // Ensure we start with user message
  while (messages.length > 0 && messages[0].role === 'assistant') {
    messages.shift()
  }

  if (messages.length === 0) {
    messages.push({ role: 'user', content: trimmed })
  }

  let reply = ''
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: systemPrompt,
      messages
    })
    const block = response.content[0]
    reply = (block.type === 'text' ? block.text : '').trim()
  } catch (err: any) {
    console.error('[AI reply error]', err?.message)
    reply = 'Give me a sec'
  }

  // Check if driver is selecting a job by number
  const jobChoice = parseInt(lower)
  if (!isNaN(jobChoice) && jobChoice >= 1 && jobChoice <= jobs.length) {
    const selectedJob = jobs[jobChoice - 1]
    if (selectedJob) {
      try {
        const { data: loadReq, error: loadErr } = await supabase.from('load_requests').insert({
          driver_id: profile.user_id,
          dispatch_order_id: selectedJob.id,
          status: 'approved',
          yards_estimated: selectedJob.yards_needed,
        }).select().single()

        if (!loadErr && loadReq) {
          let tokenRow: any = null
          try {
            const { data: tr } = await supabase.from('job_access_tokens').insert({
              load_request_id: loadReq.id,
              dispatch_order_id: selectedJob.id,
              driver_id: profile.user_id,
              expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
            }).select('token').single()
            tokenRow = tr
          } catch {}

          const jobNum = generateJobNumber(selectedJob.id)
          const city = (selectedJob.cities as any)?.name || ''
          const payDollars = Math.round((selectedJob.driver_pay_cents || 4500) / 100)
          const link = tokenRow?.token
            ? `${process.env.NEXT_PUBLIC_APP_URL}/driver/job/${tokenRow.token}`
            : `${process.env.NEXT_PUBLIC_APP_URL}/driver/dashboard`

          try { await sendAdminAlert(`${jobNum} claimed by ${firstName} — ${city}`) } catch {}

          reply = `${jobNum} — ${city} — ${selectedJob.yards_needed} yds\n$${payDollars}/load\nAddress: ${link}\nReply DONE [loads] when finished`
        }
      } catch (e: any) {
        console.error('[job claim]', e?.message)
      }
    }
  }

  // Log outbound
  try { await supabase.from('sms_logs').insert({ phone, body: reply, direction: 'outbound', message_sid: `out-${Date.now()}` }) } catch {}

  return reply
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
