import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: 'https://cf8fcdaeeeea21e2b9e1e51c8089c497@o4511070973788160.ingest.us.sentry.io/4511070986698752',
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
})
