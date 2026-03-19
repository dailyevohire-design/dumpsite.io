import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: 'https://cf8fcdaeeeea21e2b9e1e51c8089c497@o4511070973788160.ingest.us.sentry.io/4511070986698752',
  environment: process.env.NODE_ENV,

  // Capture 100% of errors, 10% of performance traces in prod
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Replay 10% of sessions, 100% with errors — see exactly what drivers did
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,      // We want to see what drivers typed
      blockAllMedia: false,    // We want to see photo uploads
    }),
    Sentry.browserTracingIntegration(),
  ],

  // Tag every error with context
  beforeSend(event) {
    // Don't send errors from localhost dev
    if (window.location.hostname === 'localhost') return null
    return event
  },
})
