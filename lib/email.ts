import { Resend } from 'resend'

function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('Missing RESEND_API_KEY env var')
  return new Resend(key)
}

const NOTIFY_TO = 'support@filldirtnearme.net'
const FROM = process.env.RESEND_FROM_EMAIL || 'DumpSite.io <notifications@filldirtnearme.net>'

export async function sendDumpsiteInterestEmail(data: {
  name: string
  phone: string
  email?: string
  city: string
  address: string
  material: string
  yards: string | number
  notes?: string
  requestId?: string
  submittedAt: string
}) {
  const resend = getResend()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dumpsite.io'
  const adminLink = data.requestId
    ? `${appUrl}/admin?tab=dumpsite-requests&id=${data.requestId}`
    : `${appUrl}/admin`

  const materialLabel: Record<string, string> = {
    dirt: 'Fill Dirt', topsoil: 'Topsoil', clay: 'Clay',
    gravel: 'Gravel', mixed: 'Mixed', other: 'Other',
  }

  const subject = `\u{1F69B} New Dumpsite Interest - ${data.city} - ${data.name}`

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#111;color:#eee;border-radius:12px;overflow:hidden">
      <div style="background:#F5A623;padding:18px 24px">
        <h1 style="margin:0;font-size:20px;color:#111">New Dumpsite Interest Submitted</h1>
      </div>
      <div style="padding:24px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#888;width:140px">Name</td><td style="padding:8px 0;font-weight:700">${esc(data.name)}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Phone</td><td style="padding:8px 0">${esc(data.phone)}</td></tr>
          ${data.email ? `<tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0">${esc(data.email)}</td></tr>` : ''}
          <tr><td style="padding:8px 0;color:#888">City</td><td style="padding:8px 0;font-weight:700">${esc(data.city)}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Address</td><td style="padding:8px 0">${esc(data.address)}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Material</td><td style="padding:8px 0">${esc(materialLabel[data.material] || data.material)}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Yards Needed</td><td style="padding:8px 0;font-weight:700">${esc(String(data.yards))}</td></tr>
          ${data.notes ? `<tr><td style="padding:8px 0;color:#888;vertical-align:top">Notes</td><td style="padding:8px 0">${esc(data.notes)}</td></tr>` : ''}
          <tr><td style="padding:8px 0;color:#888">Submitted</td><td style="padding:8px 0">${esc(data.submittedAt)}</td></tr>
        </table>
        <div style="margin-top:24px">
          <a href="${adminLink}" style="display:inline-block;background:#F5A623;color:#111;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:800;font-size:14px">View in Admin Dashboard</a>
        </div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #272B33;font-size:12px;color:#606670">
        DumpSite.io — Automated notification
      </div>
    </div>
  `

  try {
    const { data: result, error } = await resend.emails.send({
      from: FROM,
      to: NOTIFY_TO,
      subject,
      html,
    })

    if (error) {
      console.error('Resend email error:', error)
      return { success: false, error: error.message }
    }

    return { success: true, emailId: result?.id }
  } catch (err: any) {
    console.error('Email send failed:', err.message)
    return { success: false, error: err.message }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
