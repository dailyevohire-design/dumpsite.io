'use client'
import { useState, useEffect, useRef } from 'react'

interface Session {
  id: string
  load_request_id: string
  driver_id: string
  terms_accepted_at: string | null
  job_started_at: string | null
  address_revealed_at: string | null
  arrived_at: string | null
  completion_code_verified_at: string | null
  created_at: string
  last_ping_at: string | null
  driver: { first_name: string; last_name: string; phone: string } | null
  load: { status: string; completed_at: string | null; payout_cents: number | null } | null
  city: string
  payDollars: number | null
}

interface Ping { lat: number; lng: number; accuracy_meters: number | null; recorded_at: string }

interface Detail {
  load: any; driver: any; order: any; session: any; token: any; completionCode: any
  pings: Ping[]
  destinationCoords: { lat: number; lng: number } | null
  distanceMiles: number | null
  etaMinutes: number | null
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' })
}

function fmtDuration(start: string | null, end: string | null) {
  if (!start || !end) return '—'
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8 // miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function etaMinutes(miles: number): number {
  return Math.round(miles / 0.5) // ~30mph avg for trucks in city
}

// Simple geocoding from address text — uses city coords as fallback
const CITY_COORDS: Record<string, [number, number]> = {
  'Arlington': [32.7357, -97.1081], 'Dallas': [32.7767, -96.7970], 'Fort Worth': [32.7555, -97.3308],
  'Garland': [32.9126, -96.6389], 'Plano': [33.0198, -96.6989], 'Irving': [32.8140, -96.9489],
  'McKinney': [33.1972, -96.6397], 'Carrollton': [32.9537, -96.8903], 'DeSoto': [32.5896, -96.8572],
  'Mansfield': [32.5632, -97.1411], 'Cedar Hill': [32.5882, -96.9561], 'Midlothian': [32.4821, -97.0053],
  'Grand Prairie': [32.7460, -97.0186], 'Everman': [32.6293, -97.2836], 'Cleburne': [32.3471, -97.3836],
  'Rockwall': [32.9312, -96.4597], 'Terrell': [32.7357, -96.2752], 'Kaufman': [32.5893, -96.3061],
  'Carthage': [32.1582, -94.3394], 'Denison': [33.7557, -96.5369], 'Bonham': [33.5762, -96.1772],
  'Little Elm': [33.1629, -96.9375], 'Princeton': [33.1790, -96.4997], 'Matador': [34.0107, -100.8237],
  'Covington': [32.1751, -97.2614], 'Venus': [32.4307, -97.1006], 'Godley': [32.4432, -97.5317],
  'Joshua': [32.4593, -97.3903], 'Hillsboro': [32.0132, -97.1239], 'Ferris': [32.5293, -96.6639],
  'Azle': [32.8957, -97.5436], 'Haslet': [32.9682, -97.3389], 'Justin': [33.0843, -97.2967],
  'Ponder': [33.1843, -97.2836], 'Lake Worth': [32.8068, -97.4336], 'Colleyville': [32.8868, -97.1505],
  'Hutchins': [32.6432, -96.7083], 'Mabank': [32.3668, -96.1044], 'Gordonville': [33.8032, -96.8561],
}

function getCityCoords(cityName: string): [number, number] | null {
  const exact = CITY_COORDS[cityName]
  if (exact) return exact
  const key = Object.keys(CITY_COORDS).find(k => cityName?.toLowerCase().includes(k.toLowerCase()))
  return key ? CITY_COORDS[key] : null
}

function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: active ? '#27AE60' : '#272B33', boxShadow: active ? '0 0 6px rgba(39,174,96,0.5)' : 'none' }} />
      <span style={{ fontSize: '11px', color: active ? '#27AE60' : '#606670', fontWeight: active ? '700' : '400' }}>{label}</span>
    </div>
  )
}

function getJobPhase(s: Session): { label: string; color: string; bg: string } {
  if (s.load?.status === 'completed') return { label: 'COMPLETED', color: '#3A8AE8', bg: 'rgba(59,138,232,0.12)' }
  if (s.completion_code_verified_at) return { label: 'ON SITE', color: '#27AE60', bg: 'rgba(39,174,96,0.12)' }
  if (s.address_revealed_at) return { label: 'EN ROUTE', color: '#F5A623', bg: 'rgba(245,166,35,0.12)' }
  if (s.job_started_at) return { label: 'STARTED', color: '#F5A623', bg: 'rgba(245,166,35,0.12)' }
  return { label: 'LINK SENT', color: '#606670', bg: 'rgba(96,102,112,0.12)' }
}

