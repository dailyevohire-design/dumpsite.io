import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const supabase = createAdminSupabase()
  const { data, error } = await supabase
    .from('cities')
    .select('id, name')
    .order('name')

  if (error) {
    console.error('[admin/cities] query error:', error.message)
    return NextResponse.json({ success: false, error: 'Failed to load cities' }, { status: 500 })
  }

  return NextResponse.json({ success: true, data })
}
