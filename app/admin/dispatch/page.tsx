'use client'
import { useState } from 'react'
import Link from 'next/link'

const CITIES = [
  {id:"29f39e32-0692-4208-9d28-d241c3c69ef5",name:"Alvarado"},
  {id:"ce7d27ec-9df8-4fdd-bc51-309442893a42",name:"Arlington"},
  {id:"ea58fbed-826d-4f0a-92f7-abe3b757e419",name:"Austin"},
  {id:"1527cdd8-061e-4447-87fb-70a64057056e",name:"Azle"},
  {id:"6bdb0af5-7247-4aad-96fb-0b190ef49626",name:"Bonham"},
  {id:"a3a9bb90-b72c-4311-8743-3dd212f51a21",name:"Carrollton"},
  {id:"36c683d4-2759-4b22-ad4b-668af29c4220",name:"Carthage"},
  {id:"0213177f-8a77-44a6-805f-2599845ee42e",name:"Cedar Hill"},
  {id:"af5563b4-8b7b-4e3a-9565-37e0147376fa",name:"Cleburne"},
  {id:"d8aa7b49-2370-4b3f-9f7b-56f2f9841773",name:"Colleyville"},
  {id:"5dc99abb-8ac6-435a-91a6-f2c22ec5c85e",name:"Covington"},
  {id:"0bbd35f1-7c96-443d-9854-489e844e16d7",name:"Dallas"},
  {id:"28170a02-c7bb-4f6b-b773-1a9e928e1dd5",name:"Denison"},
  {id:"70fa3326-4116-4c7c-94cb-b8ae03e7252c",name:"Denton"},
  {id:"7bc3086d-3b43-493c-ac45-195c3c693413",name:"DeSoto"},
  {id:"cd7b1980-8027-43f9-b5c9-c2975259b9b8",name:"Everman"},
  {id:"d5066e50-7517-46f4-a5e5-78abcd4d76be",name:"Ferris"},
  {id:"a8bc9b0f-9491-44d3-93b1-946271557eff",name:"Fort Worth"},
  {id:"7ce9dbd7-96f4-4bbc-aaac-e79495c6fe2e",name:"Garland"},
  {id:"5c46d6fd-2ddc-4af6-8c78-3b45b400063a",name:"Godley"},
  {id:"ebdb0a42-848a-4a87-8dbb-5d46540a619c",name:"Grand Prairie"},
  {id:"3cbb265e-51f6-4958-98c8-485d73605e1f",name:"Haslet"},
  {id:"1cf2100b-7e74-4349-9d03-deec3c091e2c",name:"Hillsboro"},
  {id:"c55cc12a-5f4e-4ff0-91d8-f56859c449e0",name:"Houston"},
  {id:"df322cd0-098b-44b5-a968-41beeb8b6480",name:"Hutchins"},
  {id:"75865806-091d-453d-bf2b-0337aa6c9f60",name:"Irving"},
  {id:"eee61caa-f853-47d8-8fda-1c69ed130c02",name:"Joshua"},
  {id:"e345bfd8-0e97-403a-bddc-2a41f3dfe90e",name:"Justin"},
  {id:"125d2a3c-1c43-4fbd-9633-12b3dde8f573",name:"Kaufman"},
  {id:"20a69674-3248-4bc3-ae2c-8b073fc1b555",name:"Lake Worth"},
  {id:"35bd27ed-46bb-4da0-82a1-108d151853b8",name:"Little Elm"},
  {id:"5fb50f77-efeb-47d8-90f8-01ff7924a97d",name:"Mabank"},
  {id:"a8739e77-43a5-4ecf-a964-9b0096bcbb9b",name:"Mansfield"},
  {id:"3585f8fe-7896-4176-80e2-938b66a17ef6",name:"McKinney"},
  {id:"8dd32d64-42e5-42d4-9806-4a118a1bccc7",name:"Mesquite"},
  {id:"ee76f6f5-cf5c-4b6d-9570-065d630529ad",name:"Midlothian"},
  {id:"fa967b09-9370-42ce-8235-f4e1605ff049",name:"Plano"},
  {id:"96e1a833-d434-4779-b519-9be76675fba0",name:"Ponder"},
  {id:"8bbd555c-07c0-4264-994c-04b7a7432f3d",name:"Princeton"},
  {id:"3771f020-accd-483f-835a-44818ef8a86d",name:"Rockwall"},
  {id:"849c2c41-877d-42a5-b74f-e13bc7c0c798",name:"Terrell"},
  {id:"febee5cb-46a8-40a9-b145-8c033703af02",name:"Venus"},
]

const inp: any = {width:'100%',background:'#111',border:'1px solid #272B33',borderRadius:'6px',padding:'10px 14px',color:'#F0EDE8',fontSize:'14px',fontFamily:'system-ui,sans-serif',boxSizing:'border-box'}
const lbl: any = {display:'block',fontSize:'11px',letterSpacing:'0.1em',color:'#606670',fontFamily:'system-ui,sans-serif',textTransform:'uppercase',marginBottom:'6px',fontWeight:'700'}

