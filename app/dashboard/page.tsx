'use client'
import dynamic from 'next/dynamic'
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false })
import { useState, useEffect, useRef } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

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
  const [completionPhoto, setCompletionPhoto] = useState<File|null>(null)
  const [completionPreview, setCompletionPreview] = useState<string|null>(null)
  const [loadsDelivered, setLoadsDelivered] = useState('1')
  const [completing, setCompleting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const completionFileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({dirtType:'clean_fill',locationText:'',truckType:'tandem_axle',truckCount:'1',yardsEstimated:'',haulDate:''})
  const router = useRouter()

  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabase.auth.getUser().then(({data}) => {
      if (!data.user) { router.push('/login'); return }
      setUser(data.user)
      supabase.from('driver_profiles').select('*, tiers(name,slug,pay_boost_pct,trial_load_limit)').eq('user_id', data.user.id).single().then(({data:p}) => setProfile(p))
      supabase.from('dispatch_orders').select('id,city_id,yards_needed,driver_pay_cents,urgency,created_at,cities(name)').eq('status','dispatching').order('driver_pay_cents',{ascending:false}).then(({data:s}) => { const seen = new Set(); const unique = (s||[]).filter((j:any) => { if(seen.has(j.id)) return false; seen.add(j.id); return true; }); const top3 = unique.slice(0,3); const rest = unique.slice(3).sort((a:any,b:any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); setJobs([...top3,...rest]) })
      supabase.from('load_requests').select('id,status,dirt_type,photo_url,truck_type,truck_count,yards_estimated,haul_date,submitted_at,rejected_reason,payout_cents,completion_photo_url,dispatch_orders(yards_needed,driver_pay_cents,cities(name))').eq('driver_id',data.user.id).order('submitted_at',{ascending:false}).limit(20).then(({data:l}) => setLoads(l||[]))
    })
  }, [])

  function handlePhoto(e: any) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { alert('Photo must be under 10MB'); return }
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function handleCompletionPhoto(e: any) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { alert('Photo must be under 10MB'); return }
    setCompletionPhoto(file)
    const reader = new FileReader()
    reader.onload = (ev) => setCompletionPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function uploadPhoto(userId: string, file: File, folder: string): Promise<string|null> {
    const supabase = createBrowserSupabase()
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${userId}/${folder}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('dirt-photos').upload(path, file, { upsert: false })
    if (error) { console.error('Upload error:', error); return null }
    const { data: urlData } = supabase.storage.from('dirt-photos').getPublicUrl(path)
    return urlData.publicUrl
  }

  async function submitLoad(e: any) {
    e.preventDefault()
    if (!selectedJob) return
    if (!photoFile) { setSubmitResult({success:false,message:'Photo of your dirt is required'}); return }
    if (!form.locationText) { setSubmitResult({success:false,message:'Please enter where the dirt is coming from'}); return }
    if (!form.yardsEstimated) { setSubmitResult({success:false,message:'Please enter how many yards you have'}); return }
    if (!form.haulDate) { setSubmitResult({success:false,message:'Please select a haul date'}); return }
    setSubmitting(true)
    setUploadingPhoto(true)
    const photoUrl = await uploadPhoto(user.id, photoFile, 'dirt')
    setUploadingPhoto(false)
    if (!photoUrl) { setSubmitResult({success:false,message:'Photo upload failed — please try again'}); setSubmitting(false); return }
    const res = await fetch('/api/driver/submit-load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        dirtType: form.dirtType,
        photoUrl,
        locationText: form.locationText,
        truckType: form.truckType,
        truckCount: form.truckCount,
        yardsEstimated: form.yardsEstimated,
        haulDate: form.haulDate,
        dispatchOrderId: selectedJob.id,
      })
    })
    const result = await res.json()
    if (!result.success) {
      setSubmitResult({success:false,message:result.message || result.error || 'Failed to submit. Please try again.'})
    } else {
      setSubmitResult({success:true,message:'✅ Submitted! You will get an SMS with the delivery address once approved.'})
      setSelectedJob(null)
      setPhotoFile(null)
      setPhotoPreview(null)
      setForm({dirtType:'clean_fill',locationText:'',truckType:'tandem_axle',truckCount:'1',yardsEstimated:'',haulDate:''})
      const supabase = createBrowserSupabase()
      const {data:l} = await supabase.from('load_requests').select('id,status,dirt_type,photo_url,truck_type,truck_count,yards_estimated,haul_date,submitted_at,rejected_reason,payout_cents,completion_photo_url,dispatch_orders(yards_needed,driver_pay_cents,cities(name))').eq('driver_id',user.id).order('submitted_at',{ascending:false}).limit(20)
      setLoads(l||[])
      setActiveTab('loads')
    }
    setSubmitting(false)
    setTimeout(()=>setSubmitResult(null),6000)
  }

  async function markComplete(loadId: string, driverPayCents: number) {
    if (!completionPhoto) {
      setSubmitResult({success:false,message:'Please upload a photo of the completed delivery'})
      setTimeout(()=>setSubmitResult(null),4000)
      return
    }
    if (!loadsDelivered || parseInt(loadsDelivered) < 1) {
      setSubmitResult({success:false,message:'Please enter how many loads were delivered'})
      setTimeout(()=>setSubmitResult(null),4000)
      return
    }
    setCompleting(true)
    const photoUrl = await uploadPhoto(user.id, completionPhoto, 'completions')
    if (!photoUrl) {
      setSubmitResult({success:false,message:'Photo upload failed — please try again'})
      setCompleting(false)
      return
    }
    const numLoads = parseInt(loadsDelivered)
    const res = await fetch('/api/driver/complete-load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loadId, completionPhotoUrl: photoUrl, loadsDelivered: numLoads })
    })
    const result = await res.json()
    if (!result.success) {
      setSubmitResult({success:false,message:result.error || 'Failed to mark complete. Please try again.'})
    } else {
      setSubmitResult({success:true,message:`🎉 Job complete! You delivered ${numLoads} load${numLoads>1?'s':''} — total pay: $${result.totalPayDollars}. Payment processed shortly.`})
      setCompletingId(null)
      setCompletionPhoto(null)
      setCompletionPreview(null)
      setLoadsDelivered('1')
      const supabase = createBrowserSupabase()
      const {data:l} = await supabase.from('load_requests').select('id,status,dirt_type,photo_url,truck_type,truck_count,yards_estimated,haul_date,submitted_at,rejected_reason,payout_cents,completion_photo_url,dispatch_orders(yards_needed,driver_pay_cents,cities(name))').eq('driver_id',user.id).order('submitted_at',{ascending:false}).limit(20)
      setLoads(l||[])
    }
    setCompleting(false)
    setTimeout(()=>setSubmitResult(null),8000)
  }

  async function signOut() {
    const supabase = createBrowserSupabase()
    await supabase.auth.signOut()
    router.push('/')
  }

  const tier = profile?.tiers
  const tierColor = ({trial:'#27AE60',hauler:'#3A8AE8',pro:'#F5A623',elite:'#8E44AD'} as any)[tier?.slug||'trial']||'#27AE60'
  const inp = {background:'#1C1F24',border:'1px solid #272B33',color:'#E8E3DC',padding:'11px 14px',borderRadius:'9px',fontSize:'14px',width:'100%',outline:'none',marginTop:'5px'}

  if (!user) return <div style={{background:'#0A0C0F',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#606670',fontFamily:'system-ui'}}>Loading...</div>

  return (
    <div style={{background:'#0A0C0F',minHeight:'100vh',color:'#E8E3DC',fontFamily:'system-ui,sans-serif'}}>
      <div style={{background:'#080A0C',borderBottom:'1px solid #272B33',padding:'14px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          
          <span style={{fontFamily:'Georgia,serif',fontSize:'18px',fontWeight:'700',letterSpacing:'0.02em',color:'#F0EDE8'}}>DUMPSITE<span style={{color:'#F5A623'}}>.IO</span></span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          {tier&&<span style={{background:`${tierColor}18`,color:tierColor,border:`1px solid ${tierColor}33`,padding:'4px 12px',borderRadius:'6px',fontSize:'11px',fontWeight:'800',textTransform:'uppercase'}}>{tier.name}</span>}
          <a href="/account" style={{background:'transparent',border:'1px solid #272B33',color:'#606670',padding:'7px 14px',borderRadius:'8px',textDecoration:'none',fontSize:'13px',marginRight:'8px'}}>My Account</a><button onClick={signOut} style={{background:'transparent',border:'1px solid #272B33',color:'#606670',padding:'7px 14px',borderRadius:'8px',cursor:'pointer',fontSize:'13px'}}>Sign Out</button>
        </div>
      </div>

      {profile&&(
        <div style={{background:'#111316',borderBottom:'1px solid #272B33',padding:'10px 20px',display:'flex',gap:'20px',flexWrap:'wrap',alignItems:'center'}}>
          <div style={{fontWeight:'700',fontSize:'14px'}}>Hi, {profile.first_name}! 👋</div>
          <div style={{fontSize:'12px',color:'#606670'}}>GPS Score: <span style={{color:'#F5A623',fontWeight:'700'}}>{profile.gps_score}%</span></div>
          <div style={{fontSize:'12px',color:'#606670'}}>Completed: <span style={{color:'#F5A623',fontWeight:'700'}}>{loads.filter((l:any)=>l.status==='completed').length} loads</span></div>
          {tier?.slug==='trial'&&<div style={{marginLeft:'auto',background:'rgba(245,166,35,0.08)',border:'1px solid rgba(245,166,35,0.2)',borderRadius:'6px',padding:'4px 12px',fontSize:'11px',color:'#F5A623'}}>Trial: {profile.trial_loads_used}/{tier.trial_load_limit} loads · <a href="/upgrade" style={{color:'#F5A623',fontWeight:'800'}}>Upgrade</a></div>}
        </div>
      )}

      {submitResult&&(
        <div style={{margin:'14px 20px',padding:'13px 16px',borderRadius:'10px',background:submitResult.success?'rgba(39,174,96,0.12)':'rgba(231,76,60,0.12)',border:`1px solid ${submitResult.success?'rgba(39,174,96,0.3)':'rgba(231,76,60,0.3)'}`,color:submitResult.success?'#27AE60':'#E74C3C',fontWeight:'600',fontSize:'14px'}}>
          {submitResult.message}
        </div>
      )}

      <div style={{display:'flex',borderBottom:'1px solid #272B33',background:'#111316'}}>
        {[['jobs','🏗️ Available Jobs'],['loads','🚚 My Loads'],['map','🗺️ Map View']].map(([tab,label])=>(
          <button key={tab} onClick={()=>setActiveTab(tab)} style={{padding:'13px 24px',background:'transparent',border:'none',borderBottom:activeTab===tab?'2px solid #F5A623':'2px solid transparent',color:activeTab===tab?'#F5A623':'#606670',cursor:'pointer',fontWeight:'700',fontSize:'12px',textTransform:'uppercase',letterSpacing:'0.07em'}}>{label}</button>
        ))}
      </div>

      <div style={{padding:'16px 20px',maxWidth:'860px',margin:'0 auto'}}>
        {activeTab==='jobs'&&(
          <div>
            {selectedJob?(
              <div>
                <button onClick={()=>{setSelectedJob(null);setPhotoFile(null);setPhotoPreview(null)}} style={{background:'transparent',border:'1px solid #272B33',color:'#606670',padding:'9px 16px',borderRadius:'8px',cursor:'pointer',fontSize:'13px',marginBottom:'16px'}}>← Back to Jobs</button>
                <div style={{background:'#111316',border:'1px solid #272B33',borderRadius:'14px',padding:'20px',marginBottom:'16px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'12px'}}>
                    <div>
                      <h2 style={{fontWeight:'900',fontSize:'24px',marginBottom:'4px'}}>Delivery Job — {selectedJob.cities?.name}</h2>
                      <div style={{fontSize:'13px',color:'#606670'}}>{selectedJob.yards_needed} yards needed</div>
                    </div>
                    <div style={{textAlign:'right',flexShrink:0,marginLeft:'16px'}}>
                      <div style={{fontWeight:'900',fontSize:'48px',color:'#F5A623',lineHeight:'1'}}>${Math.round((selectedJob.driver_pay_cents||2000)/100)}</div>
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
                    <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{display:'none'}}/>
                    <div onClick={()=>fileRef.current?.click()} style={{border:`2px dashed ${photoFile?'#27AE60':'#272B33'}`,borderRadius:'12px',padding:'24px',textAlign:'center',cursor:'pointer',background:photoFile?'rgba(39,174,96,0.05)':'#1C1F24'}}>
                      {photoPreview?(<div><img src={photoPreview} alt="Dirt" style={{maxHeight:'180px',maxWidth:'100%',borderRadius:'10px',marginBottom:'10px'}}/><div style={{fontSize:'13px',color:'#27AE60',fontWeight:'700'}}>✓ Photo ready — tap to replace</div></div>):(<div><div style={{fontSize:'40px',marginBottom:'10px'}}>📷</div><div style={{fontSize:'15px',fontWeight:'700',marginBottom:'5px'}}>Tap to take photo or upload</div><div style={{fontSize:'12px',color:'#606670'}}>Clear photo of your dirt required</div></div>)}
                    </div>
                  </div>
                  <div style={{marginBottom:'14px'}}>
                    <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700'}}>Material Type</label>
                    <select style={inp} value={form.dirtType} onChange={e=>setForm({...form,dirtType:e.target.value})}>
                      <option value="clean_fill">Clean Fill Dirt</option>
                      <option value="sandy_loam">Sandy Loam</option>
                      <option value="topsoil">Topsoil</option>
                      <option value="caliche">Caliche ⚠️ (requires extra review)</option>
                      <option value="clay_free">Clay-Free Soil</option>
                    </select>
                  </div>
                  <div style={{marginBottom:'14px'}}>
                    <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700'}}>Where is the dirt coming from? *</label>
                    <input style={inp} value={form.locationText} onChange={e=>setForm({...form,locationText:e.target.value})} placeholder="123 Main St, Dallas TX"/>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'14px'}}>
                    <div>
                      <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700'}}>Truck Type</label>
                      <select style={inp} value={form.truckType} onChange={e=>setForm({...form,truckType:e.target.value})}>
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
                      <input style={inp} type="number" min="1" max="50" value={form.truckCount} onChange={e=>setForm({...form,truckCount:e.target.value})}/>
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'18px'}}>
                    <div>
                      <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700'}}>Total Yards Available *</label>
                      <input style={inp} type="number" min="1" value={form.yardsEstimated} onChange={e=>setForm({...form,yardsEstimated:e.target.value})} placeholder="120"/>
                    </div>
                    <div>
                      <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700'}}>Haul Date *</label>
                      <input style={inp} type="date" value={form.haulDate} onChange={e=>setForm({...form,haulDate:e.target.value})} min={new Date().toISOString().split('T')[0]}/>
                    </div>
                  </div>
                  <button type="submit" disabled={submitting||uploadingPhoto} style={{width:'100%',background:'#F5A623',color:'#111',border:'none',padding:'15px',borderRadius:'10px',fontWeight:'800',fontSize:'16px',cursor:(submitting||uploadingPhoto)?'not-allowed':'pointer',opacity:(submitting||uploadingPhoto)?0.7:1,textTransform:'uppercase'}}>
                    {uploadingPhoto?'Uploading photo...':submitting?'Submitting...':'Submit Request — Get SMS When Approved'}
                  </button>
                </form>
              </div>
            ):(
              <div>
                <p style={{color:'#606670',fontSize:'14px',marginBottom:'16px'}}>Available delivery jobs in your area. You bring the dirt, we handle the rest.</p>
                {jobs.length===0?(<div style={{textAlign:'center',padding:'60px 20px',color:'#606670'}}><div style={{fontSize:'48px',marginBottom:'14px'}}>📍</div><div style={{fontWeight:'800',fontSize:'18px',marginBottom:'6px'}}>No jobs available right now</div><div style={{fontSize:'13px'}}>Check back soon</div></div>):jobs.map((job:any)=>(
                  <div key={job.id} onClick={()=>setSelectedJob(job)} style={{background:'#111316',border:'1px solid #272B33',borderRadius:'13px',padding:'18px',marginBottom:'12px',cursor:'pointer',borderLeft:'3px solid #27AE60'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:'800',fontSize:'18px',marginBottom:'4px'}}>Delivery Job — {job.cities?.name}</div>
                        <div style={{fontSize:'13px',color:'#606670',marginBottom:'8px'}}>{job.yards_needed} yards needed</div>
                        <div style={{display:'flex',gap:'8px'}}>
                          <span style={{background:'rgba(39,174,96,0.12)',color:'#27AE60',border:'1px solid rgba(39,174,96,0.3)',padding:'3px 10px',borderRadius:'5px',fontSize:'11px',fontWeight:'800'}}>✓ Open</span>
                          <span style={{background:'#1C1F24',color:'#606670',border:'1px solid #272B33',padding:'3px 10px',borderRadius:'5px',fontSize:'11px'}}>{job.urgency==='urgent'?'🔥 Urgent':'Standard'}</span>
                        </div>
                      </div>
                      <div style={{textAlign:'right',flexShrink:0,marginLeft:'16px'}}>
                        <div style={{fontWeight:'900',fontSize:'36px',color:'#F5A623',lineHeight:'1'}}>${Math.round((job.driver_pay_cents||2000)/100)}</div>
                        <div style={{fontSize:'11px',color:'#606670'}}>per load</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

                {activeTab==='map'&&(
          <div style={{paddingTop:'20px'}}>
            <MapView
              jobs={jobs}
              onSubmitInterest={(jobId: string) => {
                const job = jobs.find((j:any) => j.id === jobId)
                if (job) { setSelectedJob(job); setActiveTab('jobs') }
              }}
            />
          </div>
        )}
        {activeTab==='loads'&&(
          <div>
            <input ref={completionFileRef} type="file" accept="image/*" onChange={handleCompletionPhoto} style={{display:'none'}}/>
            {loads.length===0?(<div style={{textAlign:'center',padding:'60px 20px',color:'#606670'}}><div style={{fontSize:'48px',marginBottom:'14px'}}>📋</div><div style={{fontWeight:'800',fontSize:'18px',marginBottom:'6px'}}>No load requests yet</div><button onClick={()=>setActiveTab('jobs')} style={{marginTop:'14px',background:'#F5A623',color:'#111',border:'none',padding:'12px 28px',borderRadius:'9px',cursor:'pointer',fontWeight:'800',fontSize:'14px'}}>View Available Jobs</button></div>):loads.map((load:any)=>{
              const payPerLoad = load.dispatch_orders?.driver_pay_cents || 2000
              const loadsCount = load.truck_count || 1
              const totalEarned = Math.round((payPerLoad * loadsCount) / 100)
              return (
                <div key={load.id} style={{background:'#111316',border:'1px solid #272B33',borderRadius:'13px',padding:'16px',marginBottom:'12px',borderLeft:`3px solid ${load.status==='approved'?'#27AE60':load.status==='rejected'?'#E74C3C':load.status==='completed'?'#3A8AE8':'#F5A623'}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'10px'}}>
                    <div>
                      <div style={{fontWeight:'800',fontSize:'16px'}}>Delivery Job — {load.dispatch_orders?.cities?.name||'DFW'}</div>
                      <div style={{fontSize:'11px',color:'#606670',marginTop:'2px'}}>{new Date(load.submitted_at).toLocaleDateString()} · Haul date: {load.haul_date}</div>
                    </div>
                    <span style={{background:load.status==='approved'?'rgba(39,174,96,0.15)':load.status==='rejected'?'rgba(231,76,60,0.15)':load.status==='completed'?'rgba(59,138,232,0.15)':'rgba(245,166,35,0.12)',color:load.status==='approved'?'#27AE60':load.status==='rejected'?'#E74C3C':load.status==='completed'?'#3A8AE8':'#F5A623',padding:'4px 10px',borderRadius:'5px',fontSize:'11px',fontWeight:'800',textTransform:'uppercase' as const}}>{load.status}</span>
                  </div>
                  <div style={{display:'flex',gap:'16px',fontSize:'12px',color:'#606670',flexWrap:'wrap',marginBottom:'10px'}}>
                    <span>{load.dirt_type?.replace(/_/g,' ')}</span>
                    <span>{load.truck_count} load{load.truck_count>1?'s':''} delivered</span>
                    <span>{load.yards_estimated} yds</span>
                    {payPerLoad&&<span style={{color:'#F5A623',fontWeight:'700'}}>${Math.round(payPerLoad/100)}/load</span>}
                    {load.status==='completed'&&<span style={{color:'#27AE60',fontWeight:'800'}}>Total: ${totalEarned}</span>}
                  </div>

                  {load.status==='approved'&&(
                    <div>
                      <div style={{background:'rgba(39,174,96,0.08)',border:'1px solid rgba(39,174,96,0.25)',borderRadius:'9px',padding:'12px',fontSize:'13px',color:'#27AE60',fontWeight:'700',marginBottom:'12px'}}>
                        ✅ Approved! Delivery address sent to your phone via SMS.
                      </div>
                      {completingId===load.id?(
                        <div style={{background:'#1C1F24',border:'1px solid #272B33',borderRadius:'10px',padding:'16px'}}>
                          <div style={{fontWeight:'700',fontSize:'15px',marginBottom:'14px'}}>📸 Complete this job</div>
                          <div style={{marginBottom:'14px'}}>
                            <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700',display:'block',marginBottom:'6px'}}>How many loads did you deliver? *</label>
                            <input
                              type="number" min="1" max="200"
                              value={loadsDelivered}
                              onChange={e=>setLoadsDelivered(e.target.value)}
                              style={{background:'#111316',border:'1px solid #272B33',color:'#E8E3DC',padding:'12px 14px',borderRadius:'9px',fontSize:'16px',width:'100%',outline:'none'}}
                              placeholder="Enter number of loads"
                            />
                            {loadsDelivered&&parseInt(loadsDelivered)>0&&(
                              <div style={{marginTop:'8px',background:'rgba(245,166,35,0.08)',border:'1px solid rgba(245,166,35,0.2)',borderRadius:'7px',padding:'10px 14px',fontSize:'14px',color:'#F5A623',fontWeight:'700'}}>
                                💰 Your total pay: ${Math.round((payPerLoad * parseInt(loadsDelivered)) / 100)}
                              </div>
                            )}
                          </div>
                          <div style={{marginBottom:'14px'}}>
                            <label style={{fontSize:'11px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',fontWeight:'700',display:'block',marginBottom:'6px'}}>Photo of completed delivery *</label>
                            <div onClick={()=>completionFileRef.current?.click()} style={{border:`2px dashed ${completionPhoto?'#27AE60':'#272B33'}`,borderRadius:'10px',padding:'20px',textAlign:'center',cursor:'pointer',background:completionPhoto?'rgba(39,174,96,0.05)':'#0A0C0F'}}>
                              {completionPreview?(<div><img src={completionPreview} alt="Completion" style={{maxHeight:'160px',maxWidth:'100%',borderRadius:'8px',marginBottom:'8px'}}/><div style={{fontSize:'12px',color:'#27AE60',fontWeight:'700'}}>✓ Photo ready — tap to replace</div></div>):(<div><div style={{fontSize:'32px',marginBottom:'8px'}}>📷</div><div style={{fontSize:'14px',fontWeight:'700',marginBottom:'4px'}}>Photo of all dirt delivered</div><div style={{fontSize:'12px',color:'#606670'}}>Show the completed delivery site</div></div>)}
                            </div>
                          </div>
                          <div style={{display:'flex',gap:'8px'}}>
                            <button onClick={()=>markComplete(load.id, payPerLoad)} disabled={completing||!completionPhoto||!loadsDelivered} style={{flex:2,background:completionPhoto&&loadsDelivered?'rgba(39,174,96,0.15)':'#1C1F24',color:completionPhoto&&loadsDelivered?'#27AE60':'#606670',border:`1px solid ${completionPhoto&&loadsDelivered?'rgba(39,174,96,0.3)':'#272B33'}`,padding:'12px',borderRadius:'8px',cursor:completing||!completionPhoto||!loadsDelivered?'not-allowed':'pointer',fontWeight:'800',fontSize:'14px'}}>
                              {completing?'Submitting...':'✓ Mark Job Complete'}
                            </button>
                            <button onClick={()=>{setCompletingId(null);setCompletionPhoto(null);setCompletionPreview(null);setLoadsDelivered('1')}} style={{flex:1,background:'transparent',color:'#606670',border:'1px solid #272B33',padding:'12px',borderRadius:'8px',cursor:'pointer',fontSize:'13px'}}>Cancel</button>
                          </div>
                        </div>
                      ):(
                        <button onClick={()=>setCompletingId(load.id)} style={{width:'100%',background:'rgba(59,138,232,0.12)',color:'#3A8AE8',border:'1px solid rgba(59,138,232,0.3)',padding:'12px',borderRadius:'9px',cursor:'pointer',fontWeight:'800',fontSize:'14px'}}>
                          📸 Mark Complete + Upload Delivery Photo
                        </button>
                      )}
                    </div>
                  )}

                  {load.status==='completed'&&(
                    <div style={{background:'rgba(59,138,232,0.08)',border:'1px solid rgba(59,138,232,0.2)',borderRadius:'9px',padding:'12px',fontSize:'13px',color:'#3A8AE8',fontWeight:'700'}}>
                      🎉 Job completed! {load.truck_count} load{load.truck_count>1?'s':''} delivered · Total earned: ${totalEarned} · Payment processed shortly.
                    </div>
                  )}

                  {load.status==='rejected'&&load.rejected_reason&&(
                    <div style={{background:'rgba(231,76,60,0.07)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:'9px',padding:'12px',fontSize:'13px',color:'#606670'}}>
                      Rejected: <span style={{color:'#E74C3C'}}>{load.rejected_reason}</span>
                    </div>
                  )}

                  {load.status==='pending'&&(
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
