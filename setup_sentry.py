#!/usr/bin/env python3
"""
DumpSite.io — Sentry Error Monitoring Setup
Run: python3 setup_sentry.py
"""
import os, json

BASE = '/home/dailyevohire/dumpsite-io'
DSN = 'https://cf8fcdaeeeea21e2b9e1e51c8089c497@o4511070973788160.ingest.us.sentry.io/4511070986698752'

def write(path, content):
    full = f'{BASE}/{path}'
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w') as f:
        f.write(content)
    print(f'✅ {path}')

# ── 1. Client-side Sentry (browser errors, driver dashboard crashes)
write('instrumentation-client.ts', f"""import * as Sentry from '@sentry/nextjs'

Sentry.init({{
  dsn: '{DSN}',
  environment: process.env.NODE_ENV,

  // Capture 100% of errors, 10% of performance traces in prod
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Replay 10% of sessions, 100% with errors — see exactly what drivers did
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({{
      maskAllText: false,      // We want to see what drivers typed
      blockAllMedia: false,    // We want to see photo uploads
    }}),
    Sentry.browserTracingIntegration(),
  ],

  // Tag every error with context
  beforeSend(event) {{
    // Don't send errors from localhost dev
    if (window.location.hostname === 'localhost') return null
    return event
  }},
}})
""")

# ── 2. Server-side Sentry (API route crashes, DB errors)
write('sentry.server.config.ts', f"""import * as Sentry from '@sentry/nextjs'

Sentry.init({{
  dsn: '{DSN}',
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Alert on every server error in production
  beforeSend(event) {{
    if (process.env.NODE_ENV === 'production') {{
      console.error('[Sentry] Server error captured:', event.exception?.values?.[0]?.value)
    }}
    return event
  }},
}})
""")

# ── 3. Edge runtime Sentry (middleware errors)
write('sentry.edge.config.ts', f"""import * as Sentry from '@sentry/nextjs'

Sentry.init({{
  dsn: '{DSN}',
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
}})
""")

# ── 4. instrumentation.ts — registers server + edge Sentry
write('instrumentation.ts', """import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Captures errors from API routes, middleware, server components
export const onRequestError = Sentry.captureRequestError
""")

# ── 5. global-error.tsx — catches React rendering crashes
write('app/global-error.tsx', """'use client'
import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body style={{ background: '#0A0C0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '40px 20px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ color: '#E8E3DC', fontWeight: '800', fontSize: '22px', marginBottom: '8px' }}>
            Something went wrong
          </h2>
          <p style={{ color: '#606670', fontSize: '14px', marginBottom: '24px', lineHeight: '1.6' }}>
            Our team has been notified and is looking into it. Please try again.
          </p>
          <button
            onClick={reset}
            style={{ background: '#F5A623', color: '#111', border: 'none', padding: '12px 28px', borderRadius: '9px', fontWeight: '800', fontSize: '14px', cursor: 'pointer' }}
          >
            Try Again
          </button>
          <div style={{ marginTop: '16px' }}>
            <a href="/dashboard" style={{ color: '#606670', fontSize: '13px', textDecoration: 'none' }}>
              ← Back to Dashboard
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
""")

# ── 6. Update next.config.ts to wrap with Sentry
with open(f'{BASE}/next.config.ts', 'r') as f:
    config = f.read()

if 'withSentryConfig' not in config:
    new_config = f"""import {{ withSentryConfig }} from '@sentry/nextjs'
{config.replace('export default', 'const nextConfig =')}

export default withSentryConfig(nextConfig, {{
  org: 'dumpsiteio',
  project: 'dumpsite-io',
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  disableLogger: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
}})
"""
    with open(f'{BASE}/next.config.ts', 'w') as f:
        f.write(new_config)
    print('✅ next.config.ts — wrapped with withSentryConfig')
else:
    print('ℹ️  next.config.ts already has Sentry')

# ── 7. Add env vars reminder
print("""
⚠️  ADD THESE TO VERCEL ENVIRONMENT VARIABLES:
   NEXT_PUBLIC_SENTRY_DSN = https://cf8fcdaeeeea21e2b9e1e51c8089c497@o4511070973788160.ingest.us.sentry.io/4511070986698752
   SENTRY_AUTH_TOKEN = (get from sentry.io → Settings → Auth Tokens → Create)

✅ ALL SENTRY FILES WRITTEN
""")
