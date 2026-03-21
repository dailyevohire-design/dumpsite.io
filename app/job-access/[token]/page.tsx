'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'

export default function JobAccessPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [jobData, setJobData] = useState<any>(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [starting, setStarting] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [revealedData, setRevealedData] = useState<any>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const pingInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch(`/api/driver/job-access/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setError(data.error)
        } else {
          setJobData(data)
          if (data.alreadyStarted && data.address) {
            setRevealed(true)
            setRevealedData({
              address: data.address,
              instructions: data.instructions,
              cityName: data.cityName,
              payDollars: data.payDollars,
            })
          }
        }
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load job details')
        setLoading(false)
      })

    return () => {
      if (pingInterval.current) clearInterval(pingInterval.current)
    }
  }, [token])

  const sendPing = useCallback((loadId: string) => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        fetch('/api/driver/tracking/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loadId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        }).catch(() => {})
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  function startJob() {
    if (!termsAccepted) return
    setStarting(true)
    setLocationError(null)

    if (!navigator.geolocation) {
      setLocationError('Location permission is required to unlock job details.')
      setStarting(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        fetch(`/api/driver/job-access/${token}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            acceptedTerms: true,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.error) {
              setError(data.error)
            } else {
              setRevealedData(data)
              setRevealed(true)
              // Start GPS pings every 20 seconds
              if (jobData?.loadId) {
                sendPing(jobData.loadId)
                pingInterval.current = setInterval(() => sendPing(jobData.loadId), 20000)
              }
            }
            setStarting(false)
          })
          .catch(() => {
            setError('Failed to start job')
            setStarting(false)
          })
      },
      () => {
        setLocationError('Location permission is required to unlock job details.')
        setStarting(false)
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  const containerStyle: React.CSSProperties = {
    background: '#0A0C0F',
    minHeight: '100vh',
    color: '#E8E3DC',
    fontFamily: 'system-ui, sans-serif',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  }

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', color: '#606670' }}>Loading job details...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
          <div style={{ fontWeight: '800', fontSize: '20px', marginBottom: '8px', color: '#E74C3C' }}>
            {error}
          </div>
          <p style={{ color: '#606670', fontSize: '14px' }}>
            If you believe this is an error, contact dispatch.
          </p>
        </div>
      </div>
    )
  }

  if (revealed && revealedData) {
    return (
      <div style={containerStyle}>
        <div style={{ width: '100%', maxWidth: '480px' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: '22px', fontWeight: '700', color: '#F0EDE8' }}>
              DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span>
            </span>
          </div>

          <div style={{ background: 'rgba(39,174,96,0.08)', border: '1px solid rgba(39,174,96,0.25)', borderRadius: '12px', padding: '16px', marginBottom: '16px', textAlign: 'center' }}>
            <div style={{ fontWeight: '800', fontSize: '18px', color: '#27AE60', marginBottom: '4px' }}>Job Started</div>
            <div style={{ fontSize: '13px', color: '#606670' }}>Address unlocked — drive safe!</div>
          </div>

          <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '14px', padding: '20px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700', marginBottom: '6px' }}>Delivery Address</div>
            <div style={{ fontWeight: '800', fontSize: '18px', marginBottom: '16px' }}>
              {revealedData.address}
            </div>

            {revealedData.instructions && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700', marginBottom: '6px' }}>Instructions / Notes</div>
                <div style={{ fontSize: '14px', color: '#E8E3DC' }}>{revealedData.instructions}</div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700' }}>Area</div>
                <div style={{ fontSize: '16px', fontWeight: '700' }}>{revealedData.cityName}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700' }}>Pay</div>
                <div style={{ fontSize: '24px', fontWeight: '900', color: '#F5A623' }}>${revealedData.payDollars}</div>
                <div style={{ fontSize: '11px', color: '#606670' }}>per load</div>
              </div>
            </div>
          </div>

          <div style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.18)', borderRadius: '10px', padding: '14px', textAlign: 'center', fontSize: '14px', color: '#F5A623', fontWeight: '700' }}>
            When you arrive, collect the 6-digit completion code at the site. You will need it to mark the job complete.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: '22px', fontWeight: '700', color: '#F0EDE8' }}>
            DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span>
          </span>
        </div>

        <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '14px', padding: '22px', marginBottom: '16px' }}>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>🚛</div>
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

          <div style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.18)', borderRadius: '9px', padding: '12px', fontSize: '13px', color: '#606670', marginBottom: '16px' }}>
            🔒 Exact delivery address will be shown after you accept the terms and share your location.
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '16px', padding: '12px', background: termsAccepted ? 'rgba(39,174,96,0.05)' : '#0A0C0F', border: `1px solid ${termsAccepted ? 'rgba(39,174,96,0.3)' : '#272B33'}`, borderRadius: '10px' }}>
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={e => setTermsAccepted(e.target.checked)}
              style={{ marginTop: '2px', width: '18px', height: '18px', accentColor: '#27AE60', flexShrink: 0 }}
            />
            <span style={{ fontSize: '13px', color: '#E8E3DC', lineHeight: '1.5' }}>
              I agree not to contact or transact with the customer outside Dumpsite.io. Violation may result in removal and withheld payout.
            </span>
          </label>

          {locationError && (
            <div style={{ background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', color: '#E74C3C', fontSize: '13px' }}>
              {locationError}
            </div>
          )}

          <button
            onClick={startJob}
            disabled={!termsAccepted || starting}
            style={{
              width: '100%',
              background: termsAccepted ? '#F5A623' : '#1C1F24',
              color: termsAccepted ? '#111' : '#606670',
              border: 'none',
              padding: '15px',
              borderRadius: '10px',
              fontWeight: '800',
              fontSize: '16px',
              cursor: (!termsAccepted || starting) ? 'not-allowed' : 'pointer',
              opacity: (!termsAccepted || starting) ? 0.7 : 1,
              textTransform: 'uppercase',
            }}
          >
            {starting ? 'Unlocking...' : 'Start Job and Unlock Address'}
          </button>
        </div>
      </div>
    </div>
  )
}
