'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function PromoPopup() {
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem('promo_dismissed')) return
    const timer = setTimeout(() => setVisible(true), 4000)
    return () => clearTimeout(timer)
  }, [])

  function dismiss() {
    setClosing(true)
    setTimeout(() => {
      setVisible(false)
      sessionStorage.setItem('promo_dismissed', '1')
    }, 300)
  }

  if (!visible) return null

  return (
    <>
      <style>{`
        @keyframes promoSlideUp {
          from { opacity: 0; transform: translateY(40px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes promoFadeOut {
          to { opacity: 0; transform: translateY(20px) scale(0.97); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        @keyframes countPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={dismiss}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 9998,
          opacity: closing ? 0 : 1,
          transition: 'opacity 0.3s ease',
        }}
      />

      {/* Popup */}
      <div style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        left: '24px',
        maxWidth: '420px',
        marginLeft: 'auto',
        zIndex: 9999,
        animation: closing
          ? 'promoFadeOut 0.3s ease forwards'
          : 'promoSlideUp 0.5s cubic-bezier(0.16,1,0.3,1) forwards',
      }}>
        <div style={{
          background: 'linear-gradient(145deg, #111113 0%, #0D0D0F 100%)',
          border: '1px solid rgba(245,166,35,0.15)',
          borderRadius: '16px',
          padding: '32px 28px 28px',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}>

          {/* Ambient glow */}
          <div style={{
            position: 'absolute',
            top: '-60px',
            right: '-60px',
            width: '200px',
            height: '200px',
            background: 'radial-gradient(circle, rgba(245,166,35,0.08) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          {/* Close button */}
          <button
            onClick={dismiss}
            style={{
              position: 'absolute',
              top: '14px',
              right: '14px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '8px',
              color: '#666',
              cursor: 'pointer',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              lineHeight: 1,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
              e.currentTarget.style.color = '#999'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
              e.currentTarget.style.color = '#666'
            }}
          >
            &#x2715;
          </button>

          {/* Limited badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(245,166,35,0.08)',
            border: '1px solid rgba(245,166,35,0.15)',
            borderRadius: '100px',
            padding: '5px 12px',
            marginBottom: '20px',
          }}>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#F5A623',
              animation: 'pulse 2s ease-in-out infinite',
            }} />
            <span style={{
              fontFamily: 'system-ui, sans-serif',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#F5A623',
            }}>
              Limited — First 100 Drivers
            </span>
          </div>

          {/* Headline */}
          <h3 style={{
            fontFamily: '"Georgia", serif',
            fontSize: '24px',
            fontWeight: 700,
            color: '#F0EDE8',
            lineHeight: 1.25,
            margin: '0 0 8px',
            letterSpacing: '-0.01em',
          }}>
            Free Fuel Card Drawing
          </h3>

          <p style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: '14px',
            color: '#8A8A8A',
            lineHeight: 1.55,
            margin: '0 0 24px',
          }}>
            Sign up today and you{'\u2019'}re automatically entered to win. No strings, no catches — just our way of welcoming the drivers building this platform.
          </p>

          {/* Fuel card visual */}
          <div style={{
            background: 'linear-gradient(135deg, #1A1A1C 0%, #141416 50%, #1A1A1C 100%)',
            border: '1px solid rgba(245,166,35,0.1)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '24px',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Shimmer line */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '1px',
              background: 'linear-gradient(90deg, transparent, rgba(245,166,35,0.3), transparent)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 3s ease-in-out infinite',
            }} />

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#555',
                  marginBottom: '6px',
                }}>
                  Prize Value
                </div>
                <div style={{
                  fontFamily: '"Georgia", serif',
                  fontSize: '32px',
                  fontWeight: 700,
                  color: '#F5A623',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                  animation: 'countPulse 4s ease-in-out infinite',
                }}>
                  $500
                </div>
              </div>
              <div style={{
                fontFamily: '"Georgia", serif',
                fontSize: '13px',
                fontWeight: 700,
                letterSpacing: '0.02em',
                color: '#333',
              }}>
                DUMPSITE<span style={{ color: 'rgba(245,166,35,0.3)' }}>.IO</span>
              </div>
            </div>
          </div>

          {/* CTA */}
          <Link
            href="/signup"
            onClick={dismiss}
            style={{
              display: 'block',
              textAlign: 'center',
              background: '#F5A623',
              color: '#0A0A0A',
              fontFamily: 'system-ui, sans-serif',
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '0.03em',
              padding: '14px 24px',
              borderRadius: '10px',
              textDecoration: 'none',
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 16px rgba(245,166,35,0.2)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#FFB740'
              e.currentTarget.style.boxShadow = '0 6px 24px rgba(245,166,35,0.3)'
              e.currentTarget.style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#F5A623'
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(245,166,35,0.2)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            CLAIM YOUR ENTRY
          </Link>

          <p style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: '11px',
            color: '#444',
            textAlign: 'center',
            margin: '14px 0 0',
            lineHeight: 1.4,
          }}>
            Winner drawn when we hit 100 drivers. Already signed up? You{'\u2019'}re in.
          </p>
        </div>
      </div>
    </>
  )
}
