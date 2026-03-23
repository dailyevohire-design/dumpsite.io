'use client'
import { useEffect } from 'react'
import { initPostHog } from '@/lib/posthog'

export default function PostHogProvider() {
  useEffect(() => {
    initPostHog()
  }, [])
  return null
}