// Live Map component using Leaflet
function LiveMap({ pings, destinationCoords, driverName }: { pings: Ping[]; destinationCoords: [number, number] | null; driverName: string }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<any>(null)
  const markersRef = useRef<any[]>([])

  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return

    const loadLeaflet = async () => {
      // @ts-ignore
      const L = (await import('leaflet')).default

      // Fix default icon
      // @ts-ignore
      delete L.Icon.Default.prototype._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      })

      if (mapInstance.current) {
        mapInstance.current.remove()
      }

      const lastPing = pings.length > 0 ? pings[pings.length - 1] : null
      const center: [number, number] = lastPing ? [lastPing.lat, lastPing.lng] : destinationCoords || [32.7767, -96.7970]

      const map = L.map(mapRef.current!, { zoomControl: true }).setView(center, 13)
      mapInstance.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18,
      }).addTo(map)

      // Draw GPS trail
      if (pings.length > 1) {
        const trail = pings.map(p => [p.lat, p.lng] as [number, number])
        L.polyline(trail, { color: '#F5A623', weight: 3, opacity: 0.7 }).addTo(map)
      }

      // First ping (start)
      if (pings.length > 0) {
        const first = pings[0]
        L.circleMarker([first.lat, first.lng], { radius: 8, color: '#27AE60', fillColor: '#27AE60', fillOpacity: 0.8, weight: 2 })
          .bindPopup(`<b>Start</b><br/>${new Date(first.recorded_at).toLocaleTimeString()}`)
          .addTo(map)
      }

      // Latest position (driver)
      if (lastPing) {
        const driverIcon = L.divIcon({
          html: `<div style="background:#F5A623;color:#111;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5)">🚛</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          className: '',
        })
        L.marker([lastPing.lat, lastPing.lng], { icon: driverIcon })
          .bindPopup(`<b>${driverName}</b><br/>Last: ${new Date(lastPing.recorded_at).toLocaleTimeString()}<br/>Accuracy: ${lastPing.accuracy_meters ? `±${Math.round(lastPing.accuracy_meters)}m` : 'N/A'}`)
          .addTo(map)
      }

      // Destination marker
      if (destinationCoords) {
        const destIcon = L.divIcon({
          html: `<div style="background:#E74C3C;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5)">📍</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          className: '',
        })
        L.marker(destinationCoords, { icon: destIcon })
          .bindPopup('<b>Delivery Site</b>')
          .addTo(map)
      }

      // Fit bounds
      const allPoints: [number, number][] = pings.map(p => [p.lat, p.lng])
      if (destinationCoords) allPoints.push(destinationCoords)
      if (allPoints.length > 1) {
        map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] })
      }
    }

    loadLeaflet()

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove()
        mapInstance.current = null
      }
    }
  }, [pings, destinationCoords, driverName])

  return (
    <>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
      <div ref={mapRef} style={{ width: '100%', height: '350px', borderRadius: '10px', overflow: 'hidden' }} />
    </>
  )
}

