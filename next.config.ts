import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

const nextConfig = nextConfig;


export default withSentryConfig(nextConfig, {
  org: 'dumpsiteio',
  project: 'dumpsite-io',
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  disableLogger: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
})
