'use client'
import { useState, useEffect } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function DriverJobsPage() {
  const [user, setUser] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabase.auth.getUser().then(({data}) => {
      if (!data.user) { router.push('/login'); return }
      setUser(data.user)
      fetch('/api/driver/jobs')
        .then(r => r.json())
        .then(payload => { setJobs(payload.jobs || []); setLoading(false) })
        .catch(() => setLoading(false))
    })
  }, [router])

  if (loading) return <div style={{background:'#0A0C0F',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#606670',fontFamily:'system-ui'}}>Loading jobs...</div>

  return (
    <div style={{background:'#0A0C0F',minHeight:'100vh',color:'#E8E3DC',fontFamily:'system-ui,sans-serif'}}>
      {/* HEADER */}
      <div style={{background:'#080A0C',borderBottom:'1px solid #272B33',padding:'12px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <div style={{width:'28px',height:'28px',background:'#F5A623',borderRadius:'6px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px'}}>{'\uD83D\uDE9B'}</div>
          <span style={{fontWeight:'800',fontSize:'16px',color:'#F5A623'}}>DumpSite.io</span>
        </div>
        <a href="/account" style={{background:'transparent',border:'1px solid #272B33',color:'#606670',padding:'7px 14px',borderRadius:'8px',textDecoration:'none',fontSize:'13px'}}>Account</a>
      </div>

      {/* JOBS COUNT */}
      <div style={{padding:'20px 20px 8px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontWeight:'700',fontSize:'14px',color:'#606670',textTransform:'uppercase',letterSpacing:'0.07em'}}>{jobs.length} Available Dump Sites</div>
        <button onClick={() => { setLoading(true); fetch('/api/driver/jobs').then(r=>r.json()).then(p=>{setJobs(p.jobs||[]);setLoading(false)}).catch(()=>setLoading(false)) }} style={{background:'transparent',border:'1px solid #272B33',color:'#606670',padding:'6px 12px',borderRadius:'6px',fontSize:'12px',cursor:'pointer'}}>Refresh</button>
      </div>

      {/* JOBS LIST */}
      <div style={{padding:'8px 20px 20px',display:'flex',flexDirection:'column',gap:'10px'}}>
        {jobs.length === 0 && (
          <div style={{textAlign:'center',padding:'60px 20px',color:'#606670',fontSize:'14px'}}>
            No jobs available right now. Check back soon.
          </div>
        )}
        {jobs.map(job => (
          <div key={job.id} style={{background:'#0D0F12',border:'1px solid #1C1F24',borderRadius:'10px',padding:'16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontWeight:'700',fontSize:'15px',marginBottom:'4px'}}>{'\uD83D\uDCCD'} {job.cities?.name || 'DFW'}</div>
              <div style={{fontSize:'12px',color:'#606670',marginBottom:'3px'}}>{job.yards_needed} yards needed</div>
              <div style={{fontSize:'11px',color:'#27AE60'}}>{'\uD83D\uDE9B'} {job.truck_type_needed?.replace(/_/g,' ') || 'Tandem Only'}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontWeight:'900',fontSize:'24px',color:'#F5A623'}}>${Math.round((job.driver_pay_cents||2000)/100)}</div>
              <div style={{fontSize:'10px',color:'#606670'}}>per load</div>
              <span style={{background:'rgba(39,174,96,0.12)',color:'#27AE60',border:'1px solid rgba(39,174,96,0.3)',padding:'2px 8px',borderRadius:'4px',fontSize:'10px',fontWeight:'800',marginTop:'4px',display:'inline-block'}}>Open</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
