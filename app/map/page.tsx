'use client'
import { useState, useEffect } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { CITY_COORDS } from '@/lib/city-coords'

/**
 * SECURITY: All pins use city center coordinates from CITY_COORDS.
 * NEVER uses client_address, delivery_latitude, or delivery_longitude.
 */
function getCityCoords(city: string): [number, number] {
  const coords = CITY_COORDS[city] || { lat: 32.82, lng: -97.1 }
  // Add jitter so pins don't stack exactly
  const jitter = (Math.random() - 0.5) * 0.02
  return [coords.lat + jitter, coords.lng + jitter]
}

export default function MapPage() {
  const [user, setUser] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
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
  }, [])

  const minLat=32.0,maxLat=33.9,minLng=-98.1,maxLng=-96.1
  function toPos(lat:number,lng:number){
    return {x:Math.max(2,Math.min(98,((lng-minLng)/(maxLng-minLng))*100)),y:Math.max(2,Math.min(98,((maxLat-lat)/(maxLat-minLat))*100))}
  }
  // SECURITY: Use city center coords only — never exact address
  const mapped = jobs.map(j=>{const[lat,lng]=getCityCoords(j.cities?.name||'Dallas');return{...j,p:toPos(lat,lng)}})

  if (loading) return <div style={{background:'#0A0C0F',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#606670',fontFamily:'system-ui'}}>Loading map...</div>

  return (
    <div style={{background:'#0A0C0F',minHeight:'100vh',color:'#E8E3DC',fontFamily:'system-ui,sans-serif',display:'flex',flexDirection:'column'}}>
      <div style={{background:'#080A0C',borderBottom:'1px solid #272B33',padding:'12px 20px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <div style={{width:'28px',height:'28px',background:'#F5A623',borderRadius:'6px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px'}}>{'\uD83D\uDE9B'}</div>
          <span style={{fontWeight:'800',fontSize:'16px',color:'#F5A623'}}>DumpSite.io — Job Map</span>
        </div>
        <a href="/dashboard" style={{background:'transparent',border:'1px solid #272B33',color:'#606670',padding:'7px 14px',borderRadius:'8px',textDecoration:'none',fontSize:'13px'}}>List View</a>
      </div>
      <div style={{display:'flex',flex:1,minHeight:0}}>
        <div style={{flex:1,position:'relative',overflow:'hidden',minHeight:'500px'}}>
          <iframe
            src="https://www.openstreetmap.org/export/embed.html?bbox=-97.8%2C32.4%2C-96.4%2C33.3&layer=mapnik&marker=32.7767%2C-96.7970"
            style={{position:'absolute',inset:0,width:'100%',height:'100%',border:'none',opacity:0.7}}
          />
          <div style={{position:'absolute',inset:0,pointerEvents:'none'}}>
            {mapped.map(job=>(
              <div key={job.id} onClick={()=>setSelected(selected?.id===job.id?null:job)} style={{position:'absolute',left:`${job.p.x}%`,top:`${job.p.y}%`,transform:'translate(-50%,-50%)',cursor:'pointer',pointerEvents:'all',zIndex:selected?.id===job.id?20:10}}>
                <div style={{width:selected?.id===job.id?'20px':'14px',height:selected?.id===job.id?'20px':'14px',background:selected?.id===job.id?'#F5A623':'#27AE60',borderRadius:'50%',border:`2px solid ${selected?.id===job.id?'#fff':'rgba(255,255,255,0.5)'}`,boxShadow:'0 2px 8px rgba(0,0,0,0.8)',transition:'all 0.2s'}}/>
                {selected?.id===job.id&&(
                  <div style={{position:'absolute',bottom:'120%',left:'50%',transform:'translateX(-50%)',background:'#111316',border:'1px solid #F5A623',borderRadius:'8px',padding:'8px 12px',whiteSpace:'nowrap',fontSize:'12px',fontWeight:'700',color:'#F5A623',zIndex:30}}>
                    {job.cities?.name} — ${Math.round((job.driver_pay_cents||2000)/100)}/load
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{position:'absolute',top:'12px',left:'12px',background:'rgba(0,0,0,0.85)',border:'1px solid #272B33',borderRadius:'8px',padding:'8px 14px',fontSize:'12px',color:'#606670',zIndex:10}}>
            DFW Metro &middot; {jobs.length} active delivery jobs
          </div>
        </div>
        <div style={{width:'280px',borderLeft:'1px solid #272B33',overflowY:'auto',background:'#0D0F12',flexShrink:0}}>
          <div style={{padding:'14px 16px',borderBottom:'1px solid #272B33',fontWeight:'700',fontSize:'12px',color:'#606670',textTransform:'uppercase',letterSpacing:'0.07em'}}>{jobs.length} Available Dump Sites</div>
          {mapped.map(job=>(
            <div key={job.id} onClick={()=>setSelected(selected?.id===job.id?null:job)} style={{padding:'12px 14px',borderBottom:'1px solid #1C1F24',cursor:'pointer',background:selected?.id===job.id?'rgba(245,166,35,0.08)':'transparent',borderLeft:`3px solid ${selected?.id===job.id?'#F5A623':'transparent'}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
                <div style={{fontWeight:'700',fontSize:'13px'}}>{'\uD83D\uDCCD'} {job.cities?.name}</div>
                <div style={{fontWeight:'900',fontSize:'18px',color:'#F5A623'}}>${Math.round((job.driver_pay_cents||2000)/100)}</div>
              </div>
              <div style={{fontSize:'11px',color:'#606670',marginBottom:'3px'}}>{job.yards_needed} yards needed</div>
              <div style={{fontSize:'10px',color:'#27AE60',marginBottom:'5px'}}>{'\uD83D\uDE9B'} {job.truck_type_needed?.replace(/_/g,' ') || 'Tandem Only'}</div>
              <span style={{background:'rgba(39,174,96,0.12)',color:'#27AE60',border:'1px solid rgba(39,174,96,0.3)',padding:'2px 8px',borderRadius:'4px',fontSize:'10px',fontWeight:'800'}}>Open</span>
              {selected?.id===job.id&&<a href="/dashboard" style={{display:'block',marginTop:'8px',background:'#F5A623',color:'#111',padding:'8px',borderRadius:'7px',textAlign:'center',textDecoration:'none',fontWeight:'800',fontSize:'12px'}}>Claim This Job</a>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
