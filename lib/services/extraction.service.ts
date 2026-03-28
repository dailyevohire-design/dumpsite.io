import Anthropic from '@anthropic-ai/sdk'

export interface ExtractionResult {
  intent: 'NEED_DUMPSITE' | 'HAUL_OFF' | 'STATUS_UPDATE' | 'APPROVAL_PHOTO' | 'ADDRESS_REQUEST' | 'DONE_REPORT' | 'CANCEL' | 'OPTOUT' | 'HELP' | 'ADMIN_APPROVE' | 'ADMIN_REJECT' | 'CUSTOMER_APPROVE' | 'CUSTOMER_REJECT' | 'UNKNOWN'
  city: string | null
  yards: number | null
  truckType: string | null
  material: string | null
  loadCount: number | null
  hasPhoto: boolean
  approvalCode: string | null
  requiresEscalation: boolean
  confidence: number
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function extractIntent(
  text: string,
  hasMedia: boolean,
  context: { activeJobId?: string; lastKnownCity?: string; isAdmin?: boolean; isCustomer?: boolean }
): Promise<ExtractionResult> {
  try {
    const systemPrompt = `You extract structured data from dirt hauling SMS messages. Return ONLY valid JSON.

Context: ${JSON.stringify(context)}
Has media/photo attached: ${hasMedia}

Return this exact JSON structure:
{
  "intent": "NEED_DUMPSITE|HAUL_OFF|STATUS_UPDATE|APPROVAL_PHOTO|ADDRESS_REQUEST|DONE_REPORT|CANCEL|OPTOUT|HELP|ADMIN_APPROVE|ADMIN_REJECT|CUSTOMER_APPROVE|CUSTOMER_REJECT|UNKNOWN",
  "city": "city name or null",
  "yards": number or null,
  "truckType": "tandem_axle|tri_axle|quad_axle|end_dump|super_dump|belly_dump|side_dump|transfer|18_wheeler|null",
  "material": "clean_fill|clay|sandy_loam|caliche|topsoil|mixed|concrete|rock|null",
  "loadCount": number or null,
  "hasPhoto": true/false,
  "approvalCode": "DS-XXXXXX from APPROVE-DS-XXXXXX or REJECT-DS-XXXXXX patterns, or null",
  "requiresEscalation": true if yards >= 500,
  "confidence": 0.0-1.0
}

Rules:
- "fill dirt", "fill", "dirt", "clean" = clean_fill
- "done 3", "dumped 3", "finished 3" = DONE_REPORT with loadCount=3
- "addy?", "send address", "where do i go" = ADDRESS_REQUEST
- "yes", "yeah", "approved", "ok", "sounds good", "go ahead" from customer context = CUSTOMER_APPROVE
- "no", "cancel", "reject", "dont want" from customer context = CUSTOMER_REJECT
- APPROVE-DS-XXXXXX from admin = ADMIN_APPROVE with approvalCode
- REJECT-DS-XXXXXX from admin = ADMIN_REJECT with approvalCode
- Photo attached with no/minimal text = APPROVAL_PHOTO
- STOP, unsubscribe = OPTOUT
- tons x 0.7 = yards
- truck type mapping (normalize ALL variations):
  tandem_axle: tandem, tandem axle, 10 wheel, ten wheel, single axle dump
  tri_axle: triaxle, tri axle, tri-axle, triaxel, traxle, 3 axle, three axle
  quad_axle: quad, quad axle, quad-axle, 4 axle, four axle
  end_dump: end dump, end, end-dump
  super_dump: super dump, super, superdump
  belly_dump: belly dump, belly, belly-dump, bottom dump
  side_dump: side dump, side-dump
  transfer: transfer, transfer truck, transfer trailer
  18_wheeler: 18 wheeler, eighteen wheeler, semi, tractor trailer
  NOTE: triaxel and triaxle are the same thing — always map to tri_axle`

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: text || '(no text, photo only)' }]
    })

    const block = response.content[0]
    const raw = block.type === 'text' ? block.text : '{}'
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())

    // Override hasPhoto if media was attached
    if (hasMedia) parsed.hasPhoto = true
    if (hasMedia && (!parsed.intent || parsed.intent === 'UNKNOWN')) {
      parsed.intent = 'APPROVAL_PHOTO'
    }

    return parsed as ExtractionResult
  } catch (err: any) {
    console.error('[extraction] error:', err?.message)
    // Fallback: simple keyword detection
    const lower = text.toLowerCase()
    const result: ExtractionResult = {
      intent: 'UNKNOWN', city: null, yards: null, truckType: null,
      material: null, loadCount: null, hasPhoto: hasMedia,
      approvalCode: null, requiresEscalation: false, confidence: 0.3
    }

    if (lower.includes('stop')) result.intent = 'OPTOUT'
    else if (lower.includes('done') || lower.includes('dumped') || lower.includes('finished')) result.intent = 'DONE_REPORT'
    else if (lower.includes('cancel')) result.intent = 'CANCEL'
    else if (lower.includes('yes') || lower.includes('approve') || lower.includes('ok')) result.intent = 'CUSTOMER_APPROVE'
    else if (lower.match(/approve-ds/i)) { result.intent = 'ADMIN_APPROVE'; result.approvalCode = lower.match(/ds-[a-z0-9]+/i)?.[0]?.toUpperCase() || null }
    else if (lower.match(/reject-ds/i)) { result.intent = 'ADMIN_REJECT'; result.approvalCode = lower.match(/ds-[a-z0-9]+/i)?.[0]?.toUpperCase() || null }
    else if (lower.includes('need') || lower.includes('spot') || lower.includes('dump') || lower.includes('load')) result.intent = 'NEED_DUMPSITE'
    else if (hasMedia) result.intent = 'APPROVAL_PHOTO'

    const numMatch = text.match(/(\d+)\s*(?:yard|yd|y\b)/i)
    if (numMatch) result.yards = parseInt(numMatch[1])

    const loadMatch = text.match(/(?:done|dumped|finished)\s+(\d+)/i)
    if (loadMatch) result.loadCount = parseInt(loadMatch[1])

    return result
  }
}
