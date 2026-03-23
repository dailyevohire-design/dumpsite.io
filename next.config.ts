import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'

// IMPORTANT: Set NEXT_PUBLIC_APP_URL=https://dumpsite.io in Vercel environment variables
// This is used in SMS links and email templates. If missing, falls back to https://dumpsite.io
//
// PostHog Analytics (set in Vercel env vars after signing up at posthog.com):
// NEXT_PUBLIC_POSTHOG_KEY=phc_xxxxx
// NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  org: 'dumpsiteio',
  project: 'dumpsite-io',
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  disableLogger: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
})
