require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const twilio = require('twilio')
const crypto = require('crypto')

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const tc = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
const FROM = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER
const DRIVER = '+17134439223'
const CUSTOMER = '+18178286354'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'

const sleep = ms => new Promise(r => setTimeout(r, ms))

let passed = 0, failed = 0, warnings = 0
const results = []

function log(status, scenario, detail) {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⚠'
  console.log(`${icon} [${status}] ${scenario}`)
  if (detail) console.log(`   ${detail}`)
  results.push({ status, scenario, detail })
  if (status === 'PASS') passed++
  else if (status === 'FAIL') failed++
  else warnings++
}

function signTwilio(url, paramObj) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const sortedKeys = Object.keys(paramObj).sort()
  let data = url
  for (const key of sortedKeys) data += key + paramObj[key]
  return crypto.createHmac('sha1', authToken).update(data).digest('base64')
}

async function hitWebhook(from, body, mediaUrl = null) {
  try {
    const paramObj = {
      From: from,
      Body: body,
      MessageSid: 'SIM' + Date.now() + Math.random().toString(36).slice(2,8).toUpperCase(),
      NumMedia: mediaUrl ? '1' : '0',
    }
    if (mediaUrl) paramObj.MediaUrl0 = mediaUrl

    const webhookUrl = `${APP_URL}/api/sms/webhook`
    const signature = signTwilio(webhookUrl, paramObj)
    const params = new URLSearchParams(paramObj)

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': signature,
      },
      body: params.toString()
    })
    const text = await resp.text()
    if (resp.status !== 200) console.log(`  [HTTP ${resp.status}] ${text.slice(0,100)}`)
    const match = text.match(/<Message>([\s\S]*?)<\/Message>/)
    const msg = match ? match[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim() : ''
    if (!msg && text.length > 0) console.log(`  [RAW] ${text.slice(0,200)}`)
    return msg
  } catch(e) {
    return 'ERROR: ' + e.message
  }
}

async function getConv(phone) {
  const normalized = phone.replace(/^\+1/, '').replace(/\D/g,'')
  const { data } = await s.from('conversations').select('*').eq('phone', normalized).maybeSingle()
  return data
}

async function resetDriver() {
  const normalized = DRIVER.replace(/^\+1/, '').replace(/\D/g,'')
  await s.from('conversations').upsert({
    phone: normalized, state: 'DISCOVERY', job_state: 'NONE',
    active_order_id: null, pending_approval_order_id: null,
    reservation_id: null, extracted_city: null, extracted_yards: null,
    extracted_truck_type: null, extracted_material: null,
    photo_storage_path: null, photo_public_url: null,
    approval_sent_at: null, voice_call_made: false,
    updated_at: new Date().toISOString()
  }, { onConflict: 'phone' })
  await s.from('site_reservations').update({ status: 'released' }).eq('status', 'active')
  await s.from('load_requests').update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('driver_id', (await s.from('driver_profiles').select('user_id').eq('phone', normalized).maybeSingle())?.data?.user_id)
    .in('status', ['pending','approved','in_progress'])
}

async function setActiveJob(orderId) {
  const normalized = DRIVER.replace(/^\+1/, '').replace(/\D/g,'')
  const { data: driver } = await s.from('driver_profiles').select('user_id').eq('phone', normalized).maybeSingle()
  if (!driver) return null
  
  const { data: load } = await s.from('load_requests').insert({
    driver_id: driver.user_id,
    dispatch_order_id: orderId,
    status: 'approved',
    yards_estimated: 24,
    idempotency_key: `${driver.user_id}-${orderId}-test-${Date.now()}`
  }).select('id').single()

  await s.from('conversations').upsert({
    phone: normalized, state: 'ACTIVE', job_state: 'IN_PROGRESS',
    active_order_id: orderId, updated_at: new Date().toISOString()
  }, { onConflict: 'phone' })
  
  return load?.id
}

