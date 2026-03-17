'use client'
import { useState, useEffect } from 'react'

export default function AdminDashboard() {
  const [loads, setLoads] = useState<any[]>([])
  const [activeOrders, setActiveOrders] = useState<any[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('pending')
  const [rejectReason, setRejectReason] = useState('')
  const [rejectingId, setRejectingId] = useState<string|null>(null)
  const [processing, setProcessing] = useState<string|null>(null)
  const [message, setMessage] = useState<{text:string;type:'success'|'error'}|null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => { fetchLoads() }, [activeTab])

  async function fetchLoads() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/loads?status=${activeTab}`)
      const data = await res.json()
      setLoads(data.loads || [])
      setTotal(data.total || 0)
    } catch (e) {
      console.error(e)
      setLoads([])
    }
    setLoading(false)
  }

  async function fetchActiveOrders() {
    setOrdersLoading(true)
    try {
      const res = await fetch('/api/admin/dispatch')
      const data = await res.json()
      setActiveOrders(data.orders || [])
    } catch(e) { console.error(e) }
    setOrdersLoading(false)
  }

  async function approve(id: string) {
    setProcessing(id)
    try {
      const res = await fetch(`/api/admin/loads/${id}/approve`, { method: 'PATCH' })
      const data = await res.json()
      if (data.success) {
        setMessage({ text: '✅ Approved! SMS sent to driver with delivery address.', type: 'success' })
        fetchLoads()
      } else {
        setMessage({ text: data.error || data.message || 'Failed to approve', type: 'error' })
      }
    } catch { setMessage({ text: 'Network error — try again', type: 'error' }) }
    setProcessing(null)
    setTimeout(() => setMessage(null), 5000)
  }

  async function reject(id: string) {
    if (!rejectReason.trim() || rejectReason.length < 5) {
      setMessage({ text: 'Please enter a rejection reason', type: 'error' })
      return
    }
    setProcessing(id)
    try {
      const res = await fetch(`/api/admin/loads/${id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason })
      })
      const data = await res.json()
      if (data.success) {
        setMessage({ text: '❌ Rejected. Driver notified.', type: 'success' })
        setRejectingId(null)
        setRejectReason('')
        fetchLoads()
      } else {
        setMessage({ text: data.message || 'Failed', type: 'error' })
      }
    } catch { setMessage({ text: 'Network error — try again', type: 'error' }) }
    setProcessing(null)
    setTimeout(() => setMessage(null), 5000)
  }

  return (
    <div style={{background:'#0A0C0F',minHeight:'100vh',color:'#E8E3DC',fontFamily:'system-ui,sans-serif'}}>
      <div style={{background:'#080A0C',borderBottom:'1px solid #272B33',padding:'14px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <span style={{fontFamily:'Georgia,serif',fontSize:'18px',fontWeight:'700',letterSpacing:'0.02em',color:'#F0EDE8'}}>DUMPSITE<span style={{color:'#F5A623'}}>.IO</span></span>
          <span style={{fontWeight:'400',fontSize:'13px',color:'#606670',letterSpacing:'0.05em',fontFamily:'system-ui,sans-serif'}}>ADMIN</span>
        </div>
        <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
          <span style={{fontSize:'12px',color:'#606670'}}>{total} {activeTab} requests</span>
          <a href="/admin/dispatch" style={{background:'#F5A623',color:'#111',padding:'9px 18px',borderRadius:'8px',textDecoration:'none',fontWeight:'800',fontSize:'13px',textTransform:'uppercase'}}>+ New Dispatch</a>
        </div>
      </div>

      {message&&(
        <div style={{margin:'12px 20px',padding:'12px 16px',borderRadius:'9px',background:message.type==='success'?'rgba(39,174,96,0.12)':'rgba(231,76,60,0.12)',border:`1px solid ${message.type==='success'?'rgba(39,174,96,0.3)':'rgba(231,76,60,0.3)'}`,color:message.type==='success'?'#27AE60':'#E74C3C',fontWeight:'600',fontSize:'13px'}}>
          {message.text}
        </div>
      )}

      <div style={{display:'flex',borderBottom:'1px solid #272B33',background:'#111316'}}>
        {['pending','approved','rejected','completed','orders'].map(tab=>(
          <button key={tab} onClick={()=>{setActiveTab(tab); if(tab==='orders') fetchActiveOrders()}} style={{padding:'12px 20px',background:'transparent',border:'none',borderBottom:activeTab===tab?'2px solid #F5A623':'2px solid transparent',color:activeTab===tab?'#F5A623':'#606670',cursor:'pointer',fontWeight:'700',fontSize:'12px',textTransform:'uppercase',letterSpacing:'0.07em'}}>
            {tab}
          </button>
        ))}
        <button onClick={fetchLoads} style={{marginLeft:'auto',padding:'12px 16px',background:'transparent',border:'none',color:'#606670',cursor:'pointer',fontSize:'18px'}}>↻</button>
      </div>

      <div style={{padding:'16px 20px',maxWidth:'1000px',margin:'0 auto'}}>
        {loading?(
          <div style={{textAlign:'center',padding:'60px',color:'#606670'}}>
            <div style={{fontSize:'32px',marginBottom:'12px'}}>⏳</div>
            <div style={{fontWeight:'700'}}>Loading requests...</div>
          </div>
        ):loads.length===0?(
          <div style={{textAlign:'center',padding:'60px',color:'#606670'}}>
            <div style={{fontSize:'40px',marginBottom:'12px'}}>📋</div>
            <div style={{fontWeight:'800',fontSize:'18px',marginBottom:'6px'}}>No {activeTab} requests</div>
            <div style={{fontSize:'13px'}}>When drivers submit load requests they will appear here instantly</div>
          </div>
        ):loads.map(load=>{
          const driver = load.driver_profiles
          const order = load.dispatch_orders
          const driverPay = order?.driver_pay_cents ? Math.round(order.driver_pay_cents/100) : 20

          return (
            <div key={load.id} style={{background:'#111316',border:'1px solid #272B33',borderRadius:'13px',padding:'18px',marginBottom:'12px',borderLeft:`3px solid ${load.requires_extra_review?'#E74C3C':load.status==='approved'?'#27AE60':'#F5A623'}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'12px',flexWrap:'wrap',gap:'8px'}}>
                <div>
                  <div style={{fontWeight:'800',fontSize:'17px',marginBottom:'3px'}}>
                    {driver?.first_name} {driver?.last_name}
                    <span style={{fontWeight:'400',color:'#606670',fontSize:'13px'}}> — {driver?.company_name||'Independent'}</span>
                  </div>
                  <div style={{fontSize:'11px',color:'#606670'}}>
                    {load.id.slice(0,8)}... · Submitted {new Date(load.submitted_at).toLocaleString()} · {driver?.phone}
                  </div>
                  {order&&(
                    <div style={{fontSize:'12px',color:'#F5A623',marginTop:'3px',fontWeight:'600'}}>
                      Job: {order.cities?.name} — {order.client_address?.slice(0,50)}
                    </div>
                  )}
                </div>
                <div style={{display:'flex',gap:'6px',flexWrap:'wrap',alignItems:'center'}}>
                  {load.requires_extra_review&&<span style={{background:'rgba(231,76,60,0.15)',color:'#E74C3C',border:'1px solid rgba(231,76,60,0.3)',padding:'3px 9px',borderRadius:'5px',fontSize:'10px',fontWeight:'800'}}>⚠️ CALICHE</span>}
                  <span style={{background:'rgba(245,166,35,0.12)',color:'#F5A623',border:'1px solid rgba(245,166,35,0.25)',padding:'3px 9px',borderRadius:'5px',fontSize:'10px',fontWeight:'800'}}>{driver?.tiers?.name||'Trial'}</span>
                  <span style={{background:'rgba(39,174,96,0.12)',color:'#27AE60',border:'1px solid rgba(39,174,96,0.25)',padding:'3px 9px',borderRadius:'5px',fontSize:'10px',fontWeight:'800'}}>GPS {driver?.gps_score||100}%</span>
                  <span style={{background:'rgba(59,138,232,0.12)',color:'#3A8AE8',border:'1px solid rgba(59,138,232,0.25)',padding:'3px 9px',borderRadius:'5px',fontSize:'11px',fontWeight:'800'}}>Driver gets ${driverPay}/load</span>
                </div>
              </div>

              <div style={{display:'flex',gap:'16px',flexWrap:'wrap',marginBottom:'12px'}}>
                {[
                  ['Material', load.dirt_type?.replace(/_/g,' ')],
                  ['Truck', load.truck_type?.replace(/_/g,' ')],
                  ['Trucks', String(load.truck_count)],
                  ['Yards', `${load.yards_estimated} yds`],
                  ['Haul Date', load.haul_date],
                ].map(([label,value])=>(
                  <div key={label}>
                    <div style={{fontSize:'9px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',marginBottom:'2px'}}>{label}</div>
                    <div style={{fontSize:'13px',fontWeight:'600'}}>{value}</div>
                  </div>
                ))}
              </div>

              {load.photo_url&&load.photo_url!=='pending'&&(
                <div style={{marginBottom:'12px'}}>
                  <div style={{fontSize:'10px',textTransform:'uppercase' as const,letterSpacing:'0.07em',color:'#606670',marginBottom:'6px'}}>Dirt Photo</div>
                  <img src={load.photo_url} alt="Dirt" style={{maxHeight:'200px',maxWidth:'100%',borderRadius:'10px',border:'1px solid #272B33'}}/>
                </div>
              )}

              {load.status==='pending'&&(
                <div>
                  {rejectingId===load.id?(
                    <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                      <input
                        value={rejectReason}
                        onChange={e=>setRejectReason(e.target.value)}
                        placeholder="Rejection reason (e.g. too much clay, caliche not accepted)"
                        style={{flex:'1',minWidth:'200px',background:'#1C1F24',border:'1px solid #272B33',color:'#E8E3DC',padding:'10px 14px',borderRadius:'8px',fontSize:'13px',outline:'none'}}
                      />
                      <button onClick={()=>reject(load.id)} disabled={processing===load.id} style={{background:'rgba(231,76,60,0.15)',color:'#E74C3C',border:'1px solid rgba(231,76,60,0.3)',padding:'10px 18px',borderRadius:'8px',cursor:'pointer',fontWeight:'700',fontSize:'13px'}}>
                        {processing===load.id?'Sending...':'Confirm Reject'}
                      </button>
                      <button onClick={()=>{setRejectingId(null);setRejectReason('')}} style={{background:'transparent',color:'#606670',border:'1px solid #272B33',padding:'10px 16px',borderRadius:'8px',cursor:'pointer',fontSize:'13px'}}>Cancel</button>
                    </div>
                  ):(
                    <div style={{display:'flex',gap:'10px'}}>
                      <button onClick={()=>approve(load.id)} disabled={processing===load.id} style={{flex:2,background:'rgba(39,174,96,0.15)',color:'#27AE60',border:'1px solid rgba(39,174,96,0.3)',padding:'12px',borderRadius:'9px',cursor:'pointer',fontWeight:'800',fontSize:'14px'}}>
                        {processing===load.id?'Processing...':'✓ Approve — Send Address via SMS'}
                      </button>
                      <button onClick={()=>setRejectingId(load.id)} style={{flex:1,background:'rgba(231,76,60,0.15)',color:'#E74C3C',border:'1px solid rgba(231,76,60,0.3)',padding:'12px',borderRadius:'9px',cursor:'pointer',fontWeight:'700',fontSize:'14px'}}>
                        ✕ Reject
                      </button>
                    </div>
                  )}
                </div>
              )}

              {load.status==='rejected'&&load.rejected_reason&&(
                <div style={{background:'rgba(231,76,60,0.08)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:'8px',padding:'10px 14px',fontSize:'12px',color:'#606670'}}>
                  Rejection reason: <span style={{color:'#E74C3C'}}>{load.rejected_reason}</span>
                </div>
              )}

              {load.status==='approved'&&(
                <div style={{background:'rgba(39,174,96,0.08)',border:'1px solid rgba(39,174,96,0.2)',borderRadius:'8px',padding:'10px 14px',fontSize:'12px',color:'#27AE60',fontWeight:'600'}}>
                  ✓ Approved — Address sent to driver via SMS
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
