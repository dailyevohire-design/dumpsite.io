'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
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

export default function PublicMapPage() {
  const [jobs, setJobs] = useState<PublicJob[]>([])
  const [loading, setLoading] = useState(true)
  const [modalJob, setModalJob] = useState<PublicJob | null>(null)
  const [mounted, setMounted] = useState(false)
  const mapRef = useRef<any>(null)
  const elRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    fetch('/api/public/jobs?limit=50')
      .then(r => r.json())
      .then(d => { if (d.jobs) setJobs(d.jobs) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!mounted || !elRef.current || mapRef.current || jobs.length === 0) return

    import('leaflet').then(L => {
      if (!elRef.current || mapRef.current) return

      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(elRef.current).setView([32.82, -97.1], 9)
      mapRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map)

      setTimeout(() => { map.invalidateSize() }, 200)

      for (const job of jobs) {
        const marker = L.marker([job.lat, job.lng]).addTo(map)
        const popupHtml =
          `<div style='font-family:system-ui,sans-serif;min-width:200px;'>` +
          `<div style='font-weight:700;font-size:16px;margin-bottom:6px;'>${job.cityName}</div>` +
          `<div style='color:#F5A623;font-weight:800;font-size:20px;margin-bottom:4px;'>$${job.payPerLoad}/load</div>` +
          `<div style='color:#888;font-size:13px;margin-bottom:4px;'>${job.yardsNeeded} yards &middot; ${job.truckAccessLabel}</div>` +
          `<button id='map-btn-${job.id}' style='background:#F5A623;color:#111;border:none;padding:10px 0;border-radius:7px;cursor:pointer;font-weight:800;width:100%;font-size:13px;'>Sign Up to Claim &rarr;</button>` +
          `</div>`

        marker.bindPopup(popupHtml)
        marker.on('popupopen', () => {
          setTimeout(() => {
            const btn = document.getElementById(`map-btn-${job.id}`)
            if (btn) btn.onclick = () => setModalJob(job)
          }, 100)
        })
      }
    }).catch(() => {})

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, [mounted, jobs])

  return (
    <main style={{ minHeight: '100vh', background: '#0A0A0A', color: '#F0EDE8', fontFamily: '"Georgia",serif', display: 'flex', flexDirection: 'column' }}>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <style>{`.leaflet-container{background:#1a1a2e!important}`}</style>

      {/* Nav */}
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1A1A1A', background: '#0A0A0A', zIndex: 50, flexShrink: 0 }}>
        <Link href="/" style={{ fontSize: '18px', fontWeight: '700', letterSpacing: '0.02em', textDecoration: 'none', color: '#F0EDE8' }}>
          DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span>
        </Link>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center', fontFamily: 'system-ui' }}>
          <Link href="/#browse-jobs" style={{ color: '#888', textDecoration: 'none', fontSize: '13px' }}>Browse Jobs</Link>
          <Link href="/map-public" style={{ color: '#F5A623', textDecoration: 'none', fontSize: '13px', fontWeight: '700' }}>Map</Link>
          <Link href="/login" style={{ background: '#F5A623', color: '#0A0A0A', textDecoration: 'none', fontSize: '13px', fontWeight: '700', padding: '10px 18px', borderRadius: '4px' }}>SIGN IN</Link>
        </div>
      </nav>

      {/* Map area */}
      <div style={{ flex: 1, position: 'relative', height: 'calc(100vh - 61px)' }}>
        {(loading || !mounted) ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#606670', fontFamily: 'system-ui' }}>
            Loading map...
          </div>
        ) : jobs.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '16px' }}>
            <p style={{ color: '#606670', fontSize: '16px', fontFamily: 'system-ui' }}>No active jobs right now. Check back soon.</p>
            <Link href="/signup" style={{ background: '#F5A623', color: '#0A0A0A', textDecoration: 'none', fontSize: '14px', fontWeight: '800', padding: '14px 32px', borderRadius: '4px', fontFamily: 'system-ui' }}>
              Sign Up for Job Alerts
            </Link>
          </div>
        ) : (
          <>
            <div ref={elRef} style={{ height: '100%', width: '100%' }} />

            {/* Floating job count badge */}
            <div style={{
              position: 'absolute', top: '16px', left: '16px', zIndex: 1000,
              background: 'rgba(0,0,0,0.85)', border: '1px solid #272B33',
              borderRadius: '8px', padding: '10px 16px', fontFamily: 'system-ui',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#27AE60', boxShadow: '0 0 8px rgba(39,174,96,0.5)' }} />
              <span style={{ fontSize: '13px', color: '#E8E3DC', fontWeight: '700' }}>
                {jobs.length} active jobs
              </span>
            </div>

            {/* Floating sign up button */}
            <div style={{ position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000 }}>
              <Link href="/signup" style={{
                display: 'inline-block', background: '#F5A623', color: '#0A0A0A',
                textDecoration: 'none', fontSize: '14px', fontWeight: '800',
                padding: '14px 32px', borderRadius: '8px', fontFamily: 'system-ui',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                Sign Up Free
              </Link>
            </div>
          </>
        )}
      </div>

      {modalJob && <ClaimJobModal job={modalJob} onClose={() => setModalJob(null)} />}
    </main>
  )
}
