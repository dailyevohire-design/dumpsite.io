'use client'
import { useState, useEffect, useCallback } from 'react'
import ClaimJobModal from '@/components/ClaimJobModal'

interface PublicJob {
  id: string
  cityName: string
  payPerLoad: number
  yardsNeeded: number
  truckTypeNeeded: string
  truckAccessLabel: string
  urgency: string
  createdAt: string
  lat: number
  lng: number
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'Just posted'
  if (hours === 1) return '1 hour ago'
  if (hours < 24) return `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

function SkeletonCard() {
  return (
    <div style={{
      background: '#111316', border: '1px solid #272B33', borderRadius: '12px',
      overflow: 'hidden', minHeight: '260px',
    }}>
      <div style={{ padding: '20px 20px 12px' }}>
        <div style={{ width: '60%', height: '16px', background: '#1C1F24', borderRadius: '4px', marginBottom: '16px', animation: 'shimmer 1.5s infinite' }} />
        <div style={{ width: '40%', height: '40px', background: '#1C1F24', borderRadius: '4px', marginBottom: '12px', animation: 'shimmer 1.5s infinite' }} />
        <div style={{ width: '80%', height: '12px', background: '#1C1F24', borderRadius: '4px', marginBottom: '8px', animation: 'shimmer 1.5s infinite' }} />
        <div style={{ width: '50%', height: '12px', background: '#1C1F24', borderRadius: '4px', animation: 'shimmer 1.5s infinite' }} />
      </div>
      <div style={{ padding: '0 20px 20px' }}>
        <div style={{ width: '100%', height: '44px', background: '#1C1F24', borderRadius: '8px', animation: 'shimmer 1.5s infinite' }} />
      </div>
    </div>
  )
}

type TruckFilter = 'all' | 'tandem' | 'end_dump'

export default function PublicJobsFeed({ limit = 6 }: { limit?: number }) {
  const [allJobs, setAllJobs] = useState<PublicJob[]>([])
  const [loading, setLoading] = useState(true)
  const [modalJob, setModalJob] = useState<PublicJob | null>(null)
  const [visibleCount, setVisibleCount] = useState(limit)
  const [truckFilter, setTruckFilter] = useState<TruckFilter>('all')

  const fetchJobs = useCallback(() => {
    fetch('/api/public/jobs?limit=50')
      .then(r => r.json())
      .then(d => { if (d.jobs) setAllJobs(d.jobs) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchJobs()
    const interval = setInterval(fetchJobs, 90000)
    return () => clearInterval(interval)
  }, [fetchJobs])

  const filtered = allJobs.filter(j => {
    if (truckFilter === 'tandem') return j.truckAccessLabel === 'Tandem Axle Only'
    if (truckFilter === 'end_dump') return j.truckAccessLabel !== 'Tandem Axle Only'
    return true
  })

  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  const filterBtn = (label: string, value: TruckFilter) => (
    <button
      onClick={() => { setTruckFilter(value); setVisibleCount(limit) }}
      style={{
        background: truckFilter === value ? '#F5A623' : '#111316',
        color: truckFilter === value ? '#0A0A0A' : '#888',
        border: `1px solid ${truckFilter === value ? '#F5A623' : '#272B33'}`,
        padding: '8px 16px', borderRadius: '8px',
        fontSize: '12px', fontWeight: '700', cursor: 'pointer',
        fontFamily: 'system-ui', whiteSpace: 'nowrap' as const,
      }}
    >
      {label}
    </button>
  )

  return (
    <>
      <style>{`@keyframes shimmer{0%{opacity:.5}50%{opacity:1}100%{opacity:.5}}`}</style>

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '700', margin: 0 }}>Available Jobs Near DFW</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#27AE60', boxShadow: '0 0 8px rgba(39,174,96,0.5)', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: '13px', color: '#606670', fontFamily: 'system-ui' }}>
            {allJobs.length} job{allJobs.length !== 1 ? 's' : ''} available right now
          </span>
        </div>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', overflowX: 'auto', paddingBottom: '4px' }}>
        {filterBtn('All Trucks', 'all')}
        {filterBtn('Tandem Only', 'tandem')}
        {filterBtn('End Dump / 18-Wheeler', 'end_dump')}
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="job-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      )}

      {/* No jobs state */}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 20px', background: '#111316', borderRadius: '12px', border: '1px solid #272B33' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>&#x1F514;</div>
          <p style={{ color: '#888', fontSize: '15px', fontFamily: 'system-ui', marginBottom: '4px' }}>
            No jobs available right now
          </p>
          <p style={{ color: '#606670', fontSize: '13px', fontFamily: 'system-ui' }}>
            Check back soon or sign up to enable notifications
          </p>
        </div>
      )}

      {/* Job cards grid */}
      {!loading && visible.length > 0 && (
        <>
          <div className="job-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            {visible.map(job => {
              const isUrgent = job.urgency === 'urgent'
              const isEndDump = job.truckAccessLabel !== 'Tandem Axle Only'
              return (
                <div
                  key={job.id}
                  className="job-card"
                  onClick={() => setModalJob(job)}
                  style={{
                    background: '#111316', border: '1px solid #272B33', borderRadius: '12px',
                    overflow: 'hidden', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column',
                    transition: 'border-color 0.2s, transform 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#F5A623'; e.currentTarget.style.transform = 'scale(1.01)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#272B33'; e.currentTarget.style.transform = 'scale(1)' }}
                >
                  {/* Top section */}
                  <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #1C1F24' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '18px', fontWeight: '700', color: '#E8E3DC', fontFamily: '"Georgia",serif' }}>
                        {job.cityName}
                      </span>
                      {isUrgent ? (
                        <span style={{
                          background: 'rgba(231,76,60,0.15)', color: '#E74C3C',
                          fontSize: '10px', fontWeight: '800', padding: '4px 10px',
                          borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em',
                          fontFamily: 'system-ui',
                        }}>
                          URGENT
                        </span>
                      ) : (
                        <span style={{
                          fontSize: '10px', fontWeight: '700', color: '#F5A623',
                          textTransform: 'uppercase', letterSpacing: '0.08em',
                          fontFamily: 'system-ui',
                        }}>
                          {job.cityName}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Middle section */}
                  <div style={{ padding: '16px 20px', flex: 1 }}>
                    <div style={{ marginBottom: '12px' }}>
                      <span style={{ color: '#F5A623', fontSize: '48px', fontWeight: '800', fontFamily: 'system-ui', lineHeight: 1 }}>
                        ${job.payPerLoad}
                      </span>
                      <span style={{ fontSize: '14px', color: '#606670', fontFamily: 'system-ui', marginLeft: '4px' }}>/load</span>
                    </div>

                    <div style={{ fontSize: '13px', color: '#606670', fontFamily: 'system-ui', marginBottom: '6px' }}>
                      &#x1F4E6; {job.yardsNeeded} yards needed
                    </div>
                    <div style={{ fontSize: '12px', color: isEndDump ? '#27AE60' : '#606670', fontFamily: 'system-ui', marginBottom: '8px' }}>
                      &#x1F69B; {job.truckAccessLabel}
                    </div>
                    <div style={{ fontSize: '11px', color: '#444', fontFamily: 'system-ui' }}>
                      {timeAgo(job.createdAt)}
                    </div>
                  </div>

                  {/* Bottom section — claim button */}
                  <div style={{ padding: '0 20px 20px' }}>
                    <button
                      style={{
                        width: '100%', height: '44px',
                        background: isUrgent ? '#E74C3C' : '#F5A623',
                        color: '#111', border: 'none', borderRadius: '8px',
                        fontWeight: '800', fontSize: '13px', cursor: 'pointer',
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                        fontFamily: 'system-ui',
                      }}
                    >
                      {isUrgent ? 'Claim Urgent Job' : 'Claim This Job \u2192'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Show more button */}
          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: '24px' }}>
              <button
                onClick={() => setVisibleCount(v => v + 6)}
                style={{
                  background: 'transparent', border: '1px solid #272B33',
                  color: '#888', padding: '12px 32px', borderRadius: '8px',
                  fontSize: '14px', fontWeight: '700', cursor: 'pointer',
                  fontFamily: 'system-ui',
                }}
              >
                Show more jobs ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}

      {modalJob && <ClaimJobModal job={modalJob} onClose={() => setModalJob(null)} />}

      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @media(max-width:900px){.job-cards-grid{grid-template-columns:repeat(2,1fr)!important}}
        @media(max-width:640px){.job-cards-grid{grid-template-columns:1fr!important}}
      `}</style>
    </>
  )
}
