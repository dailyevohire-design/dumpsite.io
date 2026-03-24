import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase.server'

export async function GET(request: NextRequest) {
  try {
    const serverSupabase = await createServerSupabase()
    const { data: { user }, error: authError } = await serverSupabase.auth.getUser()

    if (!user || authError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const role = user.user_metadata?.role
    if (role !== 'admin' && role !== 'superadmin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(request.url)
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500)
    const country = url.searchParams.get('country') || null

    const supabase = createAdminSupabase()
    let query = supabase
      .from('site_visitors')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (country) {
      query = query.eq('country', country)
    }

    const { data, error } = await query

    if (error) {
      console.error('[admin/visitors] query error:', error.message)
      return NextResponse.json({ success: false, error: 'Query failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (err) {
    console.error('[admin/visitors] unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
