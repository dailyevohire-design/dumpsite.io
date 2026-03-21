'use client'
import { useState, useEffect } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const COORDS: Record<string,[number,number]> = {
  'Arlington':[32.7357,-97.1081],'Azle':[32.8957,-97.5436],
  'Bonham':[33.5762,-96.1772],'Carrollton':[32.9537,-96.8903],
  'Carthage':[32.1582,-94.3394],'Cedar Hill':[32.5882,-96.9561],
  'Cleburne':[32.3471,-97.3836],'Colleyville':[32.8868,-97.1505],
  'Covington':[32.1751,-97.2614],'Dallas':[32.7767,-96.7970],
  'Denison':[33.7557,-96.5369],'DeSoto':[32.5896,-96.8572],
  'Everman':[32.6293,-97.2836],'Ferris':[32.5293,-96.6639],
  'Fort Worth':[32.7555,-97.3308],'Garland':[32.9126,-96.6389],
  'Godley':[32.4432,-97.5317],'Gordonville':[33.8032,-96.8561],
  'Grand Prairie':[32.7460,-97.0186],'Haslet':[32.9682,-97.3389],
  'Hillsboro':[32.0132,-97.1239],'Hutchins':[32.6432,-96.7083],
  'Irving':[32.8140,-96.9489],'Joshua':[32.4593,-97.3903],
  'Justin':[33.0843,-97.2967],'Kaufman':[32.5893,-96.3061],
  'Lake Worth':[32.8068,-97.4336],'Little Elm':[33.1629,-96.9375],
  'Mabank':[32.3668,-96.1044],'Mansfield':[32.5632,-97.1411],
  'Matador':[34.0107,-100.8237],'McKinney':[33.1972,-96.6397],
  'Midlothian':[32.4821,-97.0053],'Plano':[33.0198,-96.6989],
  'Ponder':[33.1843,-97.2836],'Princeton':[33.1790,-96.4997],
  'Rockwall':[32.9312,-96.4597],'Terrell':[32.7357,-96.2752],
  'Venus':[32.4307,-97.1006]
}

function getCoords(city: string): [number,number] {
  const exact = COORDS[city]
  if (exact) return exact
  const key = Object.keys(COORDS).find(k => city?.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(city?.toLowerCase()))
  return key ? COORDS[key] : [32.7767,-96.7970]
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
  const mapped = jobs.map(j=>{const[lat,lng]=getCoords(j.cities?.name||'Dallas');return{...j,p:toPos(lat,lng)}})

  if (loading) return <div style={{background:'#0A0C0F',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#606670',fontFamily:'system-ui'}}>Loading map...</div>

  return (
    <div style={{background:'#0A0C0F',minHeight:'100vh',color:'#E8E3DC',fontFamily:'system-ui,sans-serif',display:'flex',flexDirection:'column'}}>
      <div style={{background:'#080A0C',borderBottom:'1px solid #272B33',padding:'12px 20px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <div style={{width:'28px',height:'28px',background:'#F5A623',borderRadius:'6px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px'}}>🚛</div>
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
            DFW Metro · {jobs.length} active delivery jobs
          </div>
        </div>
        <div style={{width:'280px',borderLeft:'1px solid #272B33',overflowY:'auto',background:'#0D0F12',flexShrink:0}}>
          <div style={{padding:'14px 16px',borderBottom:'1px solid #272B33',fontWeight:'700',fontSize:'12px',color:'#606670',textTransform:'uppercase',letterSpacing:'0.07em'}}>{jobs.length} Available Dump Sites</div>
          {mapped.map(job=>(
            <div key={job.id} onClick={()=>setSelected(selected?.id===job.id?null:job)} style={{padding:'12px 14px',borderBottom:'1px solid #1C1F24',cursor:'pointer',background:selected?.id===job.id?'rgba(245,166,35,0.08)':'transparent',borderLeft:`3px solid ${selected?.id===job.id?'#F5A623':'transparent'}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
                <div style={{fontWeight:'700',fontSize:'13px'}}>📍 {job.cities?.name}</div>
                <div style={{fontWeight:'900',fontSize:'18px',color:'#F5A623'}}>${Math.round((job.driver_pay_cents||2000)/100)}</div>
              </div>
              <div style={{fontSize:'11px',color:'#606670',marginBottom:'5px'}}>{job.yards_needed} yards needed</div>
              <span style={{background:'rgba(39,174,96,0.12)',color:'#27AE60',border:'1px solid rgba(39,174,96,0.3)',padding:'2px 8px',borderRadius:'4px',fontSize:'10px',fontWeight:'800'}}>Open</span>
              {selected?.id===job.id&&<a href="/dashboard" style={{display:'block',marginTop:'8px',background:'#F5A623',color:'#111',padding:'8px',borderRadius:'7px',textAlign:'center',textDecoration:'none',fontWeight:'800',fontSize:'12px'}}>Claim This Job</a>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
