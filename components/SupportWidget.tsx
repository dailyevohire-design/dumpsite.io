'use client'
import { useState } from 'react'

export default function SupportWidget() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Floating support button — bottom right on every page */}
      <button
        onClick={() => setOpen(!open)}
        aria-label="Contact Support"
        style={{
          position: 'fixed', bottom: '20px', right: '20px', zIndex: 9990,
          width: '52px', height: '52px', borderRadius: '50%',
          background: '#F5A623', border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(245,166,35,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 0.2s',
          transform: open ? 'rotate(45deg)' : 'none',
        }}
      >
        {open
          ? <span style={{ fontSize: '24px', color: '#111', fontWeight: '900', lineHeight: 1 }}>+</span>
          : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        }
      </button>

      {/* Support panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: '82px', right: '20px', zIndex: 9990,
          width: '300px', background: '#111316', border: '1px solid #272B33',
          borderRadius: '16px', overflow: 'hidden',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          fontFamily: 'system-ui, sans-serif',
          animation: 'slideUp 0.2s ease-out',
        }}>
          <style>{`@keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>

          {/* Header */}
          <div style={{
            background: '#F5A623', padding: '18px 20px',
          }}>
            <div style={{ fontWeight: '900', fontSize: '16px', color: '#111', marginBottom: '2px' }}>
              DumpSite.io Support
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(0,0,0,0.6)' }}>
              We typically respond within minutes
            </div>
          </div>

          {/* Options */}
          <div style={{ padding: '16px' }}>
            {/* Text */}
            <a
              href="sms:+19452938600"
              style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '14px', background: '#1C1F24', borderRadius: '10px',
                textDecoration: 'none', marginBottom: '10px',
                border: '1px solid #272B33',
              }}
            >
              <div style={{
                width: '40px', height: '40px', borderRadius: '10px',
                background: 'rgba(39,174,96,0.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <span style={{ fontSize: '20px' }}>&#128172;</span>
              </div>
              <div>
                <div style={{ fontWeight: '700', fontSize: '14px', color: '#E8E3DC' }}>Text Us</div>
                <div style={{ fontSize: '12px', color: '#606670' }}>(945) 293-8600</div>
              </div>
            </a>

            {/* Email */}
            <a
              href="mailto:support@dumpsite.io"
              style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '14px', background: '#1C1F24', borderRadius: '10px',
                textDecoration: 'none', marginBottom: '10px',
                border: '1px solid #272B33',
              }}
            >
              <div style={{
                width: '40px', height: '40px', borderRadius: '10px',
                background: 'rgba(59,138,232,0.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <span style={{ fontSize: '20px' }}>&#9993;</span>
              </div>
              <div>
                <div style={{ fontWeight: '700', fontSize: '14px', color: '#E8E3DC' }}>Email Us</div>
                <div style={{ fontSize: '12px', color: '#606670' }}>support@dumpsite.io</div>
              </div>
            </a>

          </div>

          {/* Footer */}
          <div style={{
            borderTop: '1px solid #272B33', padding: '12px 16px',
            textAlign: 'center', fontSize: '11px', color: '#606670',
          }}>
            Available Mon–Sat 7AM–7PM CT
          </div>
        </div>
      )}
    </>
  )
}
