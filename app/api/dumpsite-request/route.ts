import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'
import { sendDumpsiteInterestEmail } from '@/lib/email'
import { sendAdminAlert } from '@/lib/sms'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, phone, address, city, material, yards, notes } = body

    // Validate required fields
    if (!name || !phone || !address || !city || !material || !yards) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createAdminSupabase()
    const submittedAt = new Date().toISOString()

    // Duplicate protection: same name + phone + city within 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data: existing } = await supabase
      .from('dumpsite_requests')
      .select('id')
      .eq('name', name)
      .eq('phone', phone)
      .eq('city', city)
      .gte('submitted_at', tenMinutesAgo)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({ success: true, message: 'Request already received' })
    }

    // Persist to database
    const { data: record, error: dbError } = await supabase
      .from('dumpsite_requests')
      .insert({
        name,
        phone,
        address,
        city,
        material,
        yards_needed: parseInt(yards) || 0,
        notes: notes || null,
        submitted_at: submittedAt,
        status: 'new',
      })
      .select('id')
      .single()

    if (dbError) {
      console.error('DB insert failed for dumpsite request:', dbError.message)
      // Still attempt to send email even if DB fails — don't lose the lead
    }

    // Send email notification (non-blocking — don't fail the request if email fails)
    const emailResult = await sendDumpsiteInterestEmail({
      name,
      phone,
      city,
      address,
      material,
      yards,
      notes,
      requestId: record?.id,
      submittedAt: new Date(submittedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' }),
    })

    if (!emailResult.success) {
      console.error('Email notification failed:', emailResult.error)
      // Fallback: send SMS alert so the lead isn't lost
      try {
        await sendAdminAlert(`New dumpsite interest from ${name} in ${city} — ${yards} yards ${material}. Email notification failed, check logs.`)
      } catch (smsErr) {
        console.error('SMS fallback also failed:', smsErr)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Dumpsite request error:', err.message)
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 })
  }
}
