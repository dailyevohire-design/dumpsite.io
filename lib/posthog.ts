import posthog from 'posthog-js'

export function initPostHog() {
  if (typeof window === 'undefined') return
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    session_recording: {
      maskAllInputs: true,
      maskInputOptions: { password: true }
    }
  })
}

export function trackEvent(event: string, properties?: Record<string, any>) {
  if (typeof window === 'undefined') return
  try { posthog.capture(event, properties) } catch {}
}

export function identifyDriver(userId: string, properties?: Record<string, any>) {
  if (typeof window === 'undefined') return
  try { posthog.identify(userId, properties) } catch {}
}
