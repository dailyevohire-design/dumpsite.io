'use client'
import { useState, useEffect } from 'react'
import ClaimJobModal from '@/components/ClaimJobModal'

interface PublicJob {
  id: string
  city_name: string
  driver_pay_cents: number
  yards_needed: number
  truck_type_needed: string
  urgency: string
  created_at: string
}

function formatTruckType(t: string): string {
  const map: Record<string, string> = {
    tandem_axle: 'Tandem Axle',
    end_dump: 'End Dump',
    tri_axle: 'Tri-Axle',
    super_dump: 'Super Dump',
    semi_transfer: 'Semi Transfer',
    bottom_dump: 'Bottom Dump',
  }
  return map[t] || t || 'Any Truck'
}

export default function PublicJobsFeed({ limit = 6 }: { limit?: number }) {
  const [jobs, setJobs] = useState<PublicJob[]>([])
  const [loading, setLoading] = useState(true)
  const [modalJob, setModalJob] = useState<PublicJob | null>(null)

  useEffect(() => {
    fetch('/api/public/jobs')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.jobs) setJobs(d.jobs.slice(0, limit))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [limit])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0' }}>
        <div style={{ color: '#606670', fontSize: '14px', fontFamily: 'system-ui' }}>Loading available jobs...</div>
      </div>
    )
  }

  if (jobs.length === 0) return null

  return (
    <>
      <div className="feature-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '16px',
      }}>
        {jobs.map(job => {
          const pay = Math.round(job.driver_pay_cents / 100)
          return (
            <div key={job.id} style={{
              background: '#111316', border: '1px solid #272B33', borderRadius: '12px',
              padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', color: '#E8E3DC', fontWeight: '600', fontFamily: 'system-ui' }}>
                  {job.city_name}
                </span>
                {job.urgency === 'urgent' && (
                  <span style={{
                    background: 'rgba(231,76,60,0.15)', color: '#E74C3C',
                    fontSize: '10px', fontWeight: '800', padding: '3px 8px',
                    borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em',
                    fontFamily: 'system-ui',
                  }}>
                    Urgent
                  </span>
                )}
              </div>

              <div style={{ color: '#F5A623', fontSize: '28px', fontWeight: '800', fontFamily: 'system-ui' }}>
                ${pay}<span style={{ fontSize: '14px', fontWeight: '600', color: '#888' }}>/load</span>
              </div>

              <div style={{ fontSize: '13px', color: '#888', fontFamily: 'system-ui' }}>
                {job.yards_needed} yards needed
              </div>

              <div style={{ fontSize: '12px', color: '#606670', fontFamily: 'system-ui' }}>
                {formatTruckType(job.truck_type_needed)}
              </div>

              <button
                onClick={() => setModalJob(job)}
                style={{
                  marginTop: 'auto', background: '#F5A623', color: '#0A0A0A',
                  border: 'none', padding: '11px', borderRadius: '8px',
                  fontWeight: '800', fontSize: '13px', cursor: 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  fontFamily: 'system-ui',
                }}
              >
                Claim This Job &rarr;
              </button>
            </div>
          )
        })}
      </div>

      {modalJob && (
        <ClaimJobModal job={modalJob} onClose={() => setModalJob(null)} />
      )}
    </>
  )
}
