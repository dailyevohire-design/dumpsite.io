'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase'
import ErrorBoundary from '@/components/ErrorBoundary'
import { trackEvent } from '@/lib/posthog'

export default function JobAccessPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [jobData, setJobData] = useState<any>(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [starting, setStarting] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [revealedData, setRevealedData] = useState<any>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const pingInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // Distance preview (shown before start)
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null)

  // Completion state
  const [arrived, setArrived] = useState(false)
  const [geoUnavailable, setGeoUnavailable] = useState(false)
  const [loadsSelected, setLoadsSelected] = useState(1)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [completedData, setCompletedData] = useState<any>(null)
  const [currentPos, setCurrentPos] = useState<{ lat: number; lng: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const watchRef = useRef<number | null>(null)

  // Submission overlay state
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [overlayText, setOverlayText] = useState('Submitting your delivery...')
  const [compressing, setCompressing] = useState(false)
  const [fadeIn, setFadeIn] = useState(false)

  // Post-completion earnings state (Task 2)
  const [earnings, setEarnings] = useState<any>(null)
  const [nextJob, setNextJob] = useState<any>(null)
  const [animatedAmount, setAnimatedAmount] = useState(0)

  useEffect(() => {
    fetch(`/api/driver/job-access/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error) }
        else {
          setJobData(data)
          trackEvent('job_access_opened', { city: data.cityName })
          if (data.alreadyStarted && data.address) {
            setRevealed(true)
            setRevealedData({ address: data.address, instructions: data.instructions, cityName: data.cityName, payDollars: data.payDollars })
          }
        }
        setLoading(false)
      })
      .catch(() => { setError('Failed to load job details'); setLoading(false) })

    return () => {
      if (pingInterval.current) clearInterval(pingInterval.current)
      if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current)
    }
  }, [token])

  // Use server-calculated distance (from driver's pickup location to delivery site)
  useEffect(() => {
    if (jobData?.distanceMiles) {
      setDistanceMiles(jobData.distanceMiles)
    }
  }, [jobData])

  // Geofence watching after reveal
  useEffect(() => {
    if (!revealed || !revealedData) return
    if (!navigator.geolocation) { setGeoUnavailable(true); return }

    const addr = revealedData.address
    if (!addr) { setGeoUnavailable(true); return }

    let destLat: number | null = null
    let destLng: number | null = null

    fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`, { headers: { 'User-Agent': 'DumpSite.io/1.0' } })
      .then(r => r.json())
      .then(geo => {
        if (geo?.[0]) { destLat = parseFloat(geo[0].lat); destLng = parseFloat(geo[0].lon) }
      })
      .catch(() => {})

    const checkDistance = (lat: number, lng: number) => {
      setCurrentPos({ lat, lng })
      if (destLat === null || destLng === null) return
      const R = 6371000
      const dLat = (destLat - lat) * Math.PI / 180
      const dLng = (destLng - lng) * Math.PI / 180
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      if (dist <= 800) setArrived(true)
    }

    watchRef.current = navigator.geolocation.watchPosition(
      pos => checkDistance(pos.coords.latitude, pos.coords.longitude),
      () => setGeoUnavailable(true),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    )
  }, [revealed, revealedData])

  // Fetch earnings + next job after completion
  useEffect(() => {
    if (!completed) return
    fetch('/api/driver/earnings-today')
      .then(r => r.json())
      .then(data => setEarnings(data))
      .catch(() => {})
    fetch('/api/driver/jobs')
      .then(r => r.json())
      .then(data => {
        const jobs = data.jobs || []
        if (jobs.length > 0) setNextJob(jobs[0])
      })
      .catch(() => {})
  }, [completed])

  // Animated earnings counter — use completedData.total (from completion API) not earnings endpoint
  useEffect(() => {
    if (!completed || !completedData) return
    const target = completedData.total || 0
    if (target === 0) { setAnimatedAmount(0); return }
    const steps = 20
    const stepTime = 50
    let current = 0
    const increment = target / steps
    const timer = setInterval(() => {
      current += increment
      if (current >= target) {
        setAnimatedAmount(target)
        clearInterval(timer)
      } else {
        setAnimatedAmount(Math.round(current))
      }
    }, stepTime)
    return () => clearInterval(timer)
  }, [completed, completedData])

  const sendPing = useCallback((loadId: string) => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => {
        fetch('/api/driver/tracking/ping', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loadId, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        }).catch(() => {})
      }, () => {}, { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  function callStartApi(lat: number | null, lng: number | null, accuracy: number | null) {
    fetch(`/api/driver/job-access/${token}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acceptedTerms: true, lat, lng, accuracy }),
    }).then(r => r.json()).then(data => {
      if (data.error) { setError(data.error) }
      else {
        setRevealedData(data); setRevealed(true); trackEvent('address_revealed', { city: data.cityName })
        if (jobData?.loadId) { sendPing(jobData.loadId); pingInterval.current = setInterval(() => sendPing(jobData.loadId), 20000) }
      }
      setStarting(false)
    }).catch(() => { setError('Failed to start job'); setStarting(false) })
  }

  function startJob() {
    if (!termsAccepted) return
    setStarting(true); setLocationError(null)

    if (!navigator.geolocation) {
      // No geolocation API — proceed without GPS (will be flagged for review but not blocked)
      callStartApi(null, null, null)
      return
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        callStartApi(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy)
      },
      () => {
        // GPS denied/failed — show instructions but still let them proceed
        setLocationError('tap_allow')
        setStarting(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  function skipGpsAndStart() {
    setStarting(true)
    setLocationError(null)
    callStartApi(null, null, null)
  }

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setSubmitError('Please select an image file'); return }

    // Always compress on mobile to avoid memory issues — threshold lowered to 2MB
    if (file.size > 2 * 1024 * 1024) {
      setCompressing(true)
      const objUrl = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          const maxDim = 1280 // Lower max for mobile memory safety
          let w = img.width, h = img.height
          if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round(h * maxDim / w); w = maxDim }
            else { w = Math.round(w * maxDim / h); h = maxDim }
          }
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) { setPhoto(file); setPhotoPreview(objUrl); setCompressing(false); return }
          ctx.drawImage(img, 0, 0, w, h)
          canvas.toBlob(blob => {
            // Free canvas memory immediately
            canvas.width = 0; canvas.height = 0
            if (blob) {
              const compressed = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
              setPhoto(compressed)
              setPhotoPreview(URL.createObjectURL(compressed))
            } else {
              // Fallback: use original file if compression fails
              setPhoto(file)
              setPhotoPreview(objUrl)
            }
            setCompressing(false)
          }, 'image/jpeg', 0.75)
        } catch {
          // Compression failed (memory) — use original file
          setPhoto(file)
          setPhotoPreview(objUrl)
          setCompressing(false)
        }
      }
      img.onerror = () => {
        setPhoto(file)
        setPhotoPreview(objUrl)
        setCompressing(false)
      }
      img.src = objUrl
    } else {
      // Small file — use object URL (no base64 in memory)
      setPhoto(file)
      setPhotoPreview(URL.createObjectURL(file))
    }
    setSubmitError(null)
  }

  async function submitCompletion() {
    if (!photo || !jobData?.loadId) return
    setSubmitting(true); setSubmitError(null)
    setOverlayVisible(true)
    setOverlayText('Submitting your delivery...')

    try {
      const supabase = createBrowserSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setSubmitError('Please log in and try again'); setSubmitting(false); setOverlayVisible(false); return }

      // Upload photo via Supabase SDK (reliable on mobile)
      setOverlayText('Uploading photo...')
      const ext = photo.name.split('.').pop() || 'jpg'
      const filePath = `${user.id}/completions/${Date.now()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('dirt-photos')
        .upload(filePath, photo, { upsert: false })

      if (uploadErr) {
        setSubmitError('Photo upload failed — tap to retry')
        setSubmitting(false)
        setOverlayVisible(false)
        return
      }

      const { data: urlData } = supabase.storage.from('dirt-photos').getPublicUrl(filePath)
      setOverlayText('Verifying delivery...')

      // Submit completion
      const res = await fetch('/api/driver/complete-load', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loadId: jobData.loadId,
          completionPhotoUrl: urlData.publicUrl,
          loadsDelivered: loadsSelected,
          photoLat: currentPos?.lat,
          photoLng: currentPos?.lng,
        }),
      })
      const data = await res.json()
      if (!data.success) { setSubmitError(data.error || 'Submission failed — try again'); setSubmitting(false); setOverlayVisible(false); return }

      // Success — fade out overlay, fade in success screen
      setCompletedData({ loads: loadsSelected, total: data.totalPayDollars })
      trackEvent('completion_submitted', { loadsDelivered: loadsSelected, earnedDollars: data.totalPayDollars })
      setOverlayVisible(false)
      setFadeIn(true)
      setCompleted(true)
    } catch {
      setSubmitError('Network error — try again')
      setOverlayVisible(false)
    }
    setSubmitting(false)
  }

  function resetForAnotherTrip() {
    setCompleted(false)
    setCompletedData(null)
    setPhoto(null)
    setPhotoPreview(null)
    setLoadsSelected(1)
    setSubmitError(null)
    setFadeIn(false)
    setEarnings(null)
    setNextJob(null)
    setAnimatedAmount(0)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cs: React.CSSProperties = { background: '#0A0C0F', minHeight: '100vh', color: '#E8E3DC', fontFamily: 'system-ui, sans-serif', padding: '20px', overflowX: 'hidden' }

  if (loading) return <div style={{ ...cs, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ color: '#606670' }}>Loading job details...</div></div>

  if (error) return (<ErrorBoundary>
    <div style={{ ...cs, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: '400px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
        <div style={{ fontWeight: '800', fontSize: '20px', marginBottom: '8px', color: '#E74C3C' }}>{error}</div>
        <p style={{ color: '#606670', fontSize: '14px', marginBottom: '16px' }}>Need help? We're here for you.</p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="sms:+19452938600" style={{ background: '#1C1F24', border: '1px solid #272B33', color: '#E8E3DC', padding: '10px 18px', borderRadius: '8px', textDecoration: 'none', fontSize: '13px', fontWeight: '700' }}>Text (945) 293-8600</a>
          <a href="mailto:support@dumpsite.io" style={{ background: '#1C1F24', border: '1px solid #272B33', color: '#E8E3DC', padding: '10px 18px', borderRadius: '8px', textDecoration: 'none', fontSize: '13px', fontWeight: '700' }}>Email Support</a>
        </div>
      </div>
    </div>
  </ErrorBoundary>)

  // ── REVEALED STATE: Address + Inline Completion ──
  if (revealed && revealedData) {
    const payPerLoad = revealedData.payDollars || 20
    const totalPay = payPerLoad * loadsSelected

    // ── SUCCESS STATE — Redesigned (Task 2) ──
    if (completed && completedData) {
      return (<ErrorBoundary>
        <div style={{ ...cs, opacity: fadeIn ? 1 : 0, transition: 'opacity 0.4s ease-in' }}>
          <div style={{ width: '100%', maxWidth: '480px', margin: '0 auto' }}>

            {/* SECTION 1 — Earnings Hero */}
            <div style={{
              background: 'rgba(39,174,96,0.1)', border: '1px solid rgba(39,174,96,0.3)',
              borderRadius: '16px', padding: '32px', textAlign: 'center', marginBottom: '16px',
            }}>
              <div style={{ fontSize: '64px', fontWeight: '900', color: '#27AE60', lineHeight: 1, marginBottom: '8px' }}>
                ${animatedAmount}
              </div>
              <div style={{ fontSize: '15px', color: '#E8E3DC', fontWeight: '600' }}>
                {completedData.loads} load{completedData.loads > 1 ? 's' : ''} delivered
              </div>
              <div style={{ fontSize: '13px', color: '#606670', marginTop: '4px' }}>
                Payment within 24 hours
              </div>
            </div>

            {/* SECTION 2 — Running Totals Bar */}
            {earnings && (
              <div style={{
                background: '#111316', border: '1px solid #272B33', borderRadius: '12px',
                padding: '14px 18px', marginBottom: '16px', display: 'flex', justifyContent: 'space-around',
              }}>
                <div style={{ fontSize: '14px', color: '#606670', fontFamily: 'system-ui' }}>
                  Today: <span style={{ color: '#F5A623', fontWeight: '700' }}>${earnings.todayEarnings || 0}</span>
                </div>
                <div style={{ fontSize: '14px', color: '#606670', fontFamily: 'system-ui' }}>
                  Month: <span style={{ color: '#F5A623', fontWeight: '700' }}>{earnings.monthLoads} loads</span> · <span style={{ color: '#F5A623', fontWeight: '700' }}>${earnings.monthEarnings}</span>
                </div>
              </div>
            )}

            {/* SECTION 3 — Next Job Card */}
            {nextJob ? (
              <div style={{
                background: '#111316', border: '1px solid #272B33', borderLeft: '3px solid #27AE60',
                borderRadius: '12px', padding: '16px', marginBottom: '16px',
              }}>
                <div style={{ fontWeight: '800', fontSize: '16px', marginBottom: '6px' }}>
                  Another job in {nextJob.cities?.name || 'your area'}
                </div>
                <div style={{ fontSize: '14px', color: '#F5A623', fontWeight: '700', marginBottom: '12px' }}>
                  ${Math.round((nextJob.driver_pay_cents || 2000) / 100)}/load · {nextJob.yards_needed} yards needed
                </div>
                <button
                  onClick={() => router.push('/dashboard')}
                  style={{
                    width: '100%', background: '#F5A623', color: '#111', border: 'none',
                    padding: '14px', borderRadius: '10px', fontWeight: '800', fontSize: '15px', cursor: 'pointer',
                  }}
                >
                  Claim This Job →
                </button>
              </div>
            ) : (
              <div style={{
                background: '#111316', border: '1px solid #272B33', borderRadius: '12px',
                padding: '16px', marginBottom: '16px', textAlign: 'center',
              }}>
                <div style={{ fontSize: '15px', fontWeight: '700', marginBottom: '4px' }}>No jobs right now</div>
                <div style={{ fontSize: '13px', color: '#606670' }}>
                  We will notify you the moment one posts in your city.
                </div>
              </div>
            )}

            {/* SECTION 4 — Action Buttons */}
            <button
              onClick={() => router.push('/dashboard')}
              style={{
                width: '100%', background: '#F5A623', color: '#111', border: 'none',
                padding: '16px', borderRadius: '10px', fontWeight: '800', fontSize: '16px',
                cursor: 'pointer', height: '52px',
              }}
            >
              Find More Jobs
            </button>
            <button
              onClick={resetForAnotherTrip}
              style={{
                width: '100%', background: 'transparent', color: '#606670',
                border: '1px solid #272B33', padding: '12px', borderRadius: '10px',
                fontWeight: '700', fontSize: '14px', cursor: 'pointer', height: '44px', marginTop: '10px',
              }}
            >
              Same site, another trip
            </button>
          </div>
        </div>
      </ErrorBoundary>)
    }

    return (<ErrorBoundary>
      <div style={cs}>
        <div style={{ width: '100%', maxWidth: '480px', margin: '0 auto' }}>
          {/* Loading Overlay (Task 6) */}
          {overlayVisible && (
            <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
              background: 'rgba(10,12,15,0.95)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexDirection: 'column',
            }}>
              <div style={{
                width: '40px', height: '40px', border: '3px solid #272B33',
                borderTop: '3px solid #F5A623', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite', marginBottom: '20px',
              }} />
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#E8E3DC', marginBottom: '8px' }}>{overlayText}</div>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}

          {/* Compressing indicator */}
          {compressing && (
            <div style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)', borderRadius: '10px', padding: '10px', marginBottom: '14px', textAlign: 'center', fontSize: '12px', color: '#F5A623' }}>
              Optimizing photo...
            </div>
          )}

          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: '20px', fontWeight: '700', color: '#F0EDE8' }}>DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span></span>
          </div>

          {/* Arrival Status */}
          {arrived ? (
            <div style={{ background: 'rgba(39,174,96,0.1)', border: '1px solid rgba(39,174,96,0.3)', borderRadius: '10px', padding: '12px', marginBottom: '14px', textAlign: 'center' }}>
              <div style={{ fontWeight: '800', fontSize: '15px', color: '#27AE60' }}>You are at the site — ready to complete</div>
            </div>
          ) : geoUnavailable ? (
            <div style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)', borderRadius: '10px', padding: '10px', marginBottom: '14px', textAlign: 'center', fontSize: '12px', color: '#F5A623' }}>
              Location unavailable — you can still complete below
            </div>
          ) : (
            <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '10px', padding: '10px', marginBottom: '14px', textAlign: 'center', fontSize: '12px', color: '#606670' }}>
              Tracking your location...
            </div>
          )}

          {/* Address Card */}
          <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '12px', padding: '16px', marginBottom: '14px' }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700', marginBottom: '4px' }}>Delivery Address</div>
            <div style={{ fontWeight: '800', fontSize: '17px', marginBottom: '10px' }}>{revealedData.address}</div>
            {revealedData.instructions && <div style={{ fontSize: '13px', color: '#999', marginBottom: '10px' }}>{revealedData.instructions}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div><div style={{ fontSize: '10px', color: '#606670', textTransform: 'uppercase', fontWeight: '700' }}>Area</div><div style={{ fontSize: '14px', fontWeight: '700' }}>{revealedData.cityName}</div></div>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: '10px', color: '#606670', textTransform: 'uppercase', fontWeight: '700' }}>Pay</div><div style={{ fontSize: '22px', fontWeight: '900', color: '#F5A623' }}>${payPerLoad}<span style={{ fontSize: '12px', color: '#606670' }}>/load</span></div></div>
            </div>
          </div>

          {/* ── COMPLETE YOUR DELIVERY ── */}
          <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontWeight: '800', fontSize: '16px', marginBottom: '14px' }}>Complete Your Delivery</div>

            {submitError && <div style={{ background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '8px', padding: '10px', marginBottom: '12px', color: '#E74C3C', fontSize: '13px' }}>{submitError}</div>}

            {/* Step 1: Load Count */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700', marginBottom: '8px' }}>How many loads?</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                {[1, 2, 3, 4, 5, 6, 7].map(n => (
                  <button key={n} onClick={() => setLoadsSelected(n)} style={{
                    minWidth: '52px', height: '52px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: '800', fontSize: '18px',
                    background: loadsSelected === n ? '#F5A623' : '#1C1F24', color: loadsSelected === n ? '#111' : '#606670',
                  }}>{n}</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#606670', fontWeight: '700', whiteSpace: 'nowrap' }}>Or enter exact:</span>
                <input
                  type="number" inputMode="numeric" min="1" max="200"
                  value={loadsSelected}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1 && v <= 200) setLoadsSelected(v) }}
                  style={{ background: '#1C1F24', border: '1px solid #272B33', color: '#F5A623', padding: '10px 14px', borderRadius: '9px', fontSize: '18px', fontWeight: '800', width: '80px', textAlign: 'center', outline: 'none' }}
                />
                <span style={{ fontSize: '12px', color: '#606670' }}>loads</span>
              </div>
              <div style={{ marginTop: '8px', background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.15)', borderRadius: '8px', padding: '10px', fontSize: '15px', color: '#F5A623', fontWeight: '700', textAlign: 'center' }}>
                {loadsSelected} load{loadsSelected > 1 ? 's' : ''} × ${payPerLoad} = <span style={{ fontSize: '20px' }}>${totalPay}</span> total
              </div>
            </div>

            {/* Step 2: Photo */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700', marginBottom: '8px' }}>Delivery Photo</div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
              <div onClick={() => fileRef.current?.click()} style={{
                border: `2px dashed ${photo ? '#27AE60' : '#272B33'}`, borderRadius: '12px', padding: photo ? '12px' : '24px', textAlign: 'center', cursor: 'pointer',
                background: photo ? 'rgba(39,174,96,0.05)' : '#0A0C0F', minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
              }}>
                {photoPreview ? (
                  <>
                    <img src={photoPreview} alt="Delivery" style={{ maxHeight: '140px', maxWidth: '100%', borderRadius: '8px', marginBottom: '8px' }} />
                    <div style={{ fontSize: '12px', color: '#27AE60', fontWeight: '700' }}>Photo ready — tap to replace</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '40px', marginBottom: '8px' }}>📷</div>
                    <div style={{ fontSize: '15px', fontWeight: '700', marginBottom: '4px' }}>Tap to take delivery photo</div>
                    <div style={{ fontSize: '12px', color: '#606670' }}>Take a photo at the delivery site</div>
                  </>
                )}
              </div>
            </div>

            {/* Step 3: Submit */}
            <button
              onClick={submitCompletion}
              disabled={submitting || !photo}
              style={{
                width: '100%', padding: '16px', borderRadius: '10px', border: 'none', fontWeight: '800', fontSize: '16px', cursor: (submitting || !photo) ? 'not-allowed' : 'pointer',
                background: photo ? '#F5A623' : '#272B33', color: photo ? '#111' : '#606670', opacity: submitting ? 0.7 : 1, minHeight: '52px',
              }}
            >
              {submitting ? 'Submitting...' : photo ? `Submit ${loadsSelected} Load${loadsSelected > 1 ? 's' : ''} — Earn $${totalPay}` : 'Take photo to submit'}
            </button>
          </div>
        </div>
      </div>
    </ErrorBoundary>)
  }

  // ── PRE-REVEAL: Terms Acceptance ──
  return (<ErrorBoundary>
    <div style={{ ...cs, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: '22px', fontWeight: '700', color: '#F0EDE8' }}>DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span></span>
        </div>

        <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '14px', padding: '22px' }}>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <div style={{ fontWeight: '800', fontSize: '22px', marginBottom: '4px' }}>Your Approved Job</div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700' }}>Area</div>
              <div style={{ fontSize: '18px', fontWeight: '800' }}>{jobData.cityName}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700' }}>Pay</div>
              <div style={{ fontSize: '36px', fontWeight: '900', color: '#F5A623', lineHeight: '1' }}>${jobData.payDollars}</div>
              <div style={{ fontSize: '11px', color: '#606670' }}>per load</div>
            </div>
          </div>

          {distanceMiles !== null && (
            <div style={{ background: 'rgba(59,138,232,0.08)', border: '1px solid rgba(59,138,232,0.25)', borderRadius: '10px', padding: '14px', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700' }}>Distance to dump site</div>
                <div style={{ fontSize: '28px', fontWeight: '900', color: '#3A8AE8' }}>{distanceMiles} <span style={{ fontSize: '14px', fontWeight: '600' }}>miles</span></div>
              </div>
              <div style={{ fontSize: '12px', color: '#606670', textAlign: 'right', maxWidth: '140px' }}>
                ~{Math.round(distanceMiles * 2)} min drive
              </div>
            </div>
          )}

          <div style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.18)', borderRadius: '9px', padding: '12px', fontSize: '13px', color: '#606670', marginBottom: '16px' }}>
            Exact delivery address will be shown after you accept the terms below.
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '16px', padding: '12px', background: termsAccepted ? 'rgba(39,174,96,0.05)' : '#0A0C0F', border: `1px solid ${termsAccepted ? 'rgba(39,174,96,0.3)' : '#272B33'}`, borderRadius: '10px' }}>
            <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} style={{ marginTop: '2px', width: '18px', height: '18px', accentColor: '#27AE60', flexShrink: 0 }} />
            <span style={{ fontSize: '13px', color: '#E8E3DC', lineHeight: '1.5' }}>I agree not to contact or transact with the customer outside Dumpsite.io. Violation may result in removal and withheld payout.</span>
          </label>

          {locationError === 'tap_allow' && (
            <div style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.3)', borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
              <div style={{ fontWeight: '800', fontSize: '14px', color: '#F5A623', marginBottom: '6px' }}>Location Permission Needed</div>
              <div style={{ fontSize: '13px', color: '#E8E3DC', lineHeight: '1.5', marginBottom: '10px' }}>
                GPS tracking verifies your delivery and speeds up your payout. Tap the button below, then tap <strong>"Allow"</strong> when your phone asks.
              </div>
              <div style={{ fontSize: '12px', color: '#606670', marginBottom: '12px' }}>
                If you already denied it: tap the lock icon in your address bar &gt; Permissions &gt; Location &gt; Allow, then retry.
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={startJob} style={{ flex: 2, background: '#F5A623', color: '#111', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: '800', fontSize: '14px', cursor: 'pointer' }}>
                  Retry with Location
                </button>
                <button onClick={skipGpsAndStart} style={{ flex: 1, background: 'transparent', color: '#606670', border: '1px solid #272B33', padding: '12px', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
                  Skip GPS
                </button>
              </div>
            </div>
          )}

          {locationError && locationError !== 'tap_allow' && <div style={{ background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', color: '#E74C3C', fontSize: '13px' }}>{locationError}</div>}

          <button onClick={startJob} disabled={!termsAccepted || starting} style={{
            width: '100%', background: termsAccepted ? '#F5A623' : '#1C1F24', color: termsAccepted ? '#111' : '#606670', border: 'none', padding: '15px', borderRadius: '10px',
            fontWeight: '800', fontSize: '16px', cursor: (!termsAccepted || starting) ? 'not-allowed' : 'pointer', opacity: (!termsAccepted || starting) ? 0.7 : 1, textTransform: 'uppercase',
          }}>
            {starting ? 'Unlocking...' : 'Start Job and Unlock Address'}
          </button>
        </div>
      </div>
    </div>
  </ErrorBoundary>)
}