export default function NewDispatch() {
  const [form, setForm] = useState({
    clientName:'', clientPhone:'', clientAddress:'', cityId:'',
    yardsNeeded:'', priceQuoted:'', truckTypeNeeded:'tandem_axle',
    urgency:'standard', notes:'', salesRep:''
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(f => ({...f, [k]: v}))

  const submit = async () => {
    if (!form.clientName || !form.clientAddress || !form.cityId || !form.yardsNeeded) {
      setError('Please fill in all required fields'); return
    }
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          clientName: form.clientName,
          clientPhone: form.clientPhone,
          clientAddress: form.clientAddress,
          cityId: form.cityId,
          yardsNeeded: form.yardsNeeded,
          priceQuoted: form.priceQuoted,
          truckTypeNeeded: form.truckTypeNeeded,
          urgency: form.urgency,
          notes: form.notes,
          source: 'manual',
          createdBy: form.salesRep
        })
      })
      const data = await res.json()
      if (data.success) {
        setResult(data)
        setForm({clientName:'',clientPhone:'',clientAddress:'',cityId:'',yardsNeeded:'',priceQuoted:'',truckTypeNeeded:'tandem_axle',urgency:'standard',notes:'',salesRep:''})
      } else {
        setError(data.error || 'Failed to create dispatch')
      }
    } catch { setError('Network error') }
    setLoading(false)
  }

  return (
    <main style={{minHeight:'100vh',background:'#0A0A0A',color:'#F0EDE8',fontFamily:'system-ui,sans-serif'}}>
      <nav style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 32px',borderBottom:'1px solid #1A1A1A'}}>
        <span style={{fontFamily:'Georgia,serif',fontSize:'18px',fontWeight:'700'}}>DUMPSITE<span style={{color:'#F5A623'}}>.IO</span> <span style={{color:'#606670',fontSize:'13px',fontWeight:'400'}}>ADMIN</span></span>
        <Link href="/admin" style={{color:'#606670',textDecoration:'none',fontSize:'13px',border:'1px solid #272B33',padding:'7px 16px',borderRadius:'6px'}}>Back to Dashboard</Link>
      </nav>
      <div style={{maxWidth:'720px',margin:'0 auto',padding:'48px 24px'}}>
        <p style={{fontSize:'11px',letterSpacing:'0.15em',color:'#F5A623',textTransform:'uppercase',marginBottom:'8px'}}>New Order</p>
        <h1 style={{fontSize:'28px',fontWeight:'400',fontFamily:'Georgia,serif',marginBottom:'8px'}}>Create Dispatch</h1>
        <p style={{fontSize:'14px',color:'#555',marginBottom:'40px'}}>Adds the job to the driver map and available jobs list instantly.</p>
        {result && (
          <div style={{background:'rgba(39,174,96,0.1)',border:'1px solid rgba(39,174,96,0.3)',borderRadius:'8px',padding:'16px 20px',marginBottom:'28px'}}>
            <div style={{fontWeight:'700',color:'#27AE60',marginBottom:'4px'}}>Dispatch Created Successfully</div>
            <div style={{fontSize:'13px',color:'#888'}}>Drivers notified: {result.driversNotified} - City: {result.cityName}</div>
            <Link href="/admin" style={{display:'inline-block',marginTop:'12px',fontSize:'13px',color:'#F5A623',textDecoration:'none'}}>View in Dashboard</Link>
          </div>
        )}
        {error && <div style={{background:'rgba(231,76,60,0.1)',border:'1px solid rgba(231,76,60,0.3)',borderRadius:'8px',padding:'14px 18px',marginBottom:'24px',color:'#E74C3C',fontSize:'13px'}}>{error}</div>}
        <div style={{display:'grid',gap:'20px'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
            <div><label style={lbl}>Client Name *</label><input style={inp} value={form.clientName} onChange={e=>set('clientName',e.target.value)} placeholder="John Smith" /></div>
            <div><label style={lbl}>Client Phone</label><input style={inp} value={form.clientPhone} onChange={e=>set('clientPhone',e.target.value)} placeholder="(817) 555-0000" type="tel" /></div>
          </div>
          <div><label style={lbl}>Delivery Address *</label><input style={inp} value={form.clientAddress} onChange={e=>set('clientAddress',e.target.value)} placeholder="1234 Main St, Fort Worth, TX 76104" /></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
            <div>
              <label style={lbl}>City *</label>
              <select style={inp} value={form.cityId} onChange={e=>set('cityId',e.target.value)}>
                <option value="">Select city...</option>
                {CITIES.map((c:any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Yards Needed *</label><input style={inp} value={form.yardsNeeded} onChange={e=>set('yardsNeeded',e.target.value)} placeholder="24" type="number" min="1" /></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px'}}>
            <div><label style={lbl}>Price Quoted ($)</label><input style={inp} value={form.priceQuoted} onChange={e=>set('priceQuoted',e.target.value)} placeholder="350.00" type="number" /></div>
            <div>
              <label style={lbl}>Truck Type</label>
              <select style={inp} value={form.truckTypeNeeded} onChange={e=>set('truckTypeNeeded',e.target.value)}>
                <option value="tandem_axle">Tandem Axle</option>
                <option value="end_dump">End Dump</option>
                <option value="tri_axle">Tri-Axle</option>
                <option value="super_dump">Super Dump</option>
                <option value="semi_transfer">Semi Transfer</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Urgency</label>
              <select style={inp} value={form.urgency} onChange={e=>set('urgency',e.target.value)}>
                <option value="standard">Standard</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div><label style={lbl}>Sales Rep Name</label><input style={inp} value={form.salesRep} onChange={e=>set('salesRep',e.target.value)} placeholder="e.g. Marcus, Sarah" /></div>
          <div><label style={lbl}>Internal Notes</label><textarea style={{...inp,resize:'none',height:'80px'}} value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Any special instructions..." /></div>
          <button onClick={submit} disabled={loading} style={{background:'#F5A623',color:'#111',border:'none',padding:'16px',borderRadius:'6px',fontWeight:'800',fontSize:'14px',letterSpacing:'0.08em',textTransform:'uppercase',cursor:loading?'not-allowed':'pointer',opacity:loading?0.7:1,width:'100%'}}>
            {loading ? 'Creating Dispatch...' : '+ Create Dispatch - Notify Drivers'}
          </button>
        </div>
      </div>
    </main>
  )
}
