import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { createAdminSupabase } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const MAX_BODY_BYTES = 64 * 1024

const CITY_CENTROIDS: Record<string, { lat: number; lng: number; state: string }> = {
  'dallas':           { lat: 32.7767, lng: -96.7970, state: 'TX' },
  'fort worth':       { lat: 32.7555, lng: -97.3308, state: 'TX' },
  'arlington':        { lat: 32.7357, lng: -97.1081, state: 'TX' },
  'plano':            { lat: 33.0198, lng: -96.6989, state: 'TX' },
  'frisco':           { lat: 33.1507, lng: -96.8236, state: 'TX' },
  'mckinney':         { lat: 33.1972, lng: -96.6397, state: 'TX' },
  'denton':           { lat: 33.2148, lng: -97.1331, state: 'TX' },
  'irving':           { lat: 32.8140, lng: -96.9489, state: 'TX' },
  'garland':          { lat: 32.9126, lng: -96.6389, state: 'TX' },
  'grand prairie':    { lat: 32.7459, lng: -96.9978, state: 'TX' },
  'mesquite':         { lat: 32.7668, lng: -96.5992, state: 'TX' },
  'carrollton':       { lat: 32.9537, lng: -96.8903, state: 'TX' },
  'lewisville':       { lat: 33.0462, lng: -96.9942, state: 'TX' },
  'allen':            { lat: 33.1032, lng: -96.6706, state: 'TX' },
  'richardson':       { lat: 32.9483, lng: -96.7299, state: 'TX' },
  'flower mound':     { lat: 33.0146, lng: -97.0970, state: 'TX' },
  'mansfield':        { lat: 32.5632, lng: -97.1417, state: 'TX' },
  'rowlett':          { lat: 32.9029, lng: -96.5639, state: 'TX' },
  'southlake':        { lat: 32.9412, lng: -97.1342, state: 'TX' },
  'keller':           { lat: 32.9347, lng: -97.2520, state: 'TX' },
  'burleson':         { lat: 32.5421, lng: -97.3209, state: 'TX' },
  'rockwall':         { lat: 32.9313, lng: -96.4597, state: 'TX' },
  'waxahachie':       { lat: 32.3866, lng: -96.8484, state: 'TX' },
  'midlothian':       { lat: 32.4824, lng: -96.9945, state: 'TX' },
  'weatherford':      { lat: 32.7593, lng: -97.7973, state: 'TX' },
  'prosper':          { lat: 33.2362, lng: -96.8011, state: 'TX' },
  'little elm':       { lat: 33.1626, lng: -96.9376, state: 'TX' },
  'forney':           { lat: 32.7480, lng: -96.4719, state: 'TX' },
  'denver':           { lat: 39.7392, lng: -104.9903, state: 'CO' },
  'aurora':           { lat: 39.7294, lng: -104.8319, state: 'CO' },
  'lakewood':         { lat: 39.7047, lng: -105.0814, state: 'CO' },
  'thornton':         { lat: 39.8680, lng: -104.9719, state: 'CO' },
  'arvada':           { lat: 39.8028, lng: -105.0875, state: 'CO' },
  'westminster':      { lat: 39.8367, lng: -105.0372, state: 'CO' },
  'centennial':       { lat: 39.5791, lng: -104.8769, state: 'CO' },
  'highlands ranch':  { lat: 39.5519, lng: -104.9690, state: 'CO' },
  'boulder':          { lat: 40.0150, lng: -105.2705, state: 'CO' },
  'littleton':        { lat: 39.6133, lng: -105.0166, state: 'CO' },
  'broomfield':       { lat: 39.9205, lng: -105.0867, state: 'CO' },
  'commerce city':    { lat: 39.8083, lng: -104.9339, state: 'CO' },
  'northglenn':       { lat: 39.8853, lng: -104.9872, state: 'CO' },
  'brighton':         { lat: 39.9853, lng: -104.8206, state: 'CO' },
  'golden':           { lat: 39.7555, lng: -105.2211, state: 'CO' },
  'erie':             { lat: 40.0503, lng: -105.0500, state: 'CO' },
  'longmont':         { lat: 40.1672, lng: -105.1019, state: 'CO' },
  'parker':           { lat: 39.5186, lng: -104.7614, state: 'CO' },
  'castle rock':      { lat: 39.3722, lng: -104.8561, state: 'CO' },
  'englewood':        { lat: 39.6480, lng: -104.9878, state: 'CO' },
  'wheat ridge':      { lat: 39.7661, lng: -105.0772, state: 'CO' },
}

const VALID_INTENTS = new Set([
  'need_dump', 'have_dirt', 'need_dirt', 'have_dump', 'noise', 'unclassified',
] as const)

