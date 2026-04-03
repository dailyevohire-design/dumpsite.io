'use client'
import { useState, useEffect, useRef } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

interface Job {
  id: string
  yards_needed: number
  driver_pay_cents: number
  truck_type_needed: string
  urgency: string
  cities: { name: string } | null
}

type SubmitStep = 'select' | 'form' | 'uploading' | 'done' | 'error'

export default function DriverJobsPage() {
  const [user, setUser] = useState<any>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [myLoads, setMyLoads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'jobs' | 'my-loads'>('jobs')
  const router = useRouter()

  // Submission state
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [step, setStep] = useState<SubmitStep>('select')
  const [truckType, setTruckType] = useState('')
  const [truckCount, setTruckCount] = useState('1')
  const [dirtType, setDirtType] = useState('clean_fill')
  const [locationText, setLocationText] = useState('')
  const [yardsEstimated, setYardsEstimated] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      setUser(data.user)
      loadJobs()
      loadMyLoads()
    })
  }, [router])

  function loadJobs() {
    fetch('/api/driver/jobs')
      .then(r => r.json())
      .then(p => {
        const jobList = p.jobs || []
        setJobs(jobList)
        setLoading(false)
        // Auto-open claim form if driver just signed up with a pending job
        try {
          const pendingId = sessionStorage.getItem('pendingJobId')
          if (pendingId) {
            sessionStorage.removeItem('pendingJobId')
            const match = jobList.find((j: Job) => j.id === pendingId)
            if (match) openClaimForm(match)
          }
        } catch {}
      })
      .catch(() => setLoading(false))
  }

  function loadMyLoads() {
    fetch('/api/driver/my-loads')
      .then(r => r.json())
      .then(p => setMyLoads(p.loads || []))
      .catch(() => {})
  }

  function openClaimForm(job: Job) {
    setSelectedJob(job)
    setStep('form')
    setTruckType('')
    setTruckCount('1')
    setDirtType('clean_fill')
    setLocationText('')
    setYardsEstimated(String(job.yards_needed || ''))
    setPhotoFile(null)
    setPhotoPreview('')
    setSubmitError('')
    setSubmitSuccess('')
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setSubmitError('Send a photo, not a video or document'); return }
    if (file.size > 10 * 1024 * 1024) { setSubmitError('Photo too large — max 10MB'); return }
    setPhotoFile(file)
    setSubmitError('')
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    if (!selectedJob || !user) return
    if (!truckType) { setSubmitError('Select your truck type'); return }
    if (!locationText.trim()) { setSubmitError('Enter where you are loading from'); return }
    if (!photoFile) { setSubmitError('Take a pic of the dirt'); return }
    if (!yardsEstimated || parseInt(yardsEstimated) < 1) { setSubmitError('Enter yards available'); return }

    setStep('uploading')
    setSubmitError('')

    try {
      // Upload photo to Supabase storage
      const supabase = createBrowserSupabase()
      const phone = user.phone || user.email || user.id
      const ext = photoFile.name.split('.').pop() || 'jpg'
      const path = `${phone}/${selectedJob.id}/${Date.now()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('material-photos')
        .upload(path, photoFile, { contentType: photoFile.type, upsert: true })
      if (uploadErr) throw new Error('Photo upload failed — try again')

      const { data: urlData } = supabase.storage.from('material-photos').getPublicUrl(path)
      const photoUrl = urlData.publicUrl

      // Submit to API
      const res = await fetch('/api/driver/submit-load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispatchOrderId: selectedJob.id,
          truckType,
          truckCount: parseInt(truckCount) || 1,
          dirtType,
          locationText: locationText.trim(),
          yardsEstimated: parseInt(yardsEstimated),
          photoUrl,
          haulDate: new Date().toISOString().split('T')[0],
          idempotencyKey: crypto.randomUUID(),
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        if (data.code === 'TRIAL_LIMIT_REACHED') {
          setSubmitError('You used all your free trial loads. Upgrade to keep hauling.')
          setStep('error')
          return
        }
        throw new Error(data.error || data.message || 'Submission failed')
      }

      setStep('done')
      setSubmitSuccess(data.message || 'Submitted — we will text you once approved')
      loadMyLoads()
      loadJobs()
    } catch (err: any) {
      setSubmitError(err.message || 'Something went wrong — try again')
      setStep('form')
    }
  }

  const truckOptions = [
    { value: 'tandem_axle', label: 'Tandem Axle' },
    { value: 'tri_axle', label: 'Tri-Axle' },
    { value: 'quad_axle', label: 'Quad Axle' },
    { value: 'end_dump', label: 'End Dump' },
    { value: 'belly_dump', label: 'Belly Dump' },
    { value: 'side_dump', label: 'Side Dump' },
    { value: 'super_dump', label: 'Super Dump' },
    { value: 'transfer', label: 'Transfer' },
    { value: '18_wheeler', label: '18-Wheeler' },
  ]

  const dirtOptions = [
    { value: 'clean_fill', label: 'Clean Fill' },
    { value: 'sandy_loam', label: 'Sandy Loam' },
    { value: 'topsoil', label: 'Topsoil' },
    { value: 'caliche', label: 'Caliche' },
    { value: 'clay', label: 'Clay' },
    { value: 'mixed', label: 'Mixed' },
  ]

  if (loading) return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#606670', fontFamily: 'system-ui' }}>
      Loading jobs...
    </div>
  )

  return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', color: '#E8E3DC', fontFamily: 'system-ui,sans-serif' }}>
      {/* HEADER */}
      <div style={{ background: '#080A0C', borderBottom: '1px solid #272B33', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '28px', height: '28px', background: '#F5A623', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>{'\uD83D\uDE9B'}</div>
          <span style={{ fontWeight: '800', fontSize: '16px', color: '#F5A623' }}>DumpSite.io</span>
        </div>
        <a href="/account" style={{ background: 'transparent', border: '1px solid #272B33', color: '#606670', padding: '7px 14px', borderRadius: '8px', textDecoration: 'none', fontSize: '13px' }}>Account</a>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1C1F24', padding: '0 20px' }}>
        <button onClick={() => setTab('jobs')} style={{
          background: 'none', border: 'none', borderBottom: tab === 'jobs' ? '2px solid #F5A623' : '2px solid transparent',
          color: tab === 'jobs' ? '#F5A623' : '#606670', padding: '14px 20px', fontSize: '14px', fontWeight: '700', cursor: 'pointer',
        }}>Available Jobs</button>
        <button onClick={() => setTab('my-loads')} style={{
          background: 'none', border: 'none', borderBottom: tab === 'my-loads' ? '2px solid #F5A623' : '2px solid transparent',
          color: tab === 'my-loads' ? '#F5A623' : '#606670', padding: '14px 20px', fontSize: '14px', fontWeight: '700', cursor: 'pointer',
        }}>My Loads {myLoads.length > 0 && <span style={{ background: '#F5A623', color: '#000', borderRadius: '10px', padding: '1px 7px', fontSize: '11px', fontWeight: '800', marginLeft: '6px' }}>{myLoads.length}</span>}</button>
      </div>

      {/* AVAILABLE JOBS TAB */}
      {tab === 'jobs' && (
        <div style={{ padding: '16px 20px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: '700', fontSize: '14px', color: '#606670', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{jobs.length} Available Dump Sites</div>
            <button onClick={() => { setLoading(true); loadJobs() }} style={{ background: 'transparent', border: '1px solid #272B33', color: '#606670', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Refresh</button>
          </div>

          {jobs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#606670', fontSize: '14px' }}>
              No jobs available right now. Check back soon.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {jobs.map(job => {
              const pay = Math.round((job.driver_pay_cents || 2000) / 100)
              const truck = job.truck_type_needed?.replace(/_/g, ' ') || 'Dump Truck'
              const city = (job.cities as any)?.name || 'DFW'
              const isUrgent = job.urgency === 'urgent'
              return (
                <div key={job.id} style={{ background: '#0D0F12', border: '1px solid #1C1F24', borderRadius: '10px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '15px', marginBottom: '4px' }}>{'\uD83D\uDCCD'} {city}</div>
                    <div style={{ fontSize: '12px', color: '#606670', marginBottom: '3px' }}>{job.yards_needed} yards needed</div>
                    <div style={{ fontSize: '11px', color: '#27AE60' }}>{'\uD83D\uDE9B'} {truck}</div>
                    {isUrgent && <span style={{ display: 'inline-block', marginTop: '4px', background: 'rgba(231,76,60,0.15)', color: '#E74C3C', fontSize: '9px', fontWeight: '800', padding: '2px 6px', borderRadius: '3px', textTransform: 'uppercase' }}>URGENT</span>}
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                    <div>
                      <span style={{ fontWeight: '900', fontSize: '24px', color: '#F5A623' }}>${pay}</span>
                      <span style={{ fontSize: '10px', color: '#606670' }}>/load</span>
                    </div>
                    <button
                      onClick={() => openClaimForm(job)}
                      style={{
                        background: isUrgent ? '#E74C3C' : '#F5A623', color: '#000', border: 'none',
                        borderRadius: '6px', padding: '8px 18px', fontSize: '12px', fontWeight: '800',
                        cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}
                    >
                      Claim Job
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* MY LOADS TAB */}
      {tab === 'my-loads' && (
        <div style={{ padding: '16px 20px 20px' }}>
          <div style={{ fontWeight: '700', fontSize: '14px', color: '#606670', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '12px' }}>Your Submissions</div>
          {myLoads.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#606670', fontSize: '14px' }}>
              No submissions yet. Claim a job to get started.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {myLoads.map((load: any) => {
              const statusColors: Record<string, string> = { pending: '#F5A623', approved: '#27AE60', rejected: '#E74C3C', completed: '#3498DB', in_progress: '#27AE60' }
              return (
                <div key={load.id} style={{ background: '#0D0F12', border: '1px solid #1C1F24', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ fontWeight: '700', fontSize: '14px' }}>{load.dispatch_orders?.cities?.name || 'Job'}</div>
                    <span style={{
                      background: `${statusColors[load.status] || '#606670'}20`,
                      color: statusColors[load.status] || '#606670',
                      border: `1px solid ${statusColors[load.status] || '#606670'}50`,
                      padding: '3px 10px', borderRadius: '4px', fontSize: '10px', fontWeight: '800', textTransform: 'uppercase',
                    }}>{load.status}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#606670' }}>
                    {load.yards_estimated} yds &middot; {load.truck_type?.replace(/_/g, ' ') || 'N/A'} &middot; {load.truck_count || 1} truck{(load.truck_count || 1) > 1 ? 's' : ''}
                  </div>
                  {load.payout_cents && (
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#27AE60', marginTop: '6px' }}>${Math.round(load.payout_cents / 100)} earned</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* CLAIM MODAL */}
      {selectedJob && step !== 'select' && (
        <div
          onClick={() => { setSelectedJob(null); setStep('select') }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '16px', padding: '24px', maxWidth: '440px', width: 'calc(100% - 40px)', position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <button onClick={() => { setSelectedJob(null); setStep('select') }} style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: '#606670', fontSize: '20px', cursor: 'pointer' }}>X</button>

            {/* SUCCESS STATE */}
            {step === 'done' && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#x2705;</div>
                <h3 style={{ color: '#27AE60', fontSize: '20px', fontWeight: '800', marginBottom: '8px' }}>Submitted</h3>
                <p style={{ color: '#606670', fontSize: '14px', marginBottom: '20px' }}>{submitSuccess}</p>
                <button onClick={() => { setSelectedJob(null); setStep('select'); setTab('my-loads') }} style={{ background: '#F5A623', color: '#000', border: 'none', borderRadius: '8px', padding: '12px 32px', fontSize: '14px', fontWeight: '800', cursor: 'pointer' }}>View My Loads</button>
              </div>
            )}

            {/* ERROR STATE */}
            {step === 'error' && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#x274C;</div>
                <h3 style={{ color: '#E74C3C', fontSize: '20px', fontWeight: '800', marginBottom: '8px' }}>Can&apos;t Submit</h3>
                <p style={{ color: '#606670', fontSize: '14px', marginBottom: '20px' }}>{submitError}</p>
                <a href="/upgrade" style={{ display: 'inline-block', background: '#F5A623', color: '#000', borderRadius: '8px', padding: '12px 32px', fontSize: '14px', fontWeight: '800', textDecoration: 'none' }}>Upgrade Plan</a>
              </div>
            )}

            {/* UPLOADING STATE */}
            {step === 'uploading' && (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <div style={{ fontSize: '36px', marginBottom: '16px', animation: 'spin 1s linear infinite' }}>&#x23F3;</div>
                <p style={{ color: '#606670', fontSize: '14px' }}>Submitting your load...</p>
                <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
              </div>
            )}

            {/* FORM STATE */}
            {step === 'form' && (
              <>
                {/* Job summary */}
                <div style={{ background: '#0A0C0F', border: '1px solid #1C1F24', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '15px' }}>{(selectedJob.cities as any)?.name || 'DFW'}</div>
                      <div style={{ fontSize: '11px', color: '#606670' }}>{selectedJob.yards_needed} yds &middot; {selectedJob.truck_type_needed?.replace(/_/g, ' ')}</div>
                    </div>
                    <div style={{ fontWeight: '900', fontSize: '24px', color: '#F5A623' }}>${Math.round((selectedJob.driver_pay_cents || 2000) / 100)}<span style={{ fontSize: '11px', color: '#606670' }}>/load</span></div>
                  </div>
                </div>

                <h3 style={{ color: '#E8E3DC', fontSize: '18px', fontWeight: '800', marginBottom: '16px' }}>Submit Your Load</h3>

                {submitError && (
                  <div style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#E74C3C', fontSize: '13px' }}>{submitError}</div>
                )}

                {/* Truck Type */}
                <label style={{ display: 'block', marginBottom: '14px' }}>
                  <span style={{ fontSize: '12px', color: '#606670', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Truck Type</span>
                  <select value={truckType} onChange={e => setTruckType(e.target.value)} style={{ width: '100%', background: '#0A0C0F', border: '1px solid #272B33', borderRadius: '8px', padding: '12px', color: '#E8E3DC', fontSize: '14px', appearance: 'none' as const }}>
                    <option value="">Select truck type</option>
                    {truckOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>

                {/* Truck Count */}
                <label style={{ display: 'block', marginBottom: '14px' }}>
                  <span style={{ fontSize: '12px', color: '#606670', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>How Many Trucks</span>
                  <input type="number" min="1" max="50" value={truckCount} onChange={e => setTruckCount(e.target.value)} style={{ width: '100%', background: '#0A0C0F', border: '1px solid #272B33', borderRadius: '8px', padding: '12px', color: '#E8E3DC', fontSize: '14px', boxSizing: 'border-box' }} />
                </label>

                {/* Dirt Type */}
                <label style={{ display: 'block', marginBottom: '14px' }}>
                  <span style={{ fontSize: '12px', color: '#606670', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Dirt Type</span>
                  <select value={dirtType} onChange={e => setDirtType(e.target.value)} style={{ width: '100%', background: '#0A0C0F', border: '1px solid #272B33', borderRadius: '8px', padding: '12px', color: '#E8E3DC', fontSize: '14px', appearance: 'none' as const }}>
                    {dirtOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>

                {/* Yards */}
                <label style={{ display: 'block', marginBottom: '14px' }}>
                  <span style={{ fontSize: '12px', color: '#606670', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Yards Available</span>
                  <input type="number" min="1" value={yardsEstimated} onChange={e => setYardsEstimated(e.target.value)} style={{ width: '100%', background: '#0A0C0F', border: '1px solid #272B33', borderRadius: '8px', padding: '12px', color: '#E8E3DC', fontSize: '14px', boxSizing: 'border-box' }} />
                </label>

                {/* Loading Address */}
                <label style={{ display: 'block', marginBottom: '14px' }}>
                  <span style={{ fontSize: '12px', color: '#606670', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Loading Address</span>
                  <input type="text" placeholder="Where are you loading from?" value={locationText} onChange={e => setLocationText(e.target.value)} style={{ width: '100%', background: '#0A0C0F', border: '1px solid #272B33', borderRadius: '8px', padding: '12px', color: '#E8E3DC', fontSize: '14px', boxSizing: 'border-box' }} />
                </label>

                {/* Photo Upload */}
                <label style={{ display: 'block', marginBottom: '20px' }}>
                  <span style={{ fontSize: '12px', color: '#606670', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Photo of Dirt</span>
                  <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoSelect} style={{ display: 'none' }} />
                  {photoPreview ? (
                    <div style={{ position: 'relative' }}>
                      <img src={photoPreview} alt="Dirt preview" style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #272B33' }} />
                      <button onClick={() => { setPhotoFile(null); setPhotoPreview(''); if (fileInputRef.current) fileInputRef.current.value = '' }} style={{ position: 'absolute', top: '8px', right: '8px', background: '#E74C3C', color: '#fff', border: 'none', borderRadius: '50%', width: '28px', height: '28px', cursor: 'pointer', fontSize: '14px', fontWeight: '800' }}>X</button>
                    </div>
                  ) : (
                    <button onClick={() => fileInputRef.current?.click()} style={{ width: '100%', background: '#0A0C0F', border: '2px dashed #272B33', borderRadius: '8px', padding: '24px', color: '#606670', fontSize: '14px', cursor: 'pointer', textAlign: 'center' }}>
                      {'\uD83D\uDCF7'} Tap to take photo of dirt
                    </button>
                  )}
                </label>

                {/* Submit */}
                <button onClick={handleSubmit} style={{ width: '100%', background: '#F5A623', color: '#000', border: 'none', borderRadius: '8px', padding: '14px', fontSize: '15px', fontWeight: '800', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Submit Load
                </button>

                <p style={{ color: '#606670', fontSize: '11px', textAlign: 'center', marginTop: '12px' }}>
                  You&apos;ll get an SMS once approved with the dump site address
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
