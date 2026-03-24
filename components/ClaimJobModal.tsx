'use client'
import { useEffect } from 'react'

interface ClaimJobModalProps {
  job: {
    id: string
    cityName: string
    payPerLoad: number
    yardsNeeded: number
    truckAccessLabel: string
    urgency: string
  } | null
  onClose: () => void
}

export default function ClaimJobModal({ job, onClose }: ClaimJobModalProps) {
  if (!job) return null

  // Save job ID to sessionStorage for post-signup redirect
  if (typeof window !== 'undefined') {
    try { sessionStorage.setItem('pendingJobId', job.id) } catch {}
  }

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111316', border: '1px solid #272B33', borderRadius: '16px',
          padding: '32px', maxWidth: '420px', width: 'calc(100% - 40px)',
          position: 'relative', textAlign: 'center',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: '16px', right: '16px',
            background: 'none', border: 'none', color: '#606670',
            fontSize: '20px', cursor: 'pointer', lineHeight: 1,
          }}
          aria-label="Close"
        >
          X
        </button>

        <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#x1F69B;</div>

        <h2 style={{ color: '#E8E3DC', fontSize: '24px', fontWeight: '800', marginBottom: '8px' }}>
          You&apos;re one step away
        </h2>
        <p style={{ color: '#606670', fontSize: '14px', marginBottom: '24px' }}>
          Create your free account to claim this job
        </p>

        {/* Job summary card */}
        <div style={{
          background: '#0A0C0F', border: '1px solid #272B33', borderRadius: '10px',
          padding: '16px', marginBottom: '24px', textAlign: 'left',
        }}>
          <div style={{ fontWeight: '700', fontSize: '15px', color: '#E8E3DC', marginBottom: '6px' }}>
            {job.cityName}
          </div>
          <div style={{ color: '#F5A623', fontSize: '24px', fontWeight: '800', marginBottom: '6px' }}>
            ${job.payPerLoad}<span style={{ fontSize: '14px', color: '#606670', fontWeight: '600' }}>/load</span>
          </div>
          <div style={{ color: '#888', fontSize: '13px', marginBottom: '4px' }}>
            {job.yardsNeeded} yards &middot; {job.truckAccessLabel}
          </div>
          {job.urgency === 'urgent' && (
            <span style={{
              display: 'inline-block', marginTop: '6px',
              background: 'rgba(231,76,60,0.15)', color: '#E74C3C',
              fontSize: '10px', fontWeight: '800', padding: '3px 8px',
              borderRadius: '4px', textTransform: 'uppercase',
            }}>
              URGENT
            </span>
          )}
        </div>

        <div style={{ height: '1px', background: '#272B33', marginBottom: '24px' }} />

        {/* CTA buttons */}
        <a
          href="/signup"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#F5A623', color: '#0A0A0A',
            textDecoration: 'none', fontSize: '15px', fontWeight: '800',
            height: '52px', borderRadius: '8px', marginBottom: '8px',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}
        >
          Create Free Account
        </a>
        <a
          href="/login"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', color: '#606670',
            textDecoration: 'none', fontSize: '14px', fontWeight: '700',
            height: '44px', borderRadius: '8px',
            border: '1px solid #272B33',
          }}
        >
          Sign In to Existing Account
        </a>

        <p style={{ color: '#606670', fontSize: '12px', marginTop: '16px' }}>
          Takes 2 minutes. No credit card required.
        </p>
      </div>
    </div>
  )
}
