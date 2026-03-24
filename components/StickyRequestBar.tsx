'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function StickyRequestBar() {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (dismissed) return
    function onScroll() {
      // Show after scrolling past the hero (~600px)
      setVisible(window.scrollY > 600)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [dismissed])

  if (dismissed || !visible) return null

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9980,
      background: '#111316', borderTop: '1px solid rgba(245,166,35,0.25)',
      padding: '14px 24px',
      transform: visible ? 'translateY(0)' : 'translateY(100%)',
      transition: 'transform 0.3s ease',
    }}>
      <div style={{
        maxWidth: '1100px', margin: '0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '16px', flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{
            fontWeight: '700', fontSize: '14px', color: '#E8E3DC',
            fontFamily: 'system-ui, sans-serif', marginBottom: '2px',
          }}>
            Need a dumpsite? Tell us what you need.
          </div>
          <div style={{
            fontSize: '12px', color: '#606670',
            fontFamily: 'system-ui, sans-serif',
          }}>
            Post your location, material, and truck details — we will match you with a site.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
          <Link href="/dumpsite-request" style={{
            background: '#F5A623', color: '#111', textDecoration: 'none',
            fontSize: '13px', fontWeight: '800', padding: '10px 24px',
            borderRadius: '6px', fontFamily: 'system-ui, sans-serif',
            whiteSpace: 'nowrap',
          }}>
            Post a Request
          </Link>
          <button onClick={() => setDismissed(true)} aria-label="Dismiss"
            style={{
              background: 'transparent', border: 'none', color: '#606670',
              cursor: 'pointer', fontSize: '18px', padding: '4px 8px',
              lineHeight: 1,
            }}>
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
