import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'

const MIN_CENTS = 2500 // $25
const MAX_CENTS = 7000 // $70

/**
 * PATCH /api/admin/cities/[id]/driver-pay
 * Body: { default_driver_pay_cents: number }
 *
 * Updates a single city's flat driver pay rate.
 * Admin only. Validates the rate is between $25 and $70.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing city id' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    const cents = body?.default_driver_pay_cents

    if (typeof cents !== 'number' || !Number.isInteger(cents)) {
      return NextResponse.json(
        { success: false, error: 'default_driver_pay_cents must be an integer' },
        { status: 400 }
      )
    }
    if (cents < MIN_CENTS || cents > MAX_CENTS) {
      return NextResponse.json(
        { success: false, error: `Rate must be between $${MIN_CENTS / 100} and $${MAX_CENTS / 100}` },
        { status: 400 }
      )
    }

    const supabase = createAdminSupabase()
    const { data, error } = await supabase
      .from('cities')
      .update({ default_driver_pay_cents: cents })
      .eq('id', id)
      .select('id, name, default_driver_pay_cents')
      .single()

    if (error) {
      console.error('[admin/cities/:id/driver-pay] update failed:', error.message)
      return NextResponse.json(
        { success: false, error: 'Failed to update rate' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    console.error('[admin/cities/:id/driver-pay] crash:', msg)
    return NextResponse.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    )
  }
}
