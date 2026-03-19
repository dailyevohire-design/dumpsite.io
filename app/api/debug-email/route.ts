import { NextResponse } from 'next/server'
import { sendDumpsiteInterestEmail } from '@/lib/email'

export async function GET() {
  const hasKey = !!process.env.RESEND_API_KEY
  const keyPrefix = process.env.RESEND_API_KEY?.slice(0, 6) || 'NOT SET'
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'NOT SET (using default)'

  let emailResult: any = null
  if (hasKey) {
    emailResult = await sendDumpsiteInterestEmail({
      name: 'Email Debug Test',
      phone: '5550000000',
      city: 'Dallas',
      address: '123 Debug St',
      material: 'dirt',
      yards: '10',
      submittedAt: new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }),
    })
  }

  return NextResponse.json({
    hasResendKey: hasKey,
    keyPrefix,
    fromEmail,
    emailResult,
  })
}
