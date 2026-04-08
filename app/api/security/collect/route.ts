import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { sendSecurityAlert } from '@/lib/sms'

const ALLOWED_TYPES = new Set([
  'fingerprint',
  'behavior',
  'honeypot_form',
  'csp_violation',
  'address_leak',
])

// Always-alert events (any occurrence is critical)
const CRITICAL = new Set(['honeypot_form', 'address_leak'])

// Bot signal weights — confidence is the max weight of any tripped signal
const BOT_WEIGHTS: Record<string, number> = {
  webdriver: 0.95,
  'headless-ua': 0.9,
  'zero-viewport': 0.7,
  'no-languages': 0.5,
  'no-plugins': 0.3,
}

function botConfidence(payload: any): number {
  const signals: string[] = Array.isArray(payload?.signals) ? payload.signals : []
  if (signals.length === 0) return 0
  return signals.reduce((max, s) => Math.max(max, BOT_WEIGHTS[s] || 0.2), 0)
}

// Dedupe: skip alert if same ip+event_type fired in the last hour
async function alreadyAlerted(
  supabase: ReturnType<typeof createAdminSupabase>,
  ip: string,
  eventType: string,
): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('security_events')
    .select('id')
    .eq('ip', ip)
    .eq('event_type', eventType)
    .eq('alerted', true)
    .gte('created_at', oneHourAgo)
    .limit(1)
  return !!(data && data.length > 0)
}

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'
    const userAgent = request.headers.get('user-agent') || null
    const country = request.headers.get('x-vercel-ip-country') || null
    const city = request.headers.get('x-vercel-ip-city') || null

    let body: Record<string, any> = {}
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
    }

    const eventType = String(body.eventType || '')
    if (!ALLOWED_TYPES.has(eventType)) {
      return NextResponse.json({ success: false, error: 'Invalid eventType' }, { status: 400 })
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : null
    const url = typeof body.url === 'string' ? body.url.slice(0, 500) : null
    const payload =
      body.fingerprint || body.behavior || body.honeypot || body.csp || body.leak || null

    // Decide whether to alert
    let shouldAlert = false
    let alertReason = ''
    let confidence: number | null = null

    if (CRITICAL.has(eventType)) {
      shouldAlert = true
      alertReason = eventType
    } else if (eventType === 'fingerprint') {
      confidence = botConfidence(payload)
      if (confidence >= 0.7) {
        shouldAlert = true
        alertReason = `bot conf=${confidence.toFixed(2)}`
      }
    }

    const supabase = createAdminSupabase()

    // Dedupe before sending
    if (shouldAlert && (await alreadyAlerted(supabase, ip, eventType))) {
      shouldAlert = false
    }

    const { error } = await supabase.from('security_events').insert({
      event_type: eventType,
      session_id: sessionId,
      url,
      ip,
      user_agent: userAgent,
      country,
      city,
      payload,
      bot_confidence: confidence,
      alerted: shouldAlert,
    })

    if (error) {
      console.error('[security/collect] insert error:', error.message, { eventType })
      return NextResponse.json({ success: false, error: 'Failed to log' }, { status: 500 })
    }

    if (shouldAlert) {
      // Loud log so Sentry catches it too
      console.error('[security/collect] CRITICAL:', alertReason, { ip, url, eventType })

      // MUST await — Vercel kills unawaited promises (per CLAUDE.md)
      const summary =
        eventType === 'address_leak'
          ? `address leak on ${payload?.path || url}: "${payload?.match || '?'}"`
          : eventType === 'honeypot_form'
            ? `honeypot tripped: ${payload?.field || '?'}=${payload?.value || '?'} on ${url}`
            : `bot detected (conf ${confidence?.toFixed(2)}) on ${url} ip=${ip}`

      const result = await sendSecurityAlert(summary)
      if (!result.success) {
        console.error('[security/collect] alert SMS failed:', result.error)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[security/collect] unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
