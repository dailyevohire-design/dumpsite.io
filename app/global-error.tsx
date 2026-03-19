'use client'
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
