import { createAdminSupabase } from '../supabase'
import { sendAdminAlert } from '../sms'
import { extractIntent, ExtractionResult } from './extraction.service'
import { findNearbyJobs, atomicClaimJob, releaseReservation, JobMatch } from './routing.service'
import {
  downloadAndStorePhoto,
  sendCustomerApprovalRequest,
  makeVoiceCallToCustomer,
  sendAdminEscalation,
  processAdminApproval,
  processCustomerApproval
} from './approval.service'
import twilio from 'twilio'

const ADMIN_PHONE = '7134439223'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'

export function generateJobNumber(id: string): string {
  return `DS-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`
}

function normalizePhone(phone: string): string {
  return phone.replace(/^\+1/, '').replace(/\D/g, '')
}

function formatPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+1${digits}`
}

async function logEvent(type: string, payload: Record<string, any>, jobId?: string) {
  try {
    await createAdminSupabase().from('event_log').insert({
      event_type: type, job_id: jobId, payload, created_at: new Date().toISOString()
    })
  } catch {}
}

async function getProfile(phone: string) {
  const { data } = await createAdminSupabase().rpc('get_sms_driver', { p_phone: phone })
  return data?.[0] || null
}

async function getConversation(phone: string) {
  const { data } = await createAdminSupabase().rpc('get_conversation', { p_phone: phone })
  return data?.[0] || null
}

async function saveConversation(phone: string, updates: Record<string, any>) {
  await createAdminSupabase().rpc('upsert_conversation', {
    p_phone: phone,
    p_state: updates.state,
    p_job_state: updates.job_state || null,
    p_active_order_id: updates.active_order_id || null,
    p_extracted_city: updates.extracted_city || null,
    p_extracted_yards: updates.extracted_yards || null,
    p_extracted_truck_type: updates.extracted_truck_type || null,
    p_extracted_material: updates.extracted_material || null,
    p_photo_storage_path: updates.photo_storage_path || null,
    p_photo_public_url: updates.photo_public_url || null,
    p_reservation_id: updates.reservation_id || null,
    p_pending_approval_order_id: updates.pending_approval_order_id || null,
    p_approval_sent_at: updates.approval_sent_at || null,
    p_voice_call_made: updates.voice_call_made || null,
    p_last_message_sid: updates.last_message_sid || null,
  })
}

async function resetConversation(phone: string) {
  // Release any active reservation before resetting
  const conv = await getConversation(phone)
  if (conv?.reservation_id) {
    await releaseReservation(conv.reservation_id)
  }
  // Direct update to force nulls — the RPC's COALESCE skips null params
  await createAdminSupabase().from('conversations').update({
    state: 'DISCOVERY',
    job_state: null,
    active_order_id: null,
    pending_approval_order_id: null,
    reservation_id: null,
    extracted_city: null,
    extracted_yards: null,
    extracted_truck_type: null,
    extracted_material: null,
    photo_storage_path: null,
    photo_public_url: null,
    approval_sent_at: null,
    voice_call_made: null,
  }).eq('phone', phone)
}

async function sendJobLink(driverPhone: string, orderId: string, jobNumber: string): Promise<string> {
  const supabase = createAdminSupabase()
  const crypto = await import('crypto')
  const profile = await getProfile(driverPhone)
  if (!profile) return `${APP_URL}/driver/dashboard`

  const { data: order } = await supabase.from('dispatch_orders').select('*').eq('id', orderId).single()
  if (!order) return `${APP_URL}/driver/dashboard`

  // Create load request with idempotency key
  const idempotencyKey = `${profile.user_id}-${orderId}-${Date.now()}`
  const { data: loadReq, error: loadErr } = await supabase.from('load_requests').insert({
    driver_id: profile.user_id,
    dispatch_order_id: orderId,
    status: 'approved',
    yards_estimated: order.yards_needed,
    idempotency_key: idempotencyKey
  }).select().single()

  if (loadErr || !loadReq) {
    console.error('[sendJobLink] load_request insert failed:', loadErr?.message)
    return `${APP_URL}/driver/dashboard`
  }

  // Create access token with short_id and token_hash
  let link = `${APP_URL}/driver/dashboard`
  try {
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const shortId = crypto.randomBytes(6).toString('hex')

    const { data: tokenRow, error: tokenErr } = await supabase.from('job_access_tokens').insert({
      load_request_id: loadReq.id,
      driver_id: profile.user_id,
      token_hash: tokenHash,
      short_id: shortId,
      expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
    }).select('short_id').single()

    if (tokenErr) console.error('[sendJobLink] token insert failed:', tokenErr.message)
    if (tokenRow?.short_id) link = `${APP_URL}/job-access/${tokenRow.short_id}`
  } catch (err: any) {
    console.error('[sendJobLink] token creation error:', err?.message)
  }

  return link
}

async function buildJobListMessage(jobs: JobMatch[], phone: string): Promise<string> {
  const lines: string[] = []
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i]
    const pay = Math.round(j.driverPayCents / 100)
    const truck = j.truckTypeNeeded.replace(/_/g, ' ')
    const dist = j.distanceMiles > 0 ? ` — ${j.distanceMiles} mi away` : ''
    lines.push(`${i + 1}. ${j.cityName}${dist}`)
    lines.push(`   ${j.yardsNeeded} yds — $${pay}/load — ${truck}`)
  }
  return lines.join('\n') + `\n\nReply ${jobs.length === 1 ? '1' : '1-' + jobs.length} to claim`
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
async function handleConversation(sms: {
  from: string
  body: string
  messageSid: string
  mediaUrl?: string
  numMedia?: number
}): Promise<string> {
  const supabase = createAdminSupabase()
  const { from, body, messageSid, mediaUrl, numMedia } = sms
  const trimmed = (body || '').trim()
  const phone = normalizePhone(from)
  const hasMedia = (numMedia || 0) > 0

  // ── DEDUPLICATION ──────────────────────────────────────────────────────────
  const { data: isDupe } = await supabase.rpc('check_and_mark_message', { p_sid: messageSid })
  if (!isDupe) {
    console.log('[dedup] duplicate message ignored:', messageSid)
    return ''
  }

  // ── LOG INBOUND ────────────────────────────────────────────────────────────
  try {
    await supabase.from('sms_logs').insert({ phone, body: trimmed, message_sid: messageSid, direction: 'inbound' })
  } catch {}
  await logEvent('MESSAGE_RECEIVED', { phone, body: trimmed, messageSid, hasMedia })

  // ── COMPLIANCE: STOP/START ─────────────────────────────────────────────────
  const lower = trimmed.toLowerCase().trim()
  if (lower === 'stop' || lower === 'unsubscribe') {
    await supabase.from('driver_profiles').update({ sms_opted_out: true }).eq('phone', phone)
    await logEvent('COMPLIANCE_UPDATED', { phone, action: 'STOPPED' })
    return ''
  }
  if (lower === 'start') {
    await supabase.from('driver_profiles').update({ sms_opted_out: false }).eq('phone', phone)
    return "You're back on. Text us when you got a load ready"
  }
  if (lower === 'help') {
    return 'Text when you got a load ready\nSend pic of dirt when we match you to a job\nDONE [loads] when finished\nCANCEL to cancel'
  }

  // ── ADMIN COMMANDS ─────────────────────────────────────────────────────────
  if (phone === ADMIN_PHONE) {
    const approveMatch = trimmed.match(/approve-?(ds-?[a-z0-9]+)/i)
    const rejectMatch = trimmed.match(/reject-?(ds-?[a-z0-9]+)/i)

    if (approveMatch || rejectMatch) {
      const code = (approveMatch || rejectMatch)![1].toUpperCase()
      const approved = !!approveMatch
      const result = await processAdminApproval(code, approved)

      if (result) {
        if (approved) {
          const link = await sendJobLink(result.driverPhone, result.orderId, code)
          const orderNum = generateJobNumber(result.orderId)
          // Notify driver
          const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
          await twilioClient.messages.create({
            to: formatPhoneE164(result.driverPhone),
            from: (process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER)!,
            body: `${orderNum} — approved. Head over\nAddress: ${link}\nReply DONE [loads] when finished`
          }).catch(() => {})
          await saveConversation(result.driverPhone, { state: 'ACTIVE', job_state: 'IN_PROGRESS', active_order_id: result.orderId })
          await logEvent('APPROVAL_DECIDED', { approvalCode: code, approved: true, driverPhone: result.driverPhone }, result.orderId)
          return `Approved ${code}. Driver notified`
        } else {
          const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
          await twilioClient.messages.create({
            to: formatPhoneE164(result.driverPhone),
            from: (process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER)!,
            body: `Can't take that load. Send pic of different dirt or text new city`
          }).catch(() => {})
          await saveConversation(result.driverPhone, { state: 'DISCOVERY', job_state: 'NONE' })
          return `Rejected ${code}. Driver notified`
        }
      }
      return `Code ${approveMatch?.[1] || rejectMatch?.[1]} not found`
    }
  }

  // ── CUSTOMER APPROVAL CHECK ────────────────────────────────────────────────
  const { data: pendingOrders } = await supabase
    .from('dispatch_orders')
    .select('id, client_phone, client_name')
    .in('status', ['dispatching', 'active', 'pending'])

  const isCustomer = pendingOrders?.some(o => {
    const normalized = (o.client_phone || '').replace(/\D/g, '').replace(/^1/, '')
    return normalized === phone
  })

  if (isCustomer && phone !== ADMIN_PHONE) {
    const approved = ['yes','yeah','yep','approved','ok','okay','go ahead','sounds good','sure','correct','affirmative'].some(w => lower === w || lower.startsWith(w + ' '))
    const rejected = ['no','nope','nah','cancel','decline','reject','dont','don\'t'].some(w => lower === w || lower.startsWith(w))

    if (approved || rejected) {
      const result = await processCustomerApproval(phone, approved)
      if (result) {
        if (approved) {
          const link = await sendJobLink(result.driverPhone, result.orderId, generateJobNumber(result.orderId))
          const jobNum = generateJobNumber(result.orderId)
          const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
          await twilioClient.messages.create({
            to: formatPhoneE164(result.driverPhone),
            from: (process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER)!,
            body: `${jobNum} — approved. Head over\nAddress: ${link}\nReply DONE [loads] when finished`
          }).catch(() => {})
          await saveConversation(result.driverPhone, { state: 'ACTIVE', job_state: 'IN_PROGRESS', active_order_id: result.orderId })
          await logEvent('APPROVAL_DECIDED', { approved: true, driverPhone: result.driverPhone, customerPhone: phone }, result.orderId)
          return 'Perfect — driver is on the way'
        } else {
          const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
          await twilioClient.messages.create({
            to: formatPhoneE164(result.driverPhone),
            from: (process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER)!,
            body: 'Customer declined this load. Text new city when you have another'
          }).catch(() => {})
          await saveConversation(result.driverPhone, { state: 'DISCOVERY', job_state: 'NONE' })
          return 'Got it — driver notified'
        }
      }
    }
    return ''
  }

  // ── DRIVER FLOW ────────────────────────────────────────────────────────────
  const profile = await getProfile(phone)

  // New driver onboarding
  if (!profile) {
    const conv = await getConversation(phone)
    const state = conv?.state || 'DISCOVERY'

    if (state !== 'GETTING_NAME') {
      await saveConversation(phone, { state: 'GETTING_NAME' })
      return "Hey — what's your name"
    }

    const firstName = trimmed.split(' ')[0]
    const lastName = trimmed.split(' ').slice(1).join(' ') || 'Driver'
    await supabase.rpc('create_sms_driver', { p_phone: phone, p_first_name: firstName, p_last_name: lastName })
    await saveConversation(phone, { state: 'DISCOVERY' })
    await logEvent('CONTACT_CREATED', { phone, firstName })
    return `${firstName} got you. What city you hauling from and how many yards`
  }

  if (profile.sms_opted_out) return ''
  const firstName = profile.first_name || 'Driver'

  // Check active load request
  const { data: activeLoad } = await supabase
    .from('load_requests')
    .select('id, status, dispatch_order_id, dispatch_orders(driver_pay_cents, yards_needed, cities(name))')
    .eq('driver_id', profile.user_id)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .maybeSingle()

  // Get conversation state
  const conv = await getConversation(phone)
  const convState = conv?.state || 'DISCOVERY'

  // ── EXTRACT INTENT ─────────────────────────────────────────────────────────
  // Only pass lastKnownCity when driver is mid-flow, not on a fresh conversation
  const inActiveFlow = ['JOBS_SHOWN', 'PHOTO_PENDING', 'APPROVAL_PENDING', 'ACTIVE', 'ASKING_TRUCK'].includes(convState)
  const extracted = await extractIntent(trimmed, hasMedia, {
    activeJobId: activeLoad?.dispatch_order_id,
    lastKnownCity: inActiveFlow ? conv?.extracted_city : undefined,
    isAdmin: phone === ADMIN_PHONE
  })

  // ── HANDLE DONE ────────────────────────────────────────────────────────────
  if (extracted.intent === 'DONE_REPORT') {
    if (!activeLoad) return "No active job. Text when you're ready with a load"
    const loads = extracted.loadCount || 1
    const payPerLoad = (activeLoad.dispatch_orders as any)?.driver_pay_cents || 4500
    const totalDollars = Math.round(payPerLoad * loads / 100)
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)

    await supabase.from('load_requests').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      payout_cents: payPerLoad * loads,
      truck_count: loads
    }).eq('id', activeLoad.id)

    try {
      await supabase.from('driver_payments').insert({
        driver_id: profile.user_id,
        load_request_id: activeLoad.id,
        amount_cents: payPerLoad * loads,
        status: 'pending'
      })
    } catch {}

    try { await sendAdminAlert(`${jobNum} complete — ${firstName} ${loads} loads $${totalDollars}`) } catch {}
    await resetConversation(phone)
    await logEvent('DELIVERY_VERIFIED', { phone, jobNum, loads, totalDollars }, activeLoad.dispatch_order_id)
    return `10.4 — ${loads} load${loads > 1 ? 's' : ''}. $${totalDollars} coming your way`
  }

  // ── HANDLE CANCEL ──────────────────────────────────────────────────────────
  if (extracted.intent === 'CANCEL') {
    if (conv?.reservation_id) await releaseReservation(conv.reservation_id)
    await resetConversation(phone)
    if (!activeLoad) return 'No active job'
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    await supabase.from('load_requests').update({
      status: 'rejected',
      rejected_reason: 'Cancelled via SMS',
      reviewed_at: new Date().toISOString()
    }).eq('id', activeLoad.id)
    try { await sendAdminAlert(`${jobNum} cancelled — ${firstName}`) } catch {}
    return `${jobNum} cancelled. Text when you got another load`
  }

  // ── HANDLE ADDRESS REQUEST (only when driver has active job) ────────────────
  if (extracted.intent === 'ADDRESS_REQUEST' && activeLoad && convState === 'ACTIVE') {
    const link = await sendJobLink(phone, activeLoad.dispatch_order_id, generateJobNumber(activeLoad.dispatch_order_id))
    return `Address: ${link}`
  }

  // ── ALREADY HAS ACTIVE JOB ─────────────────────────────────────────────────
  if (activeLoad && convState === 'ACTIVE') {
    const jobNum = generateJobNumber(activeLoad.dispatch_order_id)
    return `You got ${jobNum} active. Reply DONE [loads] when finished or CANCEL to cancel`
  }

  // ── STATE: WAITING FOR APPROVAL ────────────────────────────────────────────
  if (convState === 'APPROVAL_PENDING') {
    return 'Still waiting on customer approval. Hang tight'
  }

  // ── STATE: PHOTO PENDING ───────────────────────────────────────────────────
  if (convState === 'PHOTO_PENDING') {
    if (extracted.intent === 'APPROVAL_PHOTO' || hasMedia) {
      if (!mediaUrl || !conv?.active_order_id) {
        return 'Send a pic of the dirt load'
      }

      const photoResult = await downloadAndStorePhoto(mediaUrl, phone, conv.active_order_id)
      if (!photoResult) {
        return 'Had trouble with that photo. Try sending it again'
      }

      await supabase.from('material_photos').insert({
        driver_phone: phone,
        order_id: conv.active_order_id,
        storage_path: photoResult.storagePath,
        public_url: photoResult.publicUrl,
        twilio_media_url: mediaUrl
      })

      const { data: order } = await supabase
        .from('dispatch_orders')
        .select('*, cities(name)')
        .eq('id', conv.active_order_id)
        .single()

      if (!order) return 'Something went wrong. Text your city again'

      const jobNum = generateJobNumber(order.id)
      const approvalCode = jobNum

      // Check if high value — escalate to admin
      if ((conv.extracted_yards || order.yards_needed) >= 500) {
        await supabase.from('escalation_queue').insert({
          driver_phone: phone,
          order_id: order.id,
          reason: 'high_value',
          status: 'pending',
          approval_code: approvalCode
        })
        await sendAdminEscalation(
          order.id, jobNum, firstName, phone,
          (order.cities as any)?.name || '',
          conv.extracted_yards || order.yards_needed,
          Math.round(order.driver_pay_cents / 100),
          'HIGH VALUE JOB >= 500 yds',
          approvalCode
        )
        await saveConversation(phone, { state: 'APPROVAL_PENDING', pending_approval_order_id: order.id, approval_sent_at: new Date().toISOString() })
        await logEvent('HUMAN_ESCALATION_CREATED', { phone, jobNum, reason: 'high_value' }, order.id)
        return `Got it. ${jobNum} is a large job — sending to my team for final approval. Will hit you back`
      }

      // Send to customer for approval
      const sent = await sendCustomerApprovalRequest(
        order.client_phone,
        order.client_name,
        firstName,
        order.id,
        conv.extracted_yards || order.yards_needed,
        photoResult.publicUrl,
        approvalCode
      )

      if (!sent) {
        await sendAdminEscalation(order.id, jobNum, firstName, phone, (order.cities as any)?.name || '', conv.extracted_yards || order.yards_needed, Math.round(order.driver_pay_cents / 100), 'CUSTOMER_UNREACHABLE', approvalCode)
        await supabase.from('escalation_queue').insert({ driver_phone: phone, order_id: order.id, reason: 'customer_unreachable', status: 'pending', approval_code: approvalCode })
      }

      await saveConversation(phone, {
        state: 'APPROVAL_PENDING',
        pending_approval_order_id: order.id,
        photo_public_url: photoResult.publicUrl,
        photo_storage_path: photoResult.storagePath,
        approval_sent_at: new Date().toISOString(),
        voice_call_made: false
      })

      await logEvent('APPROVAL_REQUESTED', { phone, jobNum, photoUrl: photoResult.publicUrl }, order.id)
      return `Got it. Sending to owner for final 10-4. Sit tight`
    }

    return 'Send a pic of the dirt so we can get approval'
  }

  // ── STATE: ASKING TRUCK TYPE ──────────────────────────────────────────────
  if (convState === 'ASKING_TRUCK') {
    // They responded to our truck type question
    const knownTrucks: Record<string, string> = {
      tandem: 'tandem_axle', 'tandem axle': 'tandem_axle',
      triaxle: 'tri_axle', triaxel: 'tri_axle', 'tri axle': 'tri_axle',
      'tri-axle': 'tri_axle', traxle: 'tri_axle', '3 axle': 'tri_axle',
      'three axle': 'tri_axle',
      quad: 'quad_axle', 'quad axle': 'quad_axle', '4 axle': 'quad_axle',
      'end dump': 'end_dump', end: 'end_dump',
      'belly dump': 'belly_dump', belly: 'belly_dump',
      'side dump': 'side_dump', side: 'side_dump',
      super: 'super_dump', 'super dump': 'super_dump',
      transfer: 'transfer',
      '18 wheeler': '18_wheeler', semi: '18_wheeler',
    }
    const resolvedTruck = knownTrucks[lower] || knownTrucks[lower.replace(/s$/, '')] || extracted.truckType
    if (resolvedTruck) {
      await saveConversation(phone, { state: 'DISCOVERY', extracted_truck_type: resolvedTruck, extracted_city: conv?.extracted_city })
      const savedCity = conv?.extracted_city
      if (savedCity) {
        const jobs = await findNearbyJobs(savedCity, resolvedTruck)
        if (!jobs.length) {
          await saveConversation(phone, { state: 'DISCOVERY' })
          return `Nothing near ${savedCity} right now. Will hit you up when something opens`
        }
        await supabase.from('sms_sessions').upsert({ phone, state: 'JOBS_SHOWN', sites_shown: jobs.map(j => j.id), updated_at: new Date().toISOString() }, { onConflict: 'phone' })
        await saveConversation(phone, { state: 'JOBS_SHOWN', extracted_truck_type: resolvedTruck })
        return await buildJobListMessage(jobs, phone)
      }
      return 'What city you hauling from'
    }
    // Still can't figure out truck type — give them clear options
    return 'What type of truck? Reply: tandem, triaxle, quad, end dump, or belly dump'
  }

  // ── JOB SELECTION (driver replies 1-5) ────────────────────────────────────
  const jobChoice = parseInt(lower)
  if (!isNaN(jobChoice) && jobChoice >= 1 && jobChoice <= 5 && convState === 'JOBS_SHOWN') {
    const { data: sessionData } = await supabase
      .from('sms_sessions')
      .select('sites_shown')
      .eq('phone', phone)
      .maybeSingle()

    const shownJobIds: string[] = (sessionData as any)?.sites_shown || []
    const selectedJobId = shownJobIds[jobChoice - 1]

    if (!selectedJobId) return `Reply 1-${shownJobIds.length} to claim a job`

    const { data: order } = await supabase
      .from('dispatch_orders')
      .select('*, cities(name)')
      .eq('id', selectedJobId)
      .single()

    if (!order || !['dispatching', 'active', 'pending'].includes(order.status)) {
      return 'That job just got taken. Text your city again for new options'
    }

    // Atomic claim
    const reservationId = await atomicClaimJob(selectedJobId, phone, profile.user_id)
    if (!reservationId) {
      return 'Someone just grabbed that one. Text your city again'
    }

    const jobNum = generateJobNumber(selectedJobId)
    const city = (order.cities as any)?.name || ''
    const payDollars = Math.round(order.driver_pay_cents / 100)

    await saveConversation(phone, {
      state: 'PHOTO_PENDING',
      job_state: 'SITE_RESERVED',
      active_order_id: selectedJobId,
      reservation_id: reservationId
    })

    await logEvent('SITE_RESERVATION_CREATED', { phone, jobNum, city, reservationId }, selectedJobId)
    return `${jobNum} — ${city} — ${order.yards_needed} yds at $${payDollars}/load\nBefore I send the addy I need a pic of the first load so I can get final 10-4\nSend pic of dirt when ready`
  }

  // ── DISCOVERY / JOB MATCHING ───────────────────────────────────────────────
  // Only carry forward saved context if the message is job-related or we're mid-flow
  const isJobRelated = extracted.intent !== 'UNKNOWN' || extracted.city || extracted.yards || extracted.truckType
  const useConvContext = isJobRelated || convState === 'JOBS_SHOWN'
  const city = extracted.city || (useConvContext ? conv?.extracted_city : null)
  const yards = extracted.yards || (useConvContext ? conv?.extracted_yards : null)
  const truckType = extracted.truckType || (useConvContext ? conv?.extracted_truck_type : null)
  const material = extracted.material || (useConvContext ? conv?.extracted_material : null)

  const updates: Record<string, any> = { state: convState === 'JOBS_SHOWN' ? 'DISCOVERY' : convState }
  if (extracted.city) updates.extracted_city = extracted.city
  if (extracted.yards) updates.extracted_yards = extracted.yards
  if (extracted.truckType) updates.extracted_truck_type = extracted.truckType
  if (extracted.material) updates.extracted_material = extracted.material

  if (city) {

    if (!truckType) {
      await saveConversation(phone, { ...updates, state: 'DISCOVERY' })
      return `${city} got you — what type of truck you running`
    }

    const jobs = await findNearbyJobs(city, truckType)

    if (!jobs.length) {
      await saveConversation(phone, { ...updates, state: 'DISCOVERY' })
      return `Nothing available near ${city} right now. Got you on the list — will hit you up`
    }

    await supabase.from('sms_sessions').upsert({
      phone,
      state: 'JOBS_SHOWN',
      sites_shown: jobs.map(j => j.id),
      updated_at: new Date().toISOString()
    }, { onConflict: 'phone' })

    await saveConversation(phone, { ...updates, state: 'JOBS_SHOWN' })

    const jobList = await buildJobListMessage(jobs, phone)
    const yardsText = yards ? ` — ${yards} yds` : ''
    return `${city}${yardsText}\n\n${jobList}`
  }

  // No city extracted — ask for it
  await saveConversation(phone, { ...updates, state: 'DISCOVERY' })
  if (extracted.intent === 'NEED_DUMPSITE' || extracted.intent === 'HAUL_OFF' || lower.includes('load') || lower.includes('dirt') || lower.includes('dump')) {
    return 'What city you hauling from'
  }
  return 'Got a load to haul? Text your city when ready'
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
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

export const smsDispatchService = { handleIncoming: handleConversation, generateJobNumber, getDispatchStatus, redispatchOrder, cancelDispatch }
