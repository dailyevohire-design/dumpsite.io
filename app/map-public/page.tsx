'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import ClaimJobModal from '@/components/ClaimJobModal'

const CITY_COORDS: Record<string, [number, number]> = {
  'Dallas': [32.7767, -96.7970],
  'Fort Worth': [32.7555, -97.3308],
  'Arlington': [32.7357, -97.1081],
  'Plano': [33.0198, -96.6989],
  'Irving': [32.8140, -96.9489],
  'Garland': [32.9126, -96.6389],
  'McKinney': [33.1972, -96.6397],
  'Mesquite': [32.7668, -96.5992],
  'Denton': [33.2148, -97.1331],
  'Carrollton': [32.9537, -96.8903],
  'Grand Prairie': [32.7460, -96.9978],
  'Frisco': [33.1507, -96.8236],
  'Midlothian': [32.4818, -96.9942],
  'Cleburne': [32.3512, -97.3864],
  'Mansfield': [32.5632, -97.1417],
  'Azle': [32.8951, -97.5456],
}

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

export default function PublicMapPage() {
  const [jobs, setJobs] = useState<PublicJob[]>([])
  const [loading, setLoading] = useState(true)
  const [modalJob, setModalJob] = useState<PublicJob | null>(null)
  const mapRef = useRef<any>(null)
  const elRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/public/jobs')
      .then(r => r.json())
      .then(d => { if (d.success && d.jobs) setJobs(d.jobs) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!elRef.current || mapRef.current || jobs.length === 0) return

    import('leaflet').then(L => {
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(elRef.current!).setView([32.82, -97.1], 9)
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map)

      // Group jobs by city to show city-center dots only
      const cityJobs: Record<string, PublicJob[]> = {}
      for (const job of jobs) {
        const city = job.city_name || 'DFW'
        if (!cityJobs[city]) cityJobs[city] = []
        cityJobs[city].push(job)
      }

      for (const [city, cityJobList] of Object.entries(cityJobs)) {
        const coords = CITY_COORDS[city]
        if (!coords) continue

        const topJob = cityJobList[0]
        const topPay = Math.round(topJob.driver_pay_cents / 100)

        const marker = L.marker(coords).addTo(map)
        const popupHtml =
          `<div style='font-family:sans-serif;min-width:200px;'>` +
          `<div style='font-weight:700;font-size:15px;margin-bottom:6px;'>${city}</div>` +
          `<div style='color:#F5A623;font-weight:800;font-size:22px;margin-bottom:4px;'>$${topPay}/load</div>` +
          `<div style='color:#888;font-size:12px;margin-bottom:4px;'>${topJob.yards_needed} yards needed</div>` +
          `<div style='color:#888;font-size:11px;margin-bottom:10px;'>${formatTruckType(topJob.truck_type_needed)}</div>` +
          `<div style='font-size:11px;color:#666;margin-bottom:8px;'>${cityJobList.length} job${cityJobList.length > 1 ? 's' : ''} available</div>` +
          `<button id='map-btn-${topJob.id}' style='background:#F5A623;color:#111;border:none;padding:9px 0;border-radius:7px;cursor:pointer;font-weight:800;width:100%;font-size:13px;'>Sign Up to Claim</button>` +
          `</div>`

        marker.bindPopup(popupHtml)
        marker.on('popupopen', () => {
          setTimeout(() => {
            const btn = document.getElementById(`map-btn-${topJob.id}`)
            if (btn) btn.onclick = () => setModalJob(topJob)
          }, 100)
        })
      }
    }).catch(() => {})

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, [jobs])

  return (
    <main style={{ minHeight: '100vh', background: '#0A0A0A', color: '#F0EDE8', fontFamily: '"Georgia",serif' }}>
      {/* Nav */}
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1A1A1A', position: 'sticky', top: 0, background: '#0A0A0A', zIndex: 50 }}>
        <Link href="/" style={{ fontSize: '18px', fontWeight: '700', letterSpacing: '0.02em', textDecoration: 'none', color: '#F0EDE8' }}>
          DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span>
        </Link>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontFamily: 'system-ui' }}>
          <Link href="/map-public" style={{ color: '#F5A623', textDecoration: 'none', fontSize: '13px', fontWeight: '700' }}>MAP</Link>
          <Link href="/signup" style={{ color: '#888', textDecoration: 'none', fontSize: '13px' }}>SIGN UP</Link>
          <Link href="/login" style={{ background: '#F5A623', color: '#0A0A0A', textDecoration: 'none', fontSize: '13px', fontWeight: '700', padding: '10px 18px', borderRadius: '4px' }}>SIGN IN</Link>
        </div>
      </nav>

      <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '40px 24px' }}>
        <h1 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: '400', marginBottom: '8px' }}>
          Dump Truck Jobs Near You
        </h1>
        <p style={{ fontSize: '14px', color: '#666', marginBottom: '24px', fontFamily: 'system-ui' }}>
          City-level view of active hauling jobs across DFW. Sign up to see full details and claim jobs.
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#606670', fontFamily: 'system-ui' }}>
            Loading map...
          </div>
        ) : jobs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <p style={{ color: '#606670', fontSize: '16px', fontFamily: 'system-ui', marginBottom: '20px' }}>No active jobs right now. Check back soon.</p>
            <Link href="/signup" style={{ background: '#F5A623', color: '#0A0A0A', textDecoration: 'none', fontSize: '14px', fontWeight: '800', padding: '14px 32px', borderRadius: '4px', fontFamily: 'system-ui' }}>
              Sign Up for Job Alerts
            </Link>
          </div>
        ) : (
          <>
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <div ref={elRef} style={{ height: '600px', width: '100%', borderRadius: '12px', overflow: 'hidden', border: '1px solid #272B33' }} />
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: '32px' }}>
          <Link href="/signup" style={{
            display: 'inline-block', background: '#F5A623', color: '#0A0A0A',
            textDecoration: 'none', fontSize: '14px', fontWeight: '800',
            padding: '16px 40px', borderRadius: '4px', textTransform: 'uppercase',
            letterSpacing: '0.08em', fontFamily: 'system-ui',
          }}>
            Sign Up Free to Claim Jobs
          </Link>
        </div>
      </section>

      {modalJob && <ClaimJobModal job={modalJob} onClose={() => setModalJob(null)} />}
    </main>
  )
}
