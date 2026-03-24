import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'AI parsing not configured. Add ANTHROPIC_API_KEY to Vercel.' },
      { status: 503 }
    )
  }

  let body: { text?: string; images?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { text, images } = body

  if (!text && (!images || images.length === 0)) {
    return NextResponse.json(
      { error: 'Please provide text or images' },
      { status: 400 }
    )
  }

  const messageContent: Array<Record<string, unknown>> = []

  if (Array.isArray(images) && images.length > 0) {
    for (const img of images.slice(0, 10)) {
      if (typeof img !== 'string' || !img) continue
      let mediaType = 'image/jpeg'
      if (img.startsWith('data:image/png')) mediaType = 'image/png'
      else if (img.startsWith('data:image/webp')) mediaType = 'image/webp'
      const data = img.includes(',') ? img.split(',')[1] : img
      if (!data) continue
      messageContent.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data }
      })
    }
  }

  messageContent.push({
    type: 'text',
    text: text
      ? `Extract all orders from this text:\n\n${String(text).slice(0, 8000)}`
      : 'Extract all orders from the screenshots above.'
  })

  const systemPrompt = `You are a data extraction assistant for DumpSite.io, a dirt hauling logistics platform in DFW Texas.
Extract order details from text messages or screenshots.

PRICING RULES — this is revenue critical, get it right:
- price_per_load is what the CLIENT pays per load (not driver pay)
- "$X per yd" means multiply X by 12: $15/yd = $180 per load
- "$X per 12 yd" means X is the per-load price: $144/12yd = $144
- "$X per 20 yd" means X is the per-load price: $240/20yd = $240
- "$X per truck" means X is the per-load price
- No price mentioned: pricePerLoad = null

YARDS:
- X loads tandem = X times 12
- X loads end dump = X times 20
- Range 60-80: use midpoint 70
- "a few loads": use 36
- "4-5 loads": use 54

TRUCK TYPE:
- 100+ yards: end_dump
- Under 100: tandem_axle
- Mentions end dump/18-wheeler/semi: end_dump
- Default: tandem_axle

CONFIDENCE:
- high: clearly stated
- medium: inferred
- low: missing or unclear

SKIP: delivered orders, price-only inquiries

DFW cities: Dallas, Fort Worth, Arlington, Plano, Irving, Garland, McKinney, Mesquite, Denton, Carrollton, Grand Prairie, Frisco, Midlothian, Cleburne, Mansfield, Azle, Joshua, Venus, Ponder, Hutchins, Everman, Colleyville, Terrell, Kaufman, Hillsboro, Gainesville, Cedar Hill, DeSoto, Rockwall, Little Elm, Lewisville, Keller, Southlake, Grapevine, Euless, Bedford, Haltom City, Allen, Wylie, Sachse, Rowlett, Lancaster, Duncanville, Waxahachie, Ennis, Justin, Lake Worth, Haslet, Alvarado, Ferris, Mabank, Princeton, Denison, Bonham, Corsicana, Burleson, Weatherford, Flower Mound, Crowley, Granbury, Mineral Wells, Prosper, Celina, Forney, Saginaw, Benbrook, White Settlement, North Richland Hills, Hurst, Coppell, Kennedale, Red Oak, Glenn Heights, Wilmer, Sherman, Pilot Point, Sanger, Aubrey, Melissa, Anna, Van Alstyne, Argyle, Corinth, Highland Village, The Colony, Roanoke, Trophy Club, Lake Dallas, Cross Roads, Krum, Greenville, Royse City, Fate, Heath, Lavon, Nevada, Caddo Mills, Quinlan, Farmersville, Crandall, Wills Point, Canton, Palmer, Garrett, Bardwell, Kemp, Itasca, Rio Vista, Grandview, Keene, Glen Rose, Cresson, Aledo, Willow Park, Hudson Oaks, Springtown, Millsap, Decatur, Bridgeport, Rhome, Newark, Boyd, Paradise, Richardson, Addison, Farmers Branch, Murphy, Balch Springs, Seagoville, Sunnyvale, Forest Hill, River Oaks, Watauga, Richland Hills, Pantego, Ovilla, Combine

Return ONLY a JSON array. No markdown. No backticks. Start with [ end with ]

[{
  "clientName": "string or null",
  "clientPhone": "digits only or null",
  "clientAddress": "string or null",
  "cityName": "city name only or null",
  "yardsNeeded": number or null,
  "pricePerLoad": number or null,
  "truckTypeNeeded": "tandem_axle or end_dump",
  "notes": "string or null",
  "isDelivered": false,
  "confidence": {
    "clientName": "high|medium|low",
    "clientPhone": "high|medium|low",
    "clientAddress": "high|medium|low",
    "cityName": "high|medium|low",
    "yardsNeeded": "high|medium|low",
    "pricePerLoad": "high|medium|low"
  },
  "overallConfidence": "high|medium|low",
  "reviewNotes": "string or null"
}]`

  let claudeRes: Response
  try {
    claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: messageContent }]
      })
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error('Claude API network error:', msg)
    return NextResponse.json(
      { error: 'AI service unavailable. Please try again.' },
      { status: 503 }
    )
  }

  if (!claudeRes.ok) {
    const errText = await claudeRes.text().catch(() => '')
    console.error('Claude API error:', claudeRes.status, errText.slice(0, 200))
    return NextResponse.json(
      { error: 'AI parsing failed. Please try again.' },
      { status: 500 }
    )
  }

  let aiData: { content?: Array<{ type: string; text?: string }> }
  try {
    aiData = await claudeRes.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid AI response.' },
      { status: 500 }
    )
  }

  const raw = aiData?.content?.[0]?.text || ''
  let orders: unknown[]
  try {
    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim()
    const parsed: unknown = JSON.parse(cleaned)
    orders = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    console.error('JSON parse error. Raw:', raw.slice(0, 300))
    return NextResponse.json(
      { error: 'AI returned unexpected format. Please try again.' },
      { status: 500 }
    )
  }

  const active = (orders as Array<Record<string, unknown>>).filter(o => !o.isDelivered)
  const skipped = orders.length - active.length

  return NextResponse.json({
    success: true,
    orders: active,
    total: active.length,
    skipped,
    skippedReason: skipped > 0
      ? `${skipped} delivered/price-only order(s) skipped`
      : null
  })
}
