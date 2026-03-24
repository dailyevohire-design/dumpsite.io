'use client'

import { useEffect } from 'react'

export default function VisitorTracker() {
  useEffect(() => {
    const key = 'dumpsite_tracked'
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')

    fetch('/api/public/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: window.location.pathname }),
    }).catch(() => {})
  }, [])

  return null
}
