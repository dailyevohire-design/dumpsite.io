/**
 * Synthetic Twilio webhook harness for the Jesse driver SMS dispatch pipeline.
 *
 * Posts fake Twilio form payloads at /api/sms/webhook to exercise the 25 fixes
 * end-to-end without sending real Twilio messages.
 *
 * Run against a local dev server:
 *   bun run dev    # in another terminal
 *   bun scripts/test-jesse-webhook.ts
 *
 * Or against a custom URL:
 *   TARGET_URL=https://staging.dumpsite.io bun scripts/test-jesse-webhook.ts
 *
 * IMPORTANT: do NOT run against production. The webhook validates Twilio
 * signatures in production and will 401. The harness skips signing, so it
 * only works against NODE_ENV !== 'production'.
 *
 * Test phones use the +1555555xxxx range so they cannot collide with real
 * drivers. After the run, clean up with:
 *   DELETE FROM conversations WHERE phone LIKE '555555%';
 *   DELETE FROM sms_logs WHERE phone LIKE '555555%';
 */

const TARGET = process.env.TARGET_URL || 'http://localhost:3000'
const WEBHOOK = `${TARGET}/api/sms/webhook`

type WebhookResult = { status: number; body: string }

async function post(params: Record<string, string>): Promise<WebhookResult> {
  const form = new URLSearchParams(params)
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  return { status: res.status, body: await res.text() }
}

function makePayload(phone: string, body: string, opts: { mediaUrl?: string; numMedia?: number } = {}) {
  return {
    From: `+1${phone}`,
    To: '+17205943881',
    Body: body,
    MessageSid: `SMtest${Date.now()}${Math.floor(Math.random() * 10000)}`,
    NumMedia: String(opts.numMedia ?? 0),
    ...(opts.mediaUrl ? { MediaUrl0: opts.mediaUrl, MediaContentType0: 'image/jpeg' } : {}),
  }
}

let passed = 0
let failed = 0
const failures: string[] = []

async function scenario(name: string, fn: () => Promise<void>) {
  process.stdout.write(`▶ ${name} ... `)
  try {
    await fn()
    console.log('✓')
    passed++
  } catch (err) {
    console.log('✗')
    const msg = err instanceof Error ? err.message : String(err)
    failures.push(`${name}: ${msg}`)
    failed++
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Target: ${WEBHOOK}\n`)

  // Smoke test — webhook is reachable
  await scenario('webhook is reachable', async () => {
    const res = await fetch(WEBHOOK)
    assert(res.ok, `GET returned ${res.status}`)
  })

  // 1. Normal happy-path message — driver pings, gets a 200
  await scenario('normal inbound returns 200 + TwiML', async () => {
    const r = await post(makePayload('5555550001', 'hey'))
    assert(r.status === 200, `expected 200, got ${r.status}`)
    assert(r.body.includes('<Response'), 'expected TwiML response')
  })

  // 2. Rapid-fire concurrent messages from one driver (fix #1: per-phone lock)
  // Send 5 messages in parallel and assert all return 200 — none should crash
  // and only one conversation row should exist after.
  await scenario('rapid-fire concurrent messages all return 200', async () => {
    const phone = '5555550002'
    const sends = [
      post(makePayload(phone, 'I got 10')),
      post(makePayload(phone, 'yards')),
      post(makePayload(phone, 'in fort worth')),
      post(makePayload(phone, 'dirt')),
      post(makePayload(phone, 'today')),
    ]
    const results = await Promise.all(sends)
    for (const r of results) {
      assert(r.status === 200, `got ${r.status}`)
    }
  })

  // 3. Zero-jobs-in-area — driver in a city with no jobs (fix #4)
  // Should NOT hallucinate via Sonnet — should return template-driven reply.
  await scenario('zero-job city does not 500', async () => {
    const r = await post(makePayload('5555550003', 'I have 5 yards in Bismarck North Dakota'))
    assert(r.status === 200, `got ${r.status}`)
  })

  // 4. Language detection mid-thread (fix #6: sticky language)
  // Spanish message followed by a number — number must not flip language to English.
  await scenario('language flip: spanish then number', async () => {
    const phone = '5555550004'
    const r1 = await post(makePayload(phone, 'hola tengo 10 yardas'))
    assert(r1.status === 200, `first msg ${r1.status}`)
    await sleep(200)
    const r2 = await post(makePayload(phone, '100'))
    assert(r2.status === 200, `second msg ${r2.status}`)
  })

  // 5. Multi-photo MMS in one webhook batch (fix #20)
  await scenario('multi-photo MMS does not crash', async () => {
    const phone = '5555550005'
    const r = await post({
      ...makePayload(phone, '', { mediaUrl: 'https://example.com/photo.jpg', numMedia: 3 }),
      MediaUrl1: 'https://example.com/photo2.jpg',
      MediaContentType1: 'image/jpeg',
      MediaUrl2: 'https://example.com/photo3.jpg',
      MediaContentType2: 'image/jpeg',
    })
    assert(r.status === 200, `got ${r.status}`)
  })

  // 6. STOP keyword (driver opt-out)
  await scenario('STOP keyword returns 200', async () => {
    const r = await post(makePayload('5555550006', 'STOP'))
    assert(r.status === 200, `got ${r.status}`)
  })

  // 7. Empty body (Twilio sometimes sends these on delivery receipts)
  await scenario('empty body does not 500', async () => {
    const r = await post(makePayload('5555550007', ''))
    assert(r.status === 200, `got ${r.status}`)
  })

  // 8. Missing From header (malformed Twilio payload)
  await scenario('missing From returns empty TwiML not 500', async () => {
    const r = await post({
      Body: 'hi',
      MessageSid: `SMtest${Date.now()}`,
      NumMedia: '0',
      To: '+17205943881',
    })
    assert(r.status === 200, `got ${r.status}`)
  })

  // 9. Numeric-only reply (fix #6 + parseLoads cap)
  await scenario('numeric-only reply', async () => {
    const r = await post(makePayload('5555550009', '50'))
    assert(r.status === 200, `got ${r.status}`)
  })

  // 10. Long address with notes
  await scenario('long address inbound', async () => {
    const r = await post(makePayload(
      '5555550010',
      '1234 Main St Fort Worth TX 76102 — back gate, ask for Mike, dump trucks only'
    ))
    assert(r.status === 200, `got ${r.status}`)
  })

  // ──────────────────────────────────────────────────────────────────────────

  console.log(`\nResult: ${passed} passed, ${failed} failed`)
  if (failures.length) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
  console.log('\nClean up test data with:')
  console.log("  DELETE FROM conversations WHERE phone LIKE '555555%';")
  console.log("  DELETE FROM sms_logs WHERE phone LIKE '555555%';")
}

main().catch(err => {
  console.error('Harness crashed:', err)
  process.exit(1)
})
