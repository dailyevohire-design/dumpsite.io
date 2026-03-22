'use client'
import dynamic from 'next/dynamic'
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false })
import { useState, useEffect, useRef, useCallback } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

// ── Isolated completion form — one per load card, no shared state ──────────
function CompletionForm({ load, user, onComplete }: {
  load: any, user: any,
  onComplete: (msg: string) => void
}) {
  const [photo, setPhoto] = useState<File|null>(null)
  const [preview, setPreview] = useState<string|null>(null)
  const [loadsDelivered, setLoadsDelivered] = useState('1')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string|null>(null)
  const [gpsStatus, setGpsStatus] = useState<string|null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const payPerLoad = load.dispatch_orders?.driver_pay_cents || 2000

  function handlePhoto(e: any) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please select an image file'); return }
    if (file.size > 10 * 1024 * 1024) { setError('Photo must be under 10MB'); return }
    setPhoto(file)
    const reader = new FileReader()
    reader.onload = (ev) => setPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function uploadPhoto(): Promise<string|null> {
    if (!photo) return null
    const supabase = createBrowserSupabase()
    const ext = photo.name.split('.').pop() || 'jpg'
    const path = `${user.id}/completions/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('dirt-photos').upload(path, photo, { upsert: false })
    if (error) return null
    const { data } = supabase.storage.from('dirt-photos').getPublicUrl(path)
    return data.publicUrl
  }

  function getGPS(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000 }
      )
    })
  }

  async function submit() {
    if (!photo) { setError('Please upload a completion photo'); return }
    const numLoads = parseInt(loadsDelivered)
    if (isNaN(numLoads) || numLoads < 1) { setError('Please enter a valid number of loads'); return }

    setSubmitting(true)
    setError(null)
    setGpsStatus('Getting your location...')

    try {
      // Get GPS for photo verification
      const gps = await getGPS()
      setGpsStatus(gps ? 'Location captured' : 'Location unavailable — submitting anyway')

      const photoUrl = await uploadPhoto()
      if (!photoUrl) { setError('Photo upload failed — please try again'); setSubmitting(false); return }

      const res = await fetch('/api/driver/complete-load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loadId: load.id,
          completionPhotoUrl: photoUrl,
          loadsDelivered: numLoads,
          photoLat: gps?.lat,
          photoLng: gps?.lng,
        })
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error || 'Failed to mark complete. Please try again.')
      } else {
        const flag = data.flaggedForReview ? ' (GPS verification pending — admin will confirm)' : ''
        onComplete(`🎉 Job complete! ${numLoads} load${numLoads > 1 ? 's' : ''} delivered — total pay: $${data.totalPayDollars}.${flag}`)
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
      setGpsStatus(null)
    }
  }

  const inp = { background:'#111316',border:'1px solid #272B33',color:'#E8E3DC',padding:'12px 14px',borderRadius:'9px',fontSize:'16px',width:'100%',outline:'none' }

  return (
    <div style={{background:'#1C1F24',border:'1px solid #272B33',borderRadius:'10px',padding:'16px',marginTop:'12px'}}>
      <div style={{fontWeight:'700',fontSize:'15px',marginBottom:'14px'}}>📸 Complete this job</div>
      {error && <div style={{background:'rgba(231,76,60,0.12)',border:'1px solid rgba(231,76,60,0.3)',borderRadius:'8px',padding:'10px 14px',marginBottom:'12px',color:'#E74C3C',fontSize:'13px'}}>{error}</div>}

      <div style={{marginBottom:'14px'}}>
        <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700',display:'block',marginBottom:'6px'}}>How many loads did you deliver? *</label>
        <input type="number" min="1" max="200" value={loadsDelivered}
          onChange={e => setLoadsDelivered(e.target.value)} style={inp} placeholder="Enter number of loads" />
        {loadsDelivered && parseInt(loadsDelivered) > 0 && (
          <div style={{marginTop:'8px',background:'rgba(245,166,35,0.08)',border:'1px solid rgba(245,166,35,0.2)',borderRadius:'7px',padding:'10px 14px',fontSize:'14px',color:'#F5A623',fontWeight:'700'}}>
            💰 Your total pay: ${Math.round((payPerLoad * parseInt(loadsDelivered)) / 100)}
          </div>
        )}
      </div>

      <div style={{marginBottom:'14px'}}>
        <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700',display:'block',marginBottom:'6px'}}>Photo of completed delivery *</label>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{display:'none'}} />
        <div onClick={() => fileRef.current?.click()} style={{border:`2px dashed ${photo ? '#27AE60' : '#272B33'}`,borderRadius:'10px',padding:'20px',textAlign:'center',cursor:'pointer',background:photo ? 'rgba(39,174,96,0.05)' : '#0A0C0F'}}>
          {preview
            ? <div><img src={preview} alt="Completion" style={{maxHeight:'160px',maxWidth:'100%',borderRadius:'8px',marginBottom:'8px'}} /><div style={{fontSize:'12px',color:'#27AE60',fontWeight:'700'}}>✓ Photo ready — tap to replace</div></div>
            : <div><div style={{fontSize:'32px',marginBottom:'8px'}}>📷</div><div style={{fontSize:'14px',fontWeight:'700',marginBottom:'4px'}}>Take photo at delivery site</div><div style={{fontSize:'12px',color:'#606670'}}>GPS location will be verified automatically</div></div>
          }
        </div>
      </div>

      {gpsStatus && <div style={{fontSize:'12px',color:'#F5A623',marginBottom:'10px',textAlign:'center'}}>{gpsStatus}</div>}

      <button onClick={submit} disabled={submitting || !photo} style={{width:'100%',background:photo ? 'rgba(39,174,96,0.15)' : '#1C1F24',color:photo ? '#27AE60' : '#606670',border:`1px solid ${photo ? 'rgba(39,174,96,0.3)' : '#272B33'}`,padding:'12px',borderRadius:'8px',cursor:(submitting || !photo) ? 'not-allowed' : 'pointer',fontWeight:'800',fontSize:'14px'}}>
        {submitting ? 'Verifying location & submitting...' : '✓ Mark Job Complete'}
      </button>
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function DriverDashboard() {
  const [user, setUser] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const [loads, setLoads] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [activeTab, setActiveTab] = useState('jobs')
  const [selectedJob, setSelectedJob] = useState<any>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<any>(null)
  const [photoFile, setPhotoFile] = useState<File|null>(null)
  const [photoPreview, setPhotoPreview] = useState<string|null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [completingId, setCompletingId] = useState<string|null>(null)
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [loadingLoads, setLoadingLoads] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const submitResultTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const [form, setForm] = useState({ dirtType:'clean_fill', locationText:'', truckType:'tandem_axle', truckCount:'1', yardsEstimated:'', haulDate:'' })
  const router = useRouter()

  function showResult(result: {success:boolean,message:string}, duration = 6000) {
    if (submitResultTimer.current) clearTimeout(submitResultTimer.current)
    setSubmitResult(result)
    submitResultTimer.current = setTimeout(() => setSubmitResult(null), duration)
  }

  const fetchJobs = useCallback(async (_supabase?: any) => {
    setLoadingJobs(true)
    try {
      const res = await fetch('/api/driver/jobs')
      const payload = await res.json()
      const data = payload.jobs || []
      const seen = new Set()
      const unique = data.filter((j: any) => { if (seen.has(j.id)) return false; seen.add(j.id); return true })
      setJobs([...unique.slice(0, 3), ...unique.slice(3).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())])
    } catch {
      setJobs([])
    }
    setLoadingJobs(false)
  }, [])

  const fetchLoads = useCallback(async (_supabase?: any, _userId?: string) => {
    setLoadingLoads(true)
    try {
      const res = await fetch('/api/driver/my-loads')
      const payload = await res.json()
      setLoads(payload.loads || [])
    } catch {
      setLoads([])
    }
    setLoadingLoads(false)
  }, [])

  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      setUser(data.user)
      supabase.from('driver_profiles').select('*, tiers(name,slug,pay_boost_pct,trial_load_limit)').eq('user_id', data.user.id).single().then(({ data: p }) => setProfile(p))
      fetchJobs(supabase)
      fetchLoads(supabase, data.user.id)
    })

    // ✅ Refresh jobs every 60 seconds so stale jobs don't show as available
    const interval = setInterval(() => {
      fetchJobs()
    }, 60000)

    return () => {
      clearInterval(interval)
      if (submitResultTimer.current) clearTimeout(submitResultTimer.current)
    }
  }, [])

  function handlePhoto(e: any) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { showResult({ success: false, message: 'Please select an image file' }); return }
    if (file.size > 10 * 1024 * 1024) { showResult({ success: false, message: 'Photo must be under 10MB' }); return }
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function uploadDirtPhoto(file: File): Promise<string | null> {
    const supabase = createBrowserSupabase()
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${user.id}/dirt/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('dirt-photos').upload(path, file, { upsert: false })
    if (error) { console.error('Upload error:', error); return null }
    const { data } = supabase.storage.from('dirt-photos').getPublicUrl(path)
    return data.publicUrl
  }

  async function submitLoad(e: any) {
    e.preventDefault()
    if (!selectedJob) return
    if (!photoFile) { showResult({ success: false, message: 'Photo of your dirt is required' }); return }
    if (!form.locationText.trim()) { showResult({ success: false, message: 'Please enter where the dirt is coming from' }); return }
    if (!form.yardsEstimated || isNaN(parseInt(form.yardsEstimated))) { showResult({ success: false, message: 'Please enter a valid number of yards' }); return }
    if (!form.haulDate) { showResult({ success: false, message: 'Please select a haul date' }); return }

    // ✅ try/finally ensures submitting always resets
    setSubmitting(true)
    setUploadingPhoto(true)
    try {
      const photoUrl = await uploadDirtPhoto(photoFile)
      setUploadingPhoto(false)
      if (!photoUrl) { showResult({ success: false, message: 'Photo upload failed — please try again' }); return }

      const res = await fetch('/api/driver/submit-load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          dirtType: form.dirtType,
          photoUrl,
          locationText: form.locationText.trim(),
          truckType: form.truckType,
          truckCount: form.truckCount,
          yardsEstimated: form.yardsEstimated,
          haulDate: form.haulDate,
          dispatchOrderId: selectedJob.id,
        })
      })
      const data = await res.json()
      if (!data.success) {
        showResult({ success: false, message: data.message || data.error || 'Failed to submit. Please try again.' })
      } else {
        showResult({ success: true, message: '✅ Submitted! You will get an SMS with the delivery address once approved.' })
        setSelectedJob(null)
        setPhotoFile(null)
        setPhotoPreview(null)
        setForm({ dirtType:'clean_fill', locationText:'', truckType:'tandem_axle', truckCount:'1', yardsEstimated:'', haulDate:'' })
        const supabase = createBrowserSupabase()
        await fetchLoads(supabase, user.id)
        setActiveTab('loads')
      }
    } catch {
      showResult({ success: false, message: 'Network error — please try again.' })
    } finally {
      // ✅ Always reset — no stuck form
      setSubmitting(false)
      setUploadingPhoto(false)
    }
  }

  async function signOut() {
    const supabase = createBrowserSupabase()
    await supabase.auth.signOut()
    router.push('/')
  }

  const tier = profile?.tiers
  const tierColor = ({ trial:'#27AE60', hauler:'#3A8AE8', pro:'#F5A623', elite:'#8E44AD' } as any)[tier?.slug || 'trial'] || '#27AE60'
  const inp = { background:'#1C1F24', border:'1px solid #272B33', color:'#E8E3DC', padding:'11px 14px', borderRadius:'9px', fontSize:'14px', width:'100%', outline:'none', marginTop:'5px' }

  if (!user) return <div style={{background:'#0A0C0F',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#606670',fontFamily:'system-ui'}}>Loading...</div>

  return (
    <div style={{background:'#0A0C0F',minHeight:'100vh',color:'#E8E3DC',fontFamily:'system-ui,sans-serif'}}>
      <div style={{background:'#080A0C',borderBottom:'1px solid #272B33',padding:'14px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontFamily:'Georgia,serif',fontSize:'18px',fontWeight:'700',letterSpacing:'0.02em',color:'#F0EDE8'}}>DUMPSITE<span style={{color:'#F5A623'}}>.IO</span></span>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          {tier && <span style={{background:`${tierColor}18`,color:tierColor,border:`1px solid ${tierColor}33`,padding:'4px 12px',borderRadius:'6px',fontSize:'11px',fontWeight:'800',textTransform:'uppercase'}}>{tier.name}</span>}
          <a href="/account" style={{background:'transparent',border:'1px solid #272B33',color:'#606670',padding:'7px 14px',borderRadius:'8px',textDecoration:'none',fontSize:'13px'}}>My Account</a>
          <button onClick={signOut} style={{background:'transparent',border:'1px solid #272B33',color:'#606670',padding:'7px 14px',borderRadius:'8px',cursor:'pointer',fontSize:'13px'}}>Sign Out</button>
        </div>
      </div>

      {profile && (
        <div style={{background:'#111316',borderBottom:'1px solid #272B33',padding:'10px 20px',display:'flex',gap:'20px',flexWrap:'wrap',alignItems:'center'}}>
          <div style={{fontWeight:'700',fontSize:'14px'}}>Hi, {profile.first_name}! 👋</div>
          <div style={{fontSize:'12px',color:'#606670'}}>GPS Score: <span style={{color:'#F5A623',fontWeight:'700'}}>{profile.gps_score}%</span></div>
          <div style={{fontSize:'12px',color:'#606670'}}>Completed: <span style={{color:'#F5A623',fontWeight:'700'}}>{loads.filter((l: any) => l.status === 'completed').length} loads</span></div>
          {tier?.slug === 'trial' && (
            <div style={{marginLeft:'auto',background:'rgba(245,166,35,0.08)',border:'1px solid rgba(245,166,35,0.2)',borderRadius:'6px',padding:'4px 12px',fontSize:'11px',color:'#F5A623'}}>
              Trial: {profile.trial_loads_used}/{tier.trial_load_limit} loads used
            </div>
          )}
        </div>
      )}

      {submitResult && (
        <div style={{margin:'14px 20px',padding:'13px 16px',borderRadius:'10px',background:submitResult.success ? 'rgba(39,174,96,0.12)' : 'rgba(231,76,60,0.12)',border:`1px solid ${submitResult.success ? 'rgba(39,174,96,0.3)' : 'rgba(231,76,60,0.3)'}`,color:submitResult.success ? '#27AE60' : '#E74C3C',fontWeight:'600',fontSize:'14px'}}>
          {submitResult.message}
        </div>
      )}

      <div style={{display:'flex',borderBottom:'1px solid #272B33',background:'#111316'}}>
        {[['jobs','🏗️ Available Jobs'],['loads','🚚 My Loads'],['map','🗺️ Map View']].map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{padding:'13px 24px',background:'transparent',border:'none',borderBottom:activeTab === tab ? '2px solid #F5A623' : '2px solid transparent',color:activeTab === tab ? '#F5A623' : '#606670',cursor:'pointer',fontWeight:'700',fontSize:'12px',textTransform:'uppercase',letterSpacing:'0.07em'}}>{label}</button>
        ))}
      </div>

      <div style={{padding:'16px 20px',maxWidth:'860px',margin:'0 auto'}}>
        {activeTab === 'jobs' && (
          <div>
            {selectedJob ? (
              <div>
                <button onClick={() => { setSelectedJob(null); setPhotoFile(null); setPhotoPreview(null) }} style={{background:'transparent',border:'1px solid #272B33',color:'#606670',padding:'9px 16px',borderRadius:'8px',cursor:'pointer',fontSize:'13px',marginBottom:'16px'}}>← Back to Jobs</button>
                <div style={{background:'#111316',border:'1px solid #272B33',borderRadius:'14px',padding:'20px',marginBottom:'16px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'12px'}}>
                    <div>
                      <h2 style={{fontWeight:'900',fontSize:'24px',marginBottom:'4px'}}>Delivery Job — {selectedJob.cities?.name}</h2>
                      <div style={{fontSize:'13px',color:'#606670'}}>{selectedJob.yards_needed} yards needed</div>
                    </div>
                    <div style={{textAlign:'right',flexShrink:0,marginLeft:'16px'}}>
                      <div style={{fontWeight:'900',fontSize:'48px',color:'#F5A623',lineHeight:'1'}}>${Math.round((selectedJob.driver_pay_cents || 2000) / 100)}</div>
                      <div style={{fontSize:'12px',color:'#606670'}}>per load you deliver</div>
                    </div>
                  </div>
                  <div style={{background:'rgba(245,166,35,0.07)',border:'1px solid rgba(245,166,35,0.18)',borderRadius:'9px',padding:'11px 14px',fontSize:'13px',color:'#606670'}}>
                    🔒 Delivery address sent via SMS after approval
                  </div>
                </div>

                <form onSubmit={submitLoad} style={{background:'#111316',border:'1px solid #272B33',borderRadius:'14px',padding:'22px'}}>
                  <h3 style={{fontWeight:'800',fontSize:'18px',marginBottom:'18px'}}>Submit Your Load Request</h3>
                  <div style={{marginBottom:'16px'}}>
                    <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700',display:'block',marginBottom:'6px'}}>Photo of Dirt — Required ⚠️</label>
                    <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{display:'none'}} />
                    <div onClick={() => fileRef.current?.click()} style={{border:`2px dashed ${photoFile ? '#27AE60' : '#272B33'}`,borderRadius:'12px',padding:'24px',textAlign:'center',cursor:'pointer',background:photoFile ? 'rgba(39,174,96,0.05)' : '#1C1F24'}}>
                      {photoPreview
                        ? <div><img src={photoPreview} alt="Dirt" style={{maxHeight:'180px',maxWidth:'100%',borderRadius:'10px',marginBottom:'10px'}} /><div style={{fontSize:'13px',color:'#27AE60',fontWeight:'700'}}>✓ Photo ready — tap to replace</div></div>
                        : <div><div style={{fontSize:'40px',marginBottom:'10px'}}>📷</div><div style={{fontSize:'15px',fontWeight:'700',marginBottom:'5px'}}>Tap to take photo or upload</div><div style={{fontSize:'12px',color:'#606670'}}>Clear photo of your dirt required</div></div>
                      }
                    </div>
                  </div>
                  <div style={{marginBottom:'14px'}}>
                    <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700'}}>Material Type</label>
                    <select style={inp} value={form.dirtType} onChange={e => setForm({ ...form, dirtType: e.target.value })}>
                      <option value="clean_fill">Clean Fill Dirt</option>
                      <option value="sandy_loam">Sandy Loam</option>
                      <option value="topsoil">Topsoil</option>
                      <option value="caliche">Caliche ⚠️ (requires extra review)</option>
                      <option value="clay_free">Clay-Free Soil</option>
                    </select>
                  </div>
                  <div style={{marginBottom:'14px'}}>
                    <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700'}}>Where is the dirt coming from? *</label>
                    <input style={inp} value={form.locationText} onChange={e => setForm({ ...form, locationText: e.target.value })} placeholder="123 Main St, Dallas TX" />
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'14px'}}>
                    <div>
                      <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700'}}>Truck Type</label>
                      <select style={inp} value={form.truckType} onChange={e => setForm({ ...form, truckType: e.target.value })}>
                        <option value="tandem_axle">Tandem Axle</option>
                        <option value="end_dump">End Dump</option>
                        <option value="tri_axle">Tri-Axle</option>
                        <option value="super_dump">Super Dump</option>
                        <option value="semi_transfer">Semi Transfer</option>
                        <option value="bottom_dump">Bottom Dump</option>
                      </select>
                    </div>
                    <div>
                      <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700'}}>Trucks Running</label>
                      <input style={inp} type="number" min="1" max="50" value={form.truckCount} onChange={e => setForm({ ...form, truckCount: e.target.value })} />
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'18px'}}>
                    <div>
                      <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700'}}>Total Yards Available *</label>
                      <input style={inp} type="number" min="1" value={form.yardsEstimated} onChange={e => setForm({ ...form, yardsEstimated: e.target.value })} placeholder="120" />
                    </div>
                    <div>
                      <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700'}}>Haul Date *</label>
                      <input style={inp} type="date" value={form.haulDate} onChange={e => setForm({ ...form, haulDate: e.target.value })} min={new Date().toISOString().split('T')[0]} />
                    </div>
                  </div>
                  <button type="submit" disabled={submitting || uploadingPhoto} style={{width:'100%',background:'#F5A623',color:'#111',border:'none',padding:'15px',borderRadius:'10px',fontWeight:'800',fontSize:'16px',cursor:(submitting || uploadingPhoto) ? 'not-allowed' : 'pointer',opacity:(submitting || uploadingPhoto) ? 0.7 : 1,textTransform:'uppercase'}}>
                    {uploadingPhoto ? 'Uploading photo...' : submitting ? 'Submitting...' : 'Submit Request — Get SMS When Approved'}
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <p style={{color:'#606670',fontSize:'14px',marginBottom:'16px'}}>Available delivery jobs in your area. You bring the dirt, we handle the rest.</p>
                {loadingJobs ? (
                  <div style={{textAlign:'center',padding:'40px',color:'#606670'}}>Loading jobs...</div>
                ) : jobs.length === 0 ? (
                  <div style={{textAlign:'center',padding:'60px 20px',color:'#606670'}}><div style={{fontSize:'48px',marginBottom:'14px'}}>📍</div><div style={{fontWeight:'800',fontSize:'18px',marginBottom:'6px'}}>No jobs available right now</div><div style={{fontSize:'13px'}}>Check back soon — jobs refresh automatically</div></div>
                ) : jobs.map((job: any) => (
                  <div key={job.id} onClick={() => setSelectedJob(job)} style={{background:'#111316',border:'1px solid #272B33',borderRadius:'13px',padding:'18px',marginBottom:'12px',cursor:'pointer',borderLeft:'3px solid #27AE60'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:'800',fontSize:'18px',marginBottom:'4px'}}>Delivery Job — {job.cities?.name}</div>
                        <div style={{fontSize:'13px',color:'#606670',marginBottom:'8px'}}>{job.yards_needed} yards needed</div>
                        <div style={{display:'flex',gap:'8px'}}>
                          <span style={{background:'rgba(39,174,96,0.12)',color:'#27AE60',border:'1px solid rgba(39,174,96,0.3)',padding:'3px 10px',borderRadius:'5px',fontSize:'11px',fontWeight:'800'}}>✓ Open</span>
                          <span style={{background:'#1C1F24',color:'#606670',border:'1px solid #272B33',padding:'3px 10px',borderRadius:'5px',fontSize:'11px'}}>{job.urgency === 'urgent' ? '🔥 Urgent' : 'Standard'}</span>
                        </div>
                      </div>
                      <div style={{textAlign:'right',flexShrink:0,marginLeft:'16px'}}>
                        <div style={{fontWeight:'900',fontSize:'36px',color:'#F5A623',lineHeight:'1'}}>${Math.round((job.driver_pay_cents || 2000) / 100)}</div>
                        <div style={{fontSize:'11px',color:'#606670'}}>per load</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'map' && (
          <div style={{paddingTop:'20px'}}>
            <MapView jobs={jobs} onSubmitInterest={(jobId: string) => {
              const job = jobs.find((j: any) => j.id === jobId)
              if (job) { setSelectedJob(job); setActiveTab('jobs') }
            }} />
          </div>
        )}

        {activeTab === 'loads' && (
          <div>
            {loadingLoads ? (
              <div style={{textAlign:'center',padding:'40px',color:'#606670'}}>Loading your loads...</div>
            ) : loads.length === 0 ? (
              <div style={{textAlign:'center',padding:'60px 20px',color:'#606670'}}>
                <div style={{fontSize:'48px',marginBottom:'14px'}}>📋</div>
                <div style={{fontWeight:'800',fontSize:'18px',marginBottom:'6px'}}>No load requests yet</div>
                <button onClick={() => setActiveTab('jobs')} style={{marginTop:'14px',background:'#F5A623',color:'#111',border:'none',padding:'12px 28px',borderRadius:'9px',cursor:'pointer',fontWeight:'800',fontSize:'14px'}}>View Available Jobs</button>
              </div>
            ) : loads.map((load: any) => {
              const payPerLoad = load.dispatch_orders?.driver_pay_cents || 2000
              const loadsCount = load.truck_count || 1
              const totalEarned = Math.round((payPerLoad * loadsCount) / 100)
              return (
                <div key={load.id} style={{background:'#111316',border:'1px solid #272B33',borderRadius:'13px',padding:'16px',marginBottom:'12px',borderLeft:`3px solid ${load.status === 'approved' ? '#27AE60' : load.status === 'rejected' ? '#E74C3C' : load.status === 'completed' ? '#3A8AE8' : '#F5A623'}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'10px'}}>
                    <div>
                      <div style={{fontWeight:'800',fontSize:'16px'}}>Delivery Job — {load.dispatch_orders?.cities?.name || 'DFW'}</div>
                      <div style={{fontSize:'11px',color:'#606670',marginTop:'2px'}}>{new Date(load.submitted_at).toLocaleDateString()} · Haul date: {load.haul_date}</div>
                    </div>
                    <span style={{background:load.status === 'approved' ? 'rgba(39,174,96,0.15)' : load.status === 'rejected' ? 'rgba(231,76,60,0.15)' : load.status === 'completed' ? 'rgba(59,138,232,0.15)' : 'rgba(245,166,35,0.12)',color:load.status === 'approved' ? '#27AE60' : load.status === 'rejected' ? '#E74C3C' : load.status === 'completed' ? '#3A8AE8' : '#F5A623',padding:'4px 10px',borderRadius:'5px',fontSize:'11px',fontWeight:'800',textTransform:'uppercase' as const}}>{load.status}</span>
                  </div>

                  <div style={{display:'flex',gap:'16px',fontSize:'12px',color:'#606670',flexWrap:'wrap',marginBottom:'10px'}}>
                    <span>{load.dirt_type?.replace(/_/g, ' ')}</span>
                    <span>{load.truck_count} load{load.truck_count > 1 ? 's' : ''} delivered</span>
                    <span>{load.yards_estimated} yds</span>
                    {payPerLoad && <span style={{color:'#F5A623',fontWeight:'700'}}>${Math.round(payPerLoad / 100)}/load</span>}
                    {load.status === 'completed' && <span style={{color:'#27AE60',fontWeight:'800'}}>Total: ${totalEarned}</span>}
                  </div>

                  {load.status === 'approved' && (
                    <div>
                      <div style={{background:'rgba(39,174,96,0.08)',border:'1px solid rgba(39,174,96,0.25)',borderRadius:'9px',padding:'12px',fontSize:'13px',color:'#27AE60',fontWeight:'700',marginBottom:'12px'}}>
                        ✅ Approved! Delivery address sent to your phone via SMS.
                      </div>
                      {completingId === load.id ? (
                        <div>
                          {/* ✅ Isolated CompletionForm per load — no shared state */}
                          <CompletionForm
                            load={load}
                            user={user}
                            onComplete={(msg) => {
                              showResult({ success: true, message: msg }, 8000)
                              setCompletingId(null)
                              const s = createBrowserSupabase()
                              fetchLoads(s, user.id)
                            }}
                          />
                          <button onClick={() => setCompletingId(null)} style={{width:'100%',marginTop:'8px',background:'transparent',color:'#606670',border:'1px solid #272B33',padding:'10px',borderRadius:'8px',cursor:'pointer',fontSize:'13px'}}>Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setCompletingId(load.id)} style={{width:'100%',background:'rgba(59,138,232,0.12)',color:'#3A8AE8',border:'1px solid rgba(59,138,232,0.3)',padding:'12px',borderRadius:'9px',cursor:'pointer',fontWeight:'800',fontSize:'14px'}}>
                          📸 Mark Complete + Upload Delivery Photo
                        </button>
                      )}
                    </div>
                  )}

                  {load.status === 'completed' && (
                    <div style={{background:'rgba(59,138,232,0.08)',border:'1px solid rgba(59,138,232,0.2)',borderRadius:'9px',padding:'12px',fontSize:'13px',color:'#3A8AE8',fontWeight:'700'}}>
                      🎉 Job completed! {load.truck_count} load{load.truck_count > 1 ? 's' : ''} delivered · Total earned: ${totalEarned} · Payment processed shortly.
                    </div>
                  )}

                  {load.status === 'rejected' && load.rejected_reason && (
                    <div style={{background:'rgba(231,76,60,0.07)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:'9px',padding:'12px',fontSize:'13px',color:'#606670'}}>
                      Rejected: <span style={{color:'#E74C3C'}}>{load.rejected_reason}</span>
                    </div>
                  )}

                  {load.status === 'pending' && (
                    <div style={{background:'rgba(245,166,35,0.06)',border:'1px solid rgba(245,166,35,0.18)',borderRadius:'9px',padding:'11px',fontSize:'13px',color:'#606670'}}>
                      ⏳ Under review — SMS with delivery address coming once approved
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
