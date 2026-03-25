'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function PromoPopup() {
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const [spotsLeft, setSpotsLeft] = useState(100)

  useEffect(() => {
    if (sessionStorage.getItem('promo_dismissed')) return
    const timer = setTimeout(() => setVisible(true), 4000)
    return () => clearTimeout(timer)
  }, [])

  // Countdown spots slowly while popup is open (scarcity)
  useEffect(() => {
    if (!visible || closing) return
    const interval = setInterval(() => {
      setSpotsLeft(prev => {
        if (prev <= 92) { clearInterval(interval); return prev }
        return prev - 1
      })
    }, 8000)
    return () => clearInterval(interval)
  }, [visible, closing])

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
          50% { opacity: 1; }
        }
        @keyframes countPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @keyframes progressGlow {
          0%, 100% { box-shadow: 0 0 8px rgba(245,166,35,0.3); }
          50% { box-shadow: 0 0 16px rgba(245,166,35,0.5); }
        }
        @keyframes urgentPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes spotDrop {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); color: #FF6B35; }
          100% { transform: scale(1); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={dismiss}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
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
        maxWidth: '440px',
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

          {/* Urgency badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(245,166,35,0.08)',
            border: '1px solid rgba(245,166,35,0.15)',
            borderRadius: '100px',
            padding: '5px 12px',
            marginBottom: '16px',
          }}>
            <div style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#F5A623',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
            <span style={{
              fontFamily: 'system-ui, sans-serif',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#F5A623',
            }}>
              Filling Fast — {spotsLeft} Spots Left
            </span>
          </div>

          {/* Headline */}
          <h3 style={{
            fontFamily: '"Georgia", serif',
            fontSize: '24px',
            fontWeight: 700,
            color: '#F0EDE8',
            lineHeight: 1.25,
            margin: '0 0 6px',
            letterSpacing: '-0.01em',
          }}>
            Win a $1,000 Fuel Card
          </h3>

          <p style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: '14px',
            color: '#8A8A8A',
            lineHeight: 1.55,
            margin: '0 0 20px',
          }}>
            Every driver who signs up before we hit 250 is automatically entered. <span style={{ color: '#C0B9AE' }}>150 drivers already claimed their spot.</span>
          </p>

          {/* Progress bar — social proof + scarcity */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: '8px',
            }}>
              <span style={{
                fontFamily: 'system-ui, sans-serif',
                fontSize: '12px',
                fontWeight: 600,
                color: '#888',
              }}>
                150 of 250 entries claimed
              </span>
              <span style={{
                fontFamily: 'system-ui, sans-serif',
                fontSize: '12px',
                fontWeight: 700,
                color: '#F5A623',
                animation: 'urgentPulse 2s ease-in-out infinite',
              }}>
                60% FULL
              </span>
            </div>
            <div style={{
              width: '100%',
              height: '6px',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: '100px',
              overflow: 'hidden',
              position: 'relative',
            }}>
              <div style={{
                width: '60%',
                height: '100%',
                background: 'linear-gradient(90deg, #F5A623 0%, #FFD080 100%)',
                borderRadius: '100px',
                animation: 'progressGlow 2.5s ease-in-out infinite',
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>

          {/* Prize card */}
          <div style={{
            background: 'linear-gradient(135deg, #1A1A1C 0%, #141416 50%, #1A1A1C 100%)',
            border: '1px solid rgba(245,166,35,0.1)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Shimmer */}
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
                  Fuel Card Prize
                </div>
                <div style={{
                  fontFamily: '"Georgia", serif',
                  fontSize: '36px',
                  fontWeight: 700,
                  color: '#F5A623',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                  animation: 'countPulse 4s ease-in-out infinite',
                }}>
                  $1,000
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontFamily: '"Georgia", serif',
                  fontSize: '13px',
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  color: '#333',
                  marginBottom: '4px',
                }}>
                  DUMPSITE<span style={{ color: 'rgba(245,166,35,0.3)' }}>.IO</span>
                </div>
                <div style={{
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: '10px',
                  color: '#444',
                  letterSpacing: '0.05em',
                }}>
                  FOUNDING DRIVER
                </div>
              </div>
            </div>
          </div>

          {/* Social proof nudge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '20px',
            padding: '10px 14px',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.04)',
          }}>
            {/* Stacked avatars */}
            <div style={{ display: 'flex', flexShrink: 0 }}>
              {['#3B82F6','#10B981','#F59E0B','#EF4444'].map((c, i) => (
                <div key={i} style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: c,
                  border: '2px solid #111113',
                  marginLeft: i > 0 ? '-8px' : 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#fff',
                  fontFamily: 'system-ui, sans-serif',
                }}>
                  {['J','M','R','T'][i]}
                </div>
              ))}
            </div>
            <span style={{
              fontFamily: 'system-ui, sans-serif',
              fontSize: '12px',
              color: '#777',
              lineHeight: 1.4,
            }}>
              <span style={{ color: '#C0B9AE', fontWeight: 600 }}>12 drivers</span> signed up in the last hour
            </span>
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
              fontSize: '15px',
              fontWeight: 700,
              letterSpacing: '0.03em',
              padding: '15px 24px',
              borderRadius: '10px',
              textDecoration: 'none',
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 16px rgba(245,166,35,0.25)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#FFB740'
              e.currentTarget.style.boxShadow = '0 6px 24px rgba(245,166,35,0.35)'
              e.currentTarget.style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#F5A623'
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(245,166,35,0.25)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            CLAIM MY SPOT
          </Link>

          {/* Micro-copy — loss aversion */}
          <p style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: '11px',
            color: '#555',
            textAlign: 'center',
            margin: '12px 0 0',
            lineHeight: 1.4,
          }}>
            Drawing held at 250 drivers. No purchase necessary. <span style={{ color: '#777' }}>Don{'\u2019'}t miss it.</span>
          </p>
        </div>
      </div>
    </>
  )
}