const CLASSIFIER_PROMPT = `You are a Facebook post classifier for a dirt/fill logistics company. Extract structured data from the post.

Return ONLY valid JSON matching this schema — no markdown, no explanation:
{
  "intent": one of "need_dirt", "have_dirt", "need_dump", "have_dump", "noise", "unclassified",
  "material_type": string or null (e.g. "fill dirt", "topsoil", "structural fill", "select fill", "clean fill", "gravel"),
  "quantity_yards": number or null,
  "city": string or null (city name only, no state),
  "state": string or null (two-letter abbreviation),
  "urgency_days": integer or null (how soon they need it — 0 for ASAP/today, 1 for tomorrow, etc.),
  "phone_extracted": string or null (any phone number found in the post),
  "confidence": number between 0 and 1
}

Rules:
- "need_dirt" = someone looking to buy/receive dirt or fill material
- "have_dirt" = someone offering dirt or fill material
- "need_dump" = someone looking for a place to dump material
- "have_dump" = someone offering a dump site
- "noise" = clearly not related to dirt/fill/dump at all
- "unclassified" = possibly related but you cannot determine the intent with confidence
- The intent field MUST be exactly one of: need_dirt, have_dirt, need_dump, have_dump, noise, unclassified
- Extract phone numbers in any format found in the post
- If city is mentioned, normalize to proper case
- If quantity mentions "loads" or "trucks", estimate yards (1 load ≈ 10-18 yards)
- confidence should reflect how certain you are about the classification`

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ success: false, error: 'Body too large (64KB max)' }, { status: 413 })
    }

    let body: { post_text?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
    }

    const postText = body.post_text?.trim()
    if (!postText) {
      return NextResponse.json({ success: false, error: 'post_text is required' }, { status: 400 })
    }
    if (postText.length > 10000) {
      return NextResponse.json({ success: false, error: 'post_text too long (10000 char max)' }, { status: 400 })
    }

    // 1. Classify with Anthropic
    const anthropic = new Anthropic()
    let classifierResult: {
      intent: string
      material_type: string | null
      quantity_yards: number | null
      city: string | null
      state: string | null
      urgency_days: number | null
      phone_extracted: string | null
      confidence: number
    }

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: `${CLASSIFIER_PROMPT}\n\nPost:\n${postText}` }],
      }, { timeout: 20000 })

      const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
      classifierResult = JSON.parse(text)

      if (!VALID_INTENTS.has(classifierResult.intent as any)) {
        classifierResult.intent = 'unclassified'
      }
    } catch (e: any) {
      const isTimeout = e.message?.includes('timeout') || e.message?.includes('timed out')
      return NextResponse.json(
        { success: false, error: isTimeout ? 'Anthropic timeout (20s)' : `Classifier failed: ${e.message}` },
        { status: isTimeout ? 504 : 502 }
      )
    }

    // 2. Geocode via centroid lookup
    let lat: number | null = null
    let lng: number | null = null
    if (classifierResult.city) {
      const key = classifierResult.city.toLowerCase()
      const geo = CITY_CENTROIDS[key]
      if (geo) {
        lat = geo.lat
        lng = geo.lng
        if (!classifierResult.state) {
          classifierResult.state = geo.state
        }
      }
    }

    // 3. Insert into fb_signals
    const supabase = createAdminSupabase()
    const { data: signal, error: insertError } = await supabase
      .from('fb_signals')
      .insert({
        post_text: postText,
        capture_source: 'manual',
        intent: classifierResult.intent,
        material_type: classifierResult.material_type,
        quantity_yards: classifierResult.quantity_yards,
        city: classifierResult.city,
        state: classifierResult.state,
        lat,
        lng,
        urgency_days: classifierResult.urgency_days,
        phone_extracted: classifierResult.phone_extracted,
        confidence: classifierResult.confidence,
        classifier_version: 'claude-sonnet-4-6',
        classifier_raw: classifierResult,
        processed_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertError || !signal) {
      console.error('[fb-test] insert error:', insertError?.message)
      return NextResponse.json(
        { success: false, error: `Failed to insert signal: ${insertError?.message}` },
        { status: 500 }
      )
    }

    // 4. Run fb_match_signal RPC
    const { error: matchError } = await supabase.rpc('fb_match_signal', {
      p_signal_id: signal.id,
    })

    if (matchError) {
      console.error('[fb-test] match error:', matchError.message)
      return NextResponse.json(
        { success: false, error: `Match RPC failed: ${matchError.message}` },
        { status: 500 }
      )
    }

    // 5. Fetch matches joined to dispatch_orders
    const { data: matches, error: fetchError } = await supabase
      .from('fb_signal_matches')
      .select(`
        id,
        distance_miles,
        total_score,
        matched_order_id,
        dispatch_orders!fb_signal_matches_matched_order_id_fkey (
          client_name,
          city_id,
          yards_needed,
          material_type,
          status
        )
      `)
      .eq('signal_id', signal.id)
      .order('total_score', { ascending: false })
      .limit(10)

    if (fetchError) {
      console.error('[fb-test] fetch matches error:', fetchError.message)
      // Still return classifier results even if match fetch fails
      return NextResponse.json({
        success: true,
        signal_id: signal.id,
        classifier: classifierResult,
        matches: [],
        _warning: `Match fetch failed: ${fetchError.message}`,
      })
    }

    // 6. Resolve city names for matched orders
    const cityIds = new Set<string>()
    for (const m of matches || []) {
      const order = m.dispatch_orders as any
      if (order?.city_id) cityIds.add(order.city_id)
    }

    let cityMap: Record<string, string> = {}
    if (cityIds.size > 0) {
      const { data: cities } = await supabase
        .from('cities')
        .select('id, name')
        .in('id', Array.from(cityIds))

      if (cities) {
        cityMap = Object.fromEntries(cities.map(c => [c.id, c.name]))
      }
    }

    const formattedMatches = (matches || []).map(m => {
      const order = m.dispatch_orders as any
      return {
        match_id: m.id,
        distance_miles: m.distance_miles,
        total_score: m.total_score,
        client_name: order?.client_name ?? '—',
        delivery_city: order?.city_id ? (cityMap[order.city_id] ?? null) : null,
        yards_needed: order?.yards_needed ?? 0,
        material_type: order?.material_type ?? null,
        status: order?.status ?? '—',
      }
    })

    return NextResponse.json({
      success: true,
      signal_id: signal.id,
      classifier: classifierResult,
      matches: formattedMatches,
    })
  } catch (e: any) {
    console.error('[fb-test] unhandled error:', e.message)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
