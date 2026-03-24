import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'

    const city = request.headers.get('x-vercel-ip-city') || null
    const region = request.headers.get('x-vercel-ip-country-region') || null
    const country = request.headers.get('x-vercel-ip-country') || null
    const latitude = request.headers.get('x-vercel-ip-latitude') || null
    const longitude = request.headers.get('x-vercel-ip-longitude') || null
    const userAgent = request.headers.get('user-agent') || null
    const referer = request.headers.get('referer') || null

    let path = '/'
    try {
      const body = await request.json()
      path = body.path || '/'
    } catch {
      // no body is fine
    }

    const supabase = createAdminSupabase()

    // Rate limit: skip if same IP visited in last 30 minutes
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: recent } = await supabase
      .from('site_visitors')
      .select('id')
      .eq('ip', ip)
      .gte('created_at', thirtyMinAgo)
      .limit(1)

    if (recent && recent.length > 0) {
      return NextResponse.json({ success: true, tracked: false })
    }

    const { error } = await supabase.from('site_visitors').insert({
      ip,
      city,
      region,
      country,
      latitude,
      longitude,
      user_agent: userAgent,
      path,
      referer,
    })

    if (error) {
      console.error('[track] insert error:', error.message)
      return NextResponse.json({ success: false, error: 'Failed to track' }, { status: 500 })
    }

    return NextResponse.json({ success: true, tracked: true })
  } catch (err) {
    console.error('[track] unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