async function runSimulation() {
  console.log('\n' + '='.repeat(60))
  console.log('DUMPSITE.IO SMS AUTOPILOT — FULL SIMULATION')
  console.log('Driver:', DRIVER, '| Customer:', CUSTOMER)
  console.log('Target:', APP_URL)
  console.log('='.repeat(60) + '\n')

  console.log('── PRE-FLIGHT CHECKS ──')
  try {
    const health = await fetch(`${APP_URL}/api/health`)
    log('PASS', 'Vercel reachable', `Status: ${health.status}`)
  } catch(e) {
    log('FAIL', 'Vercel not reachable', e.message)
    process.exit(1)
  }

  try {
    const acct = await tc.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch()
    log('PASS', 'Twilio credentials valid', `Account: ${acct.friendlyName}`)
  } catch(e) {
    log('FAIL', 'Twilio credentials invalid', e.message)
  }

  if (FROM && FROM.length > 8) {
    log('PASS', 'FROM number set', FROM)
  } else {
    log('FAIL', 'FROM number missing', 'TWILIO_FROM_NUMBER_2 not set in env')
  }

  const { data: driver } = await s.from('driver_profiles').select('user_id, first_name, status')
    .eq('phone', DRIVER.replace(/^\+1/,''))
    .maybeSingle()
  if (driver) {
    log('PASS', 'Driver profile exists', `${driver.first_name} — ${driver.status}`)
  } else {
    log('FAIL', 'Driver profile missing', 'Run signup flow first')
  }

  const { data: orders } = await s.from('dispatch_orders')
    .select('id, client_phone, client_name, yards_needed, delivery_latitude, delivery_longitude')
    .in('status', ['dispatching','active','pending'])
    .not('delivery_latitude', 'is', null)
    .limit(5)
  if (orders?.length) {
    log('PASS', 'Open orders available', `${orders.length} orders with coordinates`)
  } else {
    log('WARN', 'No geocoded orders', 'Jobs may not show in proximity search')
  }

  const testOrder = orders?.[0]

  if (testOrder?.client_phone) {
    log('PASS', 'Test order has customer phone', `${testOrder.client_name}: ${testOrder.client_phone}`)
  } else {
    log('WARN', 'Test order missing client_phone', 'Customer approval flow cannot be tested')
  }

  console.log('\n── SCENARIO TESTS ──\n')
  await sleep(1000)

  // A
  console.log('A. FRESH GREETING')
  await resetDriver()
  const helloReply = await hitWebhook(DRIVER, 'hello')
  if (helloReply && !helloReply.includes('Open jobs') && !helloReply.includes('Site 1') && helloReply.length > 0) {
    log('PASS', 'hello → no auto job dump', helloReply.slice(0,80))
  } else if (helloReply.includes('Open jobs') || helloReply.includes('Site 1')) {
    log('FAIL', 'hello → dumped job list', helloReply.slice(0,80))
  } else {
    log('WARN', 'hello → unexpected reply', helloReply.slice(0,80))
  }
  await sleep(2000)

  // B
  console.log('\nB. CITY + TRUCK DETECTION')
  await resetDriver()
  const cityReply = await hitWebhook(DRIVER, 'I got a load ready in Dallas')
  if (cityReply && (cityReply.toLowerCase().includes('truck') || cityReply.toLowerCase().includes('tandem') || cityReply.toLowerCase().includes('running'))) {
    log('PASS', 'Dallas detected → asking truck type', cityReply.slice(0,80))
  } else {
    log('WARN', 'City detection result', cityReply.slice(0,80))
  }
  await sleep(2000)

  // C
  console.log('\nC. TRUCK TYPE VARIANTS')
  const truckTests = [
    { input: 'tandem', expect: 'job list' },
    { input: 'triaxle', expect: 'job list' },
    { input: 'triaxel', expect: 'job list' },
    { input: 'quad', expect: 'job list' },
    { input: 'end dump', expect: 'job list' },
    { input: 'belly dump', expect: 'job list' },
  ]
  
  for (const tt of truckTests) {
    await resetDriver()
    await hitWebhook(DRIVER, 'got a load in Dallas')
    await sleep(1500)
    const truckReply = await hitWebhook(DRIVER, tt.input)
    const hasJobs = truckReply && (truckReply.includes('yds') || truckReply.includes('load') || truckReply.includes('Dallas') || truckReply.includes('Reply 1'))
    const askedCityAgain = truckReply && truckReply.toLowerCase().includes('city')
    if (hasJobs && !askedCityAgain) {
      log('PASS', `truck "${tt.input}" → shows jobs`, truckReply.slice(0,60))
    } else if (askedCityAgain) {
      log('FAIL', `truck "${tt.input}" → asked city again`, truckReply.slice(0,60))
    } else {
      log('WARN', `truck "${tt.input}" → unexpected`, truckReply.slice(0,60))
    }
    await sleep(1500)
  }

  // D
  console.log('\nD. COMPLETION PHRASE VARIANTS')
  if (!testOrder) {
    log('WARN', 'Skipping completion tests', 'No test order available')
  } else {
    const completionTests = [
      '6',
      'done 3',
      'dropped 5 loads',
      'dumped 4',
      'finished',
      "that's it for today",
      'done for the day bro',
    ]

    for (const phrase of completionTests) {
      await resetDriver()
      await setActiveJob(testOrder.id)
      await sleep(500)
      const reply = await hitWebhook(DRIVER, phrase)
      const isCompletion = reply && (
        reply.includes('otw') || reply.includes('coming') ||
        reply.includes('10.4') || reply.includes('load') ||
        reply.includes('sent') || reply.includes('paid')
      )
      const isBotError = reply && (
        reply.includes('got a load') || reply.includes('what city') ||
        reply.includes('No active job') || reply.includes('active approved')
      )
      if (isCompletion) {
        log('PASS', `"${phrase}" → completion recognized`, reply.slice(0,60))
      } else if (isBotError) {
        log('FAIL', `"${phrase}" → not recognized as completion`, reply.slice(0,60))
      } else {
        log('WARN', `"${phrase}" → unexpected reply`, reply.slice(0,60))
      }
      await sleep(1500)
    }
  }

  // E
  console.log('\nE. ADDRESS REQUEST WHILE ACTIVE')
  if (testOrder) {
    await resetDriver()
    await setActiveJob(testOrder.id)
    await sleep(500)
    const addrTests = ['addy?', 'where do i go', 'send address', "what's the address"]
    for (const addrText of addrTests) {
      const reply = await hitWebhook(DRIVER, addrText)
      const hasAddress = reply && reply.match(/\d+\s+\w+.*\w{2}\s+\d{5}/)
      if (hasAddress) {
        log('PASS', `"${addrText}" → returns address`, reply.slice(0,60))
      } else {
        log('WARN', `"${addrText}" → no address found`, reply.slice(0,60))
      }
      await sleep(1000)
    }
  }

  // F
  console.log('\nF. STATUS COMMAND')
  await resetDriver()
  if (testOrder) {
    await setActiveJob(testOrder.id)
    const statusReply = await hitWebhook(DRIVER, 'STATUS')
    if (statusReply && (statusReply.includes('DS-') || statusReply.includes('active'))) {
      log('PASS', 'STATUS shows active job', statusReply.slice(0,80))
    } else {
      log('WARN', 'STATUS reply', statusReply.slice(0,80))
    }
  }

  // G
  console.log('\nG. CANCEL COMMAND')
  await resetDriver()
  if (testOrder) {
    await setActiveJob(testOrder.id)
    const cancelReply = await hitWebhook(DRIVER, 'CANCEL')
    if (cancelReply && cancelReply.toLowerCase().includes('cancel')) {
      log('PASS', 'CANCEL → job cancelled', cancelReply.slice(0,80))
    } else {
      log('WARN', 'CANCEL reply', cancelReply.slice(0,80))
    }
  }

  // H
  console.log('\nH. DUPLICATE MESSAGE DEDUP')
  await resetDriver()
  const sid = 'SIMDEDUP' + Date.now()
  const r1 = await hitWebhook(DRIVER, 'hello', null)
  const dedupParams = { From: DRIVER, Body: 'hello', MessageSid: sid, NumMedia: '0' }
  const dedupUrl = `${APP_URL}/api/sms/webhook`
  const dedupSig = signTwilio(dedupUrl, dedupParams)
  const dedupBody = new URLSearchParams(dedupParams).toString()
  const dedupHeaders = { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': dedupSig }
  const d1 = await fetch(dedupUrl, { method: 'POST', headers: dedupHeaders, body: dedupBody }).then(r => r.text())
  const d2 = await fetch(dedupUrl, { method: 'POST', headers: dedupHeaders, body: dedupBody }).then(r => r.text())
  const d1msg = d1.match(/<Message>([\s\S]*?)<\/Message>/)?.[1] || ''
  const d2msg = d2.match(/<Message>([\s\S]*?)<\/Message>/)?.[1] || ''
  if (!d2msg || d2msg.trim() === '') {
    log('PASS', 'Duplicate message deduped', 'Second identical SID returned empty')
  } else {
    log('FAIL', 'Duplicate NOT deduped', 'Same SID processed twice')
  }

  // I
  console.log('\nI. OPT-OUT (STOP)')
  await resetDriver()
  const stopReply = await hitWebhook(DRIVER, 'STOP')
  if (!stopReply || stopReply.trim() === '<Response></Response>' || stopReply.trim() === '') {
    log('PASS', 'STOP → empty response', 'No reply sent to opted-out user')
  } else {
    log('WARN', 'STOP reply was not empty', stopReply.slice(0,60))
  }
  await s.from('driver_profiles').update({ sms_opted_out: false }).eq('phone', DRIVER.replace(/^\+1/,''))

  // J
  console.log('\nJ. HIGH VALUE JOB (500+ yards)')
  await resetDriver()
  const highValReply = await hitWebhook(DRIVER, 'Dallas 500 yards end dump')
  if (highValReply && highValReply.length > 0) {
    log('PASS', '500 yards message handled', highValReply.slice(0,80))
  } else {
    log('FAIL', '500 yards → no response', '')
  }

  // K
  console.log('\nK. CUSTOMER APPROVAL FLOW')
  if (testOrder) {
    await resetDriver()
    const normalized = DRIVER.replace(/^\+1/,'').replace(/\D/g,'')
    await s.from('conversations').upsert({
      phone: normalized,
      state: 'APPROVAL_PENDING',
      job_state: 'AWAITING_FIRST_LOAD_APPROVAL',
      active_order_id: testOrder.id,
      pending_approval_order_id: testOrder.id,
      approval_sent_at: new Date().toISOString(),
      photo_public_url: 'https://agsjodzzjrnqdopysjbb.supabase.co/storage/v1/object/public/material-photos/test.jpg',
      updated_at: new Date().toISOString()
    }, { onConflict: 'phone' })
    await sleep(500)

    // Use the ACTUAL customer phone from the test order, not the hardcoded CUSTOMER
    const rawClientPhone = testOrder.client_phone || ''
    const clientDigits = rawClientPhone.replace(/\D/g, '')
    const customerPhone = clientDigits.length === 10 ? `+1${clientDigits}` : `+${clientDigits}`
    console.log(`  Using customer phone from order: ${customerPhone}`)
    const yesReply = await hitWebhook(customerPhone, 'YES')
    await sleep(2000)
    const driverConv = await getConv(normalized)
    if (driverConv?.state === 'ACTIVE') {
      log('PASS', 'Customer YES → approval flow triggered', `Conv state: ${driverConv?.state}, reply: ${yesReply?.slice(0,40)}`)
    } else {
      log('WARN', 'Customer approval result unclear', `Conv state: ${driverConv?.state}, reply: ${yesReply?.slice(0,40)}`)
    }
  }

  // SUMMARY
  console.log('\n' + '='.repeat(60))
  console.log('SIMULATION COMPLETE')
  console.log('='.repeat(60))
  console.log(`✓ PASSED:  ${passed}`)
  console.log(`✗ FAILED:  ${failed}`)
  console.log(`⚠ WARNED:  ${warnings}`)
  console.log('='.repeat(60))

  if (failed > 0) {
    console.log('\nFAILED SCENARIOS:')
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ✗ ${r.scenario}`)
      if (r.detail) console.log(`    → ${r.detail}`)
    })
  }

  if (warnings > 0) {
    console.log('\nWARNINGS:')
    results.filter(r => r.status === 'WARN').forEach(r => {
      console.log(`  ⚠ ${r.scenario}`)
      if (r.detail) console.log(`    → ${r.detail}`)
    })
  }

  console.log('\nCleaning up test data...')
  await resetDriver()
  console.log('Done.')
}

runSimulation().catch(e => {
  console.error('SIMULATION ERROR:', e.message)
  process.exit(1)
})
