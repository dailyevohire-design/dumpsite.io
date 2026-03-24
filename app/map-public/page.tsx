'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

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
  const mapRef = useRef<any>(null)
  const elRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)

  useEffect(() => {
    fetch('/api/public/jobs?limit=50')
      .then(r => r.json())
      .then(d => { if (d.jobs) setJobs(d.jobs) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (loading || initialized.current || !elRef.current) return
    initialized.current = true

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)

    setTimeout(() => {
      import('leaflet').then(L => {
        if (!elRef.current || mapRef.current) return

        delete (L.Icon.Default.prototype as any)._getIconUrl
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        })

        const map = L.map(elRef.current, { zoomControl: true }).setView([32.82, -97.1], 9)
        mapRef.current = map

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 18,
        }).addTo(map)

        map.invalidateSize()

        const displayJobs = jobs.length > 0 ? jobs : [
          { id: 'demo1', cityName: 'Fort Worth', payPerLoad: 45, yardsNeeded: 24, truckAccessLabel: 'Tandem Only', urgency: 'standard', lat: 32.7555, lng: -97.3308, createdAt: '', truckTypeNeeded: 'tandem_axle' },
          { id: 'demo2', cityName: 'Dallas', payPerLoad: 50, yardsNeeded: 100, truckAccessLabel: 'End Dump · 18-Wheeler', urgency: 'urgent', lat: 32.7767, lng: -96.7970, createdAt: '', truckTypeNeeded: 'end_dump' },
          { id: 'demo3', cityName: 'Arlington', payPerLoad: 45, yardsNeeded: 12, truckAccessLabel: 'Tandem Only', urgency: 'standard', lat: 32.7357, lng: -97.1081, createdAt: '', truckTypeNeeded: 'tandem_axle' },
        ]

        for (const job of displayJobs) {
          const marker = L.marker([job.lat, job.lng]).addTo(map)
          marker.bindPopup(
            `<div style='font-family:system-ui;min-width:180px;padding:4px'>` +
            `<div style='font-weight:700;font-size:15px;margin-bottom:4px'>${job.cityName}</div>` +
            `<div style='color:#F5A623;font-weight:800;font-size:22px;margin-bottom:4px'>$${job.payPerLoad}/load</div>` +
            `<div style='color:#666;font-size:12px;margin-bottom:8px'>${job.yardsNeeded} yards &middot; ${job.truckAccessLabel}</div>` +
            `<a href='/signup' style='display:block;background:#F5A623;color:#111;text-align:center;padding:10px;border-radius:6px;font-weight:800;font-size:13px;text-decoration:none'>Sign Up to Claim &rarr;</a>` +
            `</div>`
          )
        }

        setTimeout(() => map.invalidateSize(), 500)
      })
    }, 100)

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, [loading, jobs])

  return (
    <main style={{ background: '#0A0A0A', color: '#F0EDE8', fontFamily: 'Georgia,serif' }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1A1A1A', background: '#0A0A0A' }}>
        <Link href="/" style={{ fontSize: '18px', fontWeight: '700', textDecoration: 'none', color: '#F0EDE8' }}>
          DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span>
        </Link>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', fontFamily: 'system-ui' }}>
          <Link href="/" style={{ color: '#888', textDecoration: 'none', fontSize: '13px' }}>Browse Jobs</Link>
          <Link href="/login" style={{ background: '#F5A623', color: '#0A0A0A', textDecoration: 'none', fontSize: '13px', fontWeight: '700', padding: '10px 18px', borderRadius: '4px' }}>SIGN IN</Link>
        </div>
      </nav>

      <div style={{ position: 'relative' }}>
        {loading ? (
          <div style={{ height: 'calc(100vh - 61px)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#606670', fontFamily: 'system-ui', fontSize: '16px' }}>
            Loading jobs...
          </div>
        ) : (
          <>
            <div
              ref={elRef}
              style={{ height: 'calc(100vh - 61px)', width: '100%' }}
            />
            <div style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 1000, background: 'rgba(0,0,0,0.85)', border: '1px solid #272B33', borderRadius: '8px', padding: '10px 16px', fontFamily: 'system-ui', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#27AE60' }} />
              <span style={{ fontSize: '13px', color: '#E8E3DC', fontWeight: '700' }}>{jobs.length} active jobs</span>
            </div>
            <div style={{ position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000 }}>
              <Link href="/signup" style={{ display: 'inline-block', background: '#F5A623', color: '#0A0A0A', textDecoration: 'none', fontSize: '14px', fontWeight: '800', padding: '14px 32px', borderRadius: '8px', fontFamily: 'system-ui', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Sign Up Free
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
