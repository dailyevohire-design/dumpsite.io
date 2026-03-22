// Rate limiting using Upstash Redis — gracefully skips if not configured
let rateLimiterCache: Map<string, any> | null = null

async function getRateLimiter(limit: number, window: any) {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  try {
    const { Ratelimit } = await import('@upstash/ratelimit')
    const { Redis } = await import('@upstash/redis')
    const redis = new Redis({ url, token })
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      analytics: false,
    })
  } catch {
    return null
  }
}

/**
 * Rate limit a request by key.
 * Returns { allowed: true } if OK, or { allowed: false, response } with a 429 response.
 * If Upstash is not configured, always allows.
 */
export async function rateLimit(
  key: string,
  limit: number,
  window: string = '1 h'
): Promise<{ allowed: boolean; response?: Response }> {
  try {
    const limiter = await getRateLimiter(limit, window)
    if (!limiter) return { allowed: true }

    const result = await limiter.limit(key)
    if (result.success) return { allowed: true }

    return {
      allowed: false,
      response: Response.json(
        { error: 'Too many requests. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(result.reset / 1000 - Date.now() / 1000)) } }
      ),
    }
  } catch {
    // If rate limiting fails, don't block the request
    return { allowed: true }
  }
}
