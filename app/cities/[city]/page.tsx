'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
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
    tandem_axle: 'Tandem Axle', end_dump: 'End Dump', tri_axle: 'Tri-Axle',
    super_dump: 'Super Dump', semi_transfer: 'Semi Transfer', bottom_dump: 'Bottom Dump',
  }
  return map[t] || t || 'Any Truck'
}

function formatCitySlug(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export default function CityPage() {
  const params = useParams()
  const citySlug = typeof params.city === 'string' ? params.city : ''
  const cityName = formatCitySlug(citySlug)

  const [jobs, setJobs] = useState<PublicJob[]>([])
  const [loading, setLoading] = useState(true)
  const [modalJob, setModalJob] = useState<PublicJob | null>(null)

  useEffect(() => {
    fetch(`/api/public/jobs?city=${encodeURIComponent(cityName)}`)
      .then(r => r.json())
      .then(d => { if (d.success && d.jobs) setJobs(d.jobs) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [cityName])

  const avgPay = jobs.length > 0
    ? Math.round(jobs.reduce((s, j) => s + j.driver_pay_cents, 0) / jobs.length / 100)
    : 40

  return (
    <main style={{ minHeight: '100vh', background: '#0A0A0A', color: '#F0EDE8', fontFamily: '"Georgia",serif' }}>
      {/* Nav */}
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1A1A1A', position: 'sticky', top: 0, background: '#0A0A0A', zIndex: 50 }}>
        <Link href="/" style={{ fontSize: '18px', fontWeight: '700', letterSpacing: '0.02em', textDecoration: 'none', color: '#F0EDE8' }}>
          DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span>
        </Link>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontFamily: 'system-ui' }}>
          <Link href="/map-public" style={{ color: '#888', textDecoration: 'none', fontSize: '13px' }}>MAP</Link>
          <Link href="/signup" style={{ color: '#888', textDecoration: 'none', fontSize: '13px' }}>SIGN UP</Link>
          <Link href="/login" style={{ background: '#F5A623', color: '#0A0A0A', textDecoration: 'none', fontSize: '13px', fontWeight: '700', padding: '10px 18px', borderRadius: '4px' }}>SIGN IN</Link>
        </div>
      </nav>

      <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '48px 24px' }}>
        <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: '400', marginBottom: '8px' }}>
          Dump Truck Jobs in {cityName}, TX — <span style={{ color: '#F5A623' }}>${avgPay}/load</span>
        </h1>
        <p style={{ fontSize: '15px', color: '#666', marginBottom: '32px', fontFamily: 'system-ui' }}>
          {loading ? 'Loading jobs...' : `${jobs.length} active job${jobs.length !== 1 ? 's' : ''} in ${cityName} right now`}
        </p>

        {!loading && jobs.length > 0 && (
          <div className="feature-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '48px' }}>
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
                        borderRadius: '4px', textTransform: 'uppercase', fontFamily: 'system-ui',
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
                      textTransform: 'uppercase', fontFamily: 'system-ui',
                    }}
                  >
                    Claim This Job &rarr;
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', background: '#111316', borderRadius: '12px', border: '1px solid #272B33', marginBottom: '48px' }}>
            <p style={{ color: '#888', fontSize: '16px', fontFamily: 'system-ui', marginBottom: '16px' }}>
              No active jobs in {cityName} right now.
            </p>
            <p style={{ color: '#606670', fontSize: '13px', fontFamily: 'system-ui' }}>
              Sign up to get notified when new jobs are posted.
            </p>
          </div>
        )}

        {/* CTA */}
        <div style={{ textAlign: 'center', padding: '48px 24px', background: '#111', borderRadius: '12px', border: '1px solid #1A1A1A' }}>
          <h2 style={{ fontSize: '24px', fontWeight: '400', marginBottom: '12px' }}>
            Sign up to see all jobs and start earning
          </h2>
          <p style={{ fontSize: '14px', color: '#888', marginBottom: '24px', fontFamily: 'system-ui' }}>
            Free account. No credit card. Start earning in {cityName} today.
          </p>
          <Link href="/signup" style={{
            display: 'inline-block', background: '#F5A623', color: '#0A0A0A',
            textDecoration: 'none', fontSize: '14px', fontWeight: '800',
            padding: '16px 40px', borderRadius: '4px', textTransform: 'uppercase',
            letterSpacing: '0.08em', fontFamily: 'system-ui',
          }}>
            Create Free Account
          </Link>
        </div>

        {/* How it works */}
        <div style={{ marginTop: '48px' }}>
          <h3 style={{ fontSize: '11px', letterSpacing: '0.2em', color: '#F5A623', fontFamily: 'system-ui', textTransform: 'uppercase', marginBottom: '20px' }}>How It Works</h3>
          {['Create your free account (2 minutes)', 'See available jobs in your city', 'Submit your load with a photo', 'Get the delivery address by SMS', 'Deliver and get paid'].map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: '14px', marginBottom: '16px', fontFamily: 'system-ui' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', border: '1px solid #F5A623', color: '#F5A623', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', flexShrink: 0 }}>{i + 1}</div>
              <p style={{ fontSize: '14px', color: '#999', lineHeight: '1.6', paddingTop: '4px' }}>{s}</p>
            </div>
          ))}
        </div>
      </section>

      {modalJob && <ClaimJobModal job={modalJob} onClose={() => setModalJob(null)} />}

      <style>{`@media(max-width:768px){.feature-grid{grid-template-columns:1fr!important}}`}</style>
    </main>
  )
}
