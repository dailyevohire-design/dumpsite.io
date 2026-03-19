import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: 'https://cf8fcdaeeeea21e2b9e1e51c8089c497@o4511070973788160.ingest.us.sentry.io/4511070986698752',
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Alert on every server error in production
  beforeSend(event) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Sentry] Server error captured:', event.exception?.values?.[0]?.value)
    }
    return event
  },
})
