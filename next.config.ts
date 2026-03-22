import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'

// IMPORTANT: Set NEXT_PUBLIC_APP_URL=https://dumpsite.io in Vercel environment variables
// This is used in SMS links and email templates. If missing, falls back to https://dumpsite.io

const nextConfig: NextConfig = {
  /* config options here */
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
