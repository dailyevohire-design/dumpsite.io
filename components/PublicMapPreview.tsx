'use client'
import { useState, useEffect, useRef } from 'react'
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

export default function PublicMapPreview() {
  const [jobs, setJobs] = useState<PublicJob[]>([])
  const [loading, setLoading] = useState(true)
  const [modalJob, setModalJob] = useState<PublicJob | null>(null)
  const mapRef = useRef<any>(null)
  const elRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/public/jobs?limit=20')
      .then(r => r.json())
      .then(d => { if (d.jobs) setJobs(d.jobs) })
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

      const map = L.map(elRef.current!, { scrollWheelZoom: false }).setView([32.82, -97.1], 9)
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map)

      // Individual pin per job — each with jittered city center coords from API
      for (const job of jobs) {
        const marker = L.marker([job.lat, job.lng]).addTo(map)
        const popupHtml =
          `<div style='font-family:sans-serif;min-width:200px;'>` +
          `<div style='font-weight:700;font-size:16px;margin-bottom:6px;'>${job.cityName}</div>` +
          `<div style='color:#F5A623;font-weight:800;font-size:20px;margin-bottom:4px;'>$${job.payPerLoad}/load</div>` +
          `<div style='color:#888;font-size:13px;margin-bottom:4px;'>${job.yardsNeeded} yards &middot; ${job.truckAccessLabel}</div>` +
          `<button id='preview-btn-${job.id}' style='background:#F5A623;color:#111;border:none;padding:9px 0;border-radius:7px;cursor:pointer;font-weight:800;width:100%;font-size:13px;'>Sign Up to Claim</button>` +
          `</div>`

        marker.bindPopup(popupHtml)
        marker.on('popupopen', () => {
          setTimeout(() => {
            const btn = document.getElementById(`preview-btn-${job.id}`)
            if (btn) btn.onclick = () => setModalJob(job)
          }, 100)
        })
      }
    }).catch(() => {})

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, [jobs])

  if (loading) {
    return (
      <div style={{ height: '400px', background: '#111316', borderRadius: '12px', border: '1px solid #272B33', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#606670', fontFamily: 'system-ui', fontSize: '14px' }}>Loading map...</span>
      </div>
    )
  }

  if (jobs.length === 0) return null

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div className="map-preview-container" ref={elRef} style={{ height: '400px', width: '100%', borderRadius: '12px', overflow: 'hidden', border: '1px solid #272B33' }} />
      {modalJob && <ClaimJobModal job={modalJob} onClose={() => setModalJob(null)} />}
      <style>{`@media(max-width:640px){.map-preview-container{height:300px!important}}`}</style>
    </>
  )
}
