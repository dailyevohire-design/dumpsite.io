'use client'
import { useEffect } from 'react'

interface JobSummary {
  id: string
  city_name: string
  driver_pay_cents: number
  yards_needed: number
}

interface ClaimJobModalProps {
  job: JobSummary
  onClose: () => void
}

export default function ClaimJobModal({ job, onClose }: ClaimJobModalProps) {
  const pay = Math.round(job.driver_pay_cents / 100)

  useEffect(() => {
    // Store job ID so post-signup can redirect back
    try {
      sessionStorage.setItem('pending_job_id', job.id)
    } catch {}
  }, [job.id])

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
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111316', border: '1px solid #272B33', borderRadius: '16px',
          padding: '36px 32px', maxWidth: '420px', width: '100%', textAlign: 'center',
          position: 'relative',
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

        <h2 style={{ color: '#E8E3DC', fontSize: '24px', fontWeight: '800', marginBottom: '8px' }}>
          You&apos;re one step away
        </h2>
        <p style={{ color: '#606670', fontSize: '14px', marginBottom: '24px' }}>
          Create a free account to claim this job and start earning.
        </p>

        {/* Job summary */}
        <div style={{
          background: '#0A0C0F', border: '1px solid #272B33', borderRadius: '10px',
          padding: '16px', marginBottom: '28px',
        }}>
          <span style={{ color: '#E8E3DC', fontSize: '15px', fontWeight: '600' }}>
            {job.city_name} &middot;{' '}
            <span style={{ color: '#F5A623', fontWeight: '800' }}>${pay}/load</span>
            {' '}&middot; {job.yards_needed} yards
          </span>
        </div>

        {/* CTA buttons */}
        <a
          href="/signup"
          style={{
            display: 'block', background: '#F5A623', color: '#0A0A0A',
            textDecoration: 'none', fontSize: '15px', fontWeight: '800',
            padding: '14px', borderRadius: '8px', marginBottom: '12px',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}
        >
          Create Free Account
        </a>
        <a
          href="/login"
          style={{
            display: 'block', background: 'transparent', color: '#F5A623',
            textDecoration: 'none', fontSize: '14px', fontWeight: '700',
            padding: '12px', borderRadius: '8px',
            border: '1px solid #F5A623',
          }}
        >
          Sign In
        </a>

        <p style={{ color: '#606670', fontSize: '12px', marginTop: '16px' }}>
          Takes 2 minutes. No credit card required.
        </p>
      </div>
    </div>
  )
}