export default function TrackingPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  async function fetchSessions() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/tracking')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || `API error: ${res.status}`)
        setSessions([])
        return
      }
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch (e: any) {
      setError(e.message || 'Failed to connect')
      setSessions([])
    }
    setLoading(false)
  }

  async function fetchDetail(loadId: string) {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/tracking?loadId=${loadId}`)
      if (!res.ok) { setDetail(null); setDetailLoading(false); return }
      const data = await res.json()
      setDetail(data)
    } catch { setDetail(null) }
    setDetailLoading(false)
  }

  useEffect(() => { fetchSessions() }, [])
  useEffect(() => { if (selectedId) fetchDetail(selectedId); else setDetail(null) }, [selectedId])
  useEffect(() => { const i = setInterval(fetchSessions, 30000); return () => clearInterval(i) }, [])

  // Auto-refresh detail every 15s when viewing
  useEffect(() => {
    if (!selectedId) return
    const i = setInterval(() => fetchDetail(selectedId), 15000)
    return () => clearInterval(i)
  }, [selectedId])

  const lbl: React.CSSProperties = { fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700', marginBottom: '3px' }

  // Use server-calculated distance/ETA + destination coords
  let destCoords: [number, number] | null = null
  let distanceMiles: number | null = null
  let etaMins: number | null = null

  if (detail) {
    // Server provides pre-calculated values
    distanceMiles = detail.distanceMiles
    etaMins = detail.etaMinutes

    // Destination coords for the map
    if (detail.destinationCoords) {
      destCoords = [detail.destinationCoords.lat, detail.destinationCoords.lng]
    } else {
      const cityName = (detail.order?.cities as any)?.name
      destCoords = cityName ? getCityCoords(cityName) : null
    }

    // Client-side fallback if server didn't calculate
    if (distanceMiles === null && detail.pings && detail.pings.length > 0 && destCoords) {
      const lastPing = detail.pings[detail.pings.length - 1]
      distanceMiles = haversine(lastPing.lat, lastPing.lng, destCoords[0], destCoords[1])
      etaMins = etaMinutes(distanceMiles)
    }
  }

  return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', color: '#E8E3DC', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#080A0C', borderBottom: '1px solid #272B33', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: '18px', fontWeight: '700', color: '#F0EDE8' }}>DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span></span>
          <span style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', padding: '4px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Job Tracking</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={fetchSessions} style={{ background: 'transparent', border: '1px solid #272B33', color: '#606670', padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}>Refresh</button>
          <a href="/admin" style={{ background: 'transparent', border: '1px solid #272B33', color: '#606670', padding: '7px 14px', borderRadius: '8px', textDecoration: 'none', fontSize: '12px' }}>← Admin</a>
        </div>
      </div>

      {error && (
        <div style={{ margin: '14px 20px', padding: '13px 16px', borderRadius: '10px', background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.3)', color: '#E74C3C', fontWeight: '600', fontSize: '14px' }}>
          {error} — <button onClick={fetchSessions} style={{ background: 'none', border: 'none', color: '#F5A623', cursor: 'pointer', fontWeight: '800', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}

      <div style={{ display: 'flex', minHeight: 'calc(100vh - 56px)' }}>
        {/* Session List */}
        <div style={{ width: selectedId ? '360px' : '100%', maxWidth: selectedId ? '360px' : '860px', margin: selectedId ? '0' : '0 auto', borderRight: selectedId ? '1px solid #272B33' : 'none', overflowY: 'auto', padding: '16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ fontWeight: '800', fontSize: '16px' }}>Tracked Jobs ({sessions.length})</div>
            <div style={{ fontSize: '11px', color: '#606670' }}>Live refresh 30s</div>
          </div>

          {loading && sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#606670' }}>Loading...</div>
          ) : sessions.length === 0 && !error ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#606670' }}>
              <div style={{ fontSize: '48px', marginBottom: '14px' }}>📡</div>
              <div style={{ fontWeight: '800', fontSize: '18px', marginBottom: '6px' }}>No tracked jobs yet</div>
              <div style={{ fontSize: '13px' }}>Jobs appear here after approval</div>
            </div>
          ) : sessions.map(s => {
            const phase = getJobPhase(s)
            const isLive = s.last_ping_at && (Date.now() - new Date(s.last_ping_at).getTime()) < 120000
            return (
              <div key={s.id} onClick={() => setSelectedId(selectedId === s.load_request_id ? null : s.load_request_id)}
                style={{ background: selectedId === s.load_request_id ? '#1C1F24' : '#111316', border: `1px solid ${selectedId === s.load_request_id ? '#F5A623' : '#272B33'}`, borderRadius: '12px', padding: '14px', marginBottom: '10px', cursor: 'pointer', borderLeft: `3px solid ${phase.color}`, transition: 'all 0.15s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontWeight: '800', fontSize: '15px' }}>{s.driver ? `${s.driver.first_name} ${s.driver.last_name}` : 'Unknown Driver'}</div>
                    <div style={{ fontSize: '12px', color: '#606670', marginTop: '2px' }}>{s.city} {s.payDollars ? `· $${s.payDollars}/load` : ''}</div>
                  </div>
                  <span style={{ background: phase.bg, color: phase.color, padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '800', flexShrink: 0 }}>{phase.label}</span>
                </div>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <StatusDot active={!!s.terms_accepted_at} label="Terms" />
                  <StatusDot active={!!s.address_revealed_at} label="Address" />
                  <StatusDot active={!!isLive} label="GPS" />
                  <StatusDot active={!!s.completion_code_verified_at} label="On Site" />
                  <StatusDot active={s.load?.status === 'completed'} label="Done" />
                </div>
                {isLive && <div style={{ fontSize: '10px', color: '#27AE60', marginTop: '6px', fontWeight: '700' }}>● LIVE — last ping {fmtTime(s.last_ping_at)}</div>}
              </div>
            )
          })}
        </div>

        {/* Detail Panel */}
        {selectedId && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            {detailLoading && !detail ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#606670' }}>Loading...</div>
            ) : !detail ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#606670' }}>Failed to load</div>
            ) : (
              <div style={{ maxWidth: '720px' }}>
                {/* Driver Info Card */}
                <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '14px', padding: '20px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '900', fontSize: '24px', marginBottom: '4px' }}>
                        {detail.driver ? `${detail.driver.first_name} ${detail.driver.last_name}` : 'Unknown Driver'}
                      </div>
                      {detail.driver?.company_name && (
                        <div style={{ fontSize: '14px', color: '#606670', marginBottom: '6px' }}>{detail.driver.company_name}</div>
                      )}
                      {detail.driver?.phone && (
                        <a href={`tel:${detail.driver.phone}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.25)', color: '#F5A623', padding: '6px 14px', borderRadius: '8px', fontSize: '14px', fontWeight: '700', textDecoration: 'none', marginBottom: '8px' }}>
                          📞 {detail.driver.phone}
                        </a>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '16px' }}>
                      {detail.order?.driver_pay_cents && (
                        <>
                          <div style={{ fontWeight: '900', fontSize: '32px', color: '#F5A623', lineHeight: '1' }}>${Math.round(detail.order.driver_pay_cents / 100)}</div>
                          <div style={{ fontSize: '11px', color: '#606670' }}>per load</div>
                        </>
                      )}
                      <div style={{ marginTop: '8px' }}>
                        <span style={{ background: detail.load?.status === 'completed' ? 'rgba(59,138,232,0.15)' : 'rgba(39,174,96,0.15)', color: detail.load?.status === 'completed' ? '#3A8AE8' : '#27AE60', padding: '4px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>
                          {detail.load?.status || 'unknown'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Driver Details Grid */}
                  {detail.driver && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px', padding: '12px', background: '#0A0C0F', borderRadius: '10px' }}>
                      <div>
                        <div style={lbl}>Truck Type</div>
                        <div style={{ fontSize: '13px', fontWeight: '600' }}>{detail.driver.truck_type?.replace(/_/g, ' ') || 'N/A'}</div>
                      </div>
                      <div>
                        <div style={lbl}>Trucks</div>
                        <div style={{ fontSize: '13px', fontWeight: '600' }}>{detail.driver.truck_count || 'N/A'}</div>
                      </div>
                      <div>
                        <div style={lbl}>GPS Score</div>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#F5A623' }}>{detail.driver.gps_score ?? 'N/A'}%</div>
                      </div>
                      <div>
                        <div style={lbl}>Tier</div>
                        <div style={{ fontSize: '13px', fontWeight: '600' }}>{(detail.driver.tiers as any)?.name || 'Trial'}</div>
                      </div>
                      <div>
                        <div style={lbl}>Status</div>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: detail.driver.status === 'active' ? '#27AE60' : '#E74C3C' }}>{detail.driver.status || 'N/A'}</div>
                      </div>
                      <div>
                        <div style={lbl}>Driver ID</div>
                        <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#606670' }}>{detail.load?.driver_id?.slice(0, 8)}...</div>
                      </div>
                    </div>
                  )}

                  {/* Delivery Info */}
                  {detail.order && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div style={{ gridColumn: '1 / -1' }}><div style={lbl}>Delivery Address</div><div style={{ fontSize: '15px', fontWeight: '700' }}>{detail.order.client_address || 'N/A'}</div></div>
                      <div><div style={lbl}>City</div><div style={{ fontSize: '14px', fontWeight: '600' }}>{(detail.order.cities as any)?.name || 'N/A'}</div></div>
                      {detail.order.client_name && <div><div style={lbl}>Client</div><div style={{ fontSize: '14px' }}>{detail.order.client_name}</div></div>}
                    </div>
                  )}
                </div>

                {/* Distance & ETA */}
                <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                  <div style={{ flex: 1, background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.18)', borderRadius: '12px', padding: '18px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#FFFFFF', fontWeight: '700', marginBottom: '6px' }}>Distance to Site</div>
                    {distanceMiles !== null ? (
                      <>
                        <div style={{ fontSize: '36px', fontWeight: '900', color: '#F5A623', lineHeight: '1' }}>{distanceMiles < 1 ? distanceMiles.toFixed(1) : Math.round(distanceMiles)}</div>
                        <div style={{ fontSize: '13px', color: '#FFFFFF', marginTop: '4px' }}>miles</div>
                      </>
                    ) : (
                      <div style={{ fontSize: '16px', color: '#606670', padding: '8px 0' }}>Waiting for GPS</div>
                    )}
                  </div>
                  <div style={{ flex: 1, background: 'rgba(59,138,232,0.07)', border: '1px solid rgba(59,138,232,0.18)', borderRadius: '12px', padding: '18px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#FFFFFF', fontWeight: '700', marginBottom: '6px' }}>Est. Arrival</div>
                    {etaMins !== null ? (
                      <>
                        <div style={{ fontSize: '36px', fontWeight: '900', color: '#3A8AE8', lineHeight: '1' }}>{etaMins < 60 ? etaMins : `${Math.floor(etaMins / 60)}h ${etaMins % 60}m`}</div>
                        <div style={{ fontSize: '13px', color: '#FFFFFF', marginTop: '4px' }}>{etaMins < 60 ? 'minutes' : ''}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: '16px', color: '#606670', padding: '8px 0' }}>Waiting for GPS</div>
                    )}
                  </div>
                </div>

                {/* Live Map */}
                <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '14px', padding: '20px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ fontWeight: '800', fontSize: '15px' }}>Live Map</div>
                    <div style={{ fontSize: '11px', color: '#606670' }}>{detail.pings?.length || 0} pings · refreshes 15s</div>
                  </div>
                  {detail.pings?.length > 0 ? (
                    <LiveMap
                      pings={detail.pings}
                      destinationCoords={destCoords}
                      driverName={detail.driver ? `${detail.driver.first_name} ${detail.driver.last_name}` : 'Driver'}
                    />
                  ) : (
                    <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0A0C0F', borderRadius: '10px', color: '#606670', fontSize: '13px' }}>
                      No GPS data yet — map will appear when driver starts the job
                    </div>
                  )}
                </div>

                {/* Timeline */}
                <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '14px', padding: '20px', marginBottom: '16px' }}>
                  <div style={{ fontWeight: '800', fontSize: '15px', marginBottom: '16px' }}>Timeline</div>
                  {[
                    { label: 'Link Sent', time: detail.token?.created_at, icon: '🔗' },
                    { label: 'Link Opened', time: detail.token?.used_at, icon: '🚀' },
                    { label: 'Terms Accepted', time: detail.session?.terms_accepted_at, icon: '✅' },
                    { label: 'Address Revealed', time: detail.session?.address_revealed_at, icon: '📍' },
                    { label: 'First GPS Ping', time: detail.pings?.[0]?.recorded_at, icon: '📡' },
                    { label: 'Arrived On-Site', time: detail.session?.arrived_at, icon: '🏗️' },
                    { label: 'GPS Verified On Site', time: detail.session?.completion_code_verified_at, icon: '📍' },
                    { label: 'Completed', time: detail.load?.completed_at, icon: '🎉' },
                  ].map((step, i, arr) => (
                    <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: '10px', alignItems: 'center' }}>
                      <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: step.time ? 'rgba(39,174,96,0.15)' : '#1C1F24', border: `1px solid ${step.time ? 'rgba(39,174,96,0.3)' : '#272B33'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0 }}>
                        {step.time ? step.icon : '○'}
                      </div>
                      <div style={{ flex: 1, fontSize: '13px', fontWeight: step.time ? '700' : '400', color: step.time ? '#E8E3DC' : '#606670' }}>{step.label}</div>
                      <div style={{ fontSize: '11px', color: '#606670', flexShrink: 0 }}>{fmtTime(step.time)}</div>
                    </div>
                  ))}
                </div>

                {/* Payout */}
                {detail.load?.payout_cents && (
                  <div style={{ background: 'rgba(59,138,232,0.08)', border: '1px solid rgba(59,138,232,0.2)', borderRadius: '14px', padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700', marginBottom: '4px' }}>Total Payout</div>
                    <div style={{ fontSize: '36px', fontWeight: '900', color: '#3A8AE8' }}>${Math.round(detail.load.payout_cents / 100)}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
