import crypto from 'crypto'

const SECRET = process.env.SITE_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback-secret'

export function generateSiteToken(params: {
  siteId: string
  jobId: string
  driverPhone: string
  expiresInMinutes?: number
}): string {
  const { siteId, jobId, driverPhone, expiresInMinutes = 240 } = params
  const expiresAt = Date.now() + expiresInMinutes * 60 * 1000
  const payload = JSON.stringify({ siteId, jobId, driverPhone, expiresAt })
  const encrypted = Buffer.from(payload).toString('base64url')
  const sig = crypto
    .createHmac('sha256', SECRET)
    .update(encrypted)
    .digest('base64url')
    .slice(0, 12)
  return `${encrypted}.${sig}`
}

export function verifySiteToken(token: string): {
  valid: boolean
  siteId?: string
  jobId?: string
  driverPhone?: string
  expired?: boolean
} {
  try {
    const [encrypted, sig] = token.split('.')
    if (!encrypted || !sig) return { valid: false }
    const expectedSig = crypto
      .createHmac('sha256', SECRET)
      .update(encrypted)
      .digest('base64url')
      .slice(0, 12)
    if (sig !== expectedSig) return { valid: false }
    const payload = JSON.parse(Buffer.from(encrypted, 'base64url').toString())
    if (Date.now() > payload.expiresAt) return { valid: false, expired: true }
    return {
      valid: true,
      siteId: payload.siteId,
      jobId: payload.jobId,
      driverPhone: payload.driverPhone
    }
  } catch {
    return { valid: false }
  }
}
