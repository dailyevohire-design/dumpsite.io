'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

interface ParsedOrder {
  clientName: string | null
  clientPhone: string | null
  clientAddress: string | null
  cityName: string | null
  yardsNeeded: number | null
  pricePerLoad: number | null
  driverPay: number | null
  truckTypeNeeded: 'tandem_axle' | 'end_dump'
  notes: string | null
  isDelivered: boolean
  confidence: {
    clientName: 'high'|'medium'|'low'
    clientPhone: 'high'|'medium'|'low'
    clientAddress: 'high'|'medium'|'low'
    cityName: 'high'|'medium'|'low'
    yardsNeeded: 'high'|'medium'|'low'
    pricePerLoad: 'high'|'medium'|'low'
  }
  overallConfidence: 'high'|'medium'|'low'
  reviewNotes: string | null
  submitError?: string
  submitSuccess?: boolean
  driversNotified?: number
}

// Cities loaded dynamically from the database

const inp: React.CSSProperties = {width:'100%',background:'#111',border:'1px solid #272B33',borderRadius:'6px',padding:'10px 14px',color:'#F0EDE8',fontSize:'14px',fontFamily:'system-ui,sans-serif',boxSizing:'border-box'}
const lbl: React.CSSProperties = {display:'block',fontSize:'11px',letterSpacing:'0.1em',color:'#606670',fontFamily:'system-ui,sans-serif',textTransform:'uppercase',marginBottom:'6px',fontWeight:'700'}

function confidenceBorderColor(level: string): string {
  if (level === 'high') return '#272B33'
  if (level === 'medium') return 'rgba(245,166,35,0.5)'
  return 'rgba(231,76,60,0.5)'
}

function overallBadge(order: ParsedOrder): { bg: string; color: string; text: string } {
  if (!order.clientAddress || !order.cityName || !order.yardsNeeded) {
    return { bg: 'rgba(231,76,60,0.15)', color: '#E74C3C', text: 'INCOMPLETE' }
  }
  if (order.overallConfidence === 'high') {
    return { bg: 'rgba(39,174,96,0.15)', color: '#27AE60', text: 'READY' }
  }
  if (order.overallConfidence === 'medium') {
    return { bg: 'rgba(245,166,35,0.15)', color: '#F5A623', text: 'REVIEW' }
  }
  return { bg: 'rgba(231,76,60,0.15)', color: '#E74C3C', text: 'INCOMPLETE' }
}

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = ev => {
      const img = new Image()
      img.onload = () => {
        const maxW = 1920
        let w = img.width, h = img.height
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('canvas failed')); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = reject
      img.src = ev.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

export default function NewDispatch() {
  // ── Cities from DB ──
  const [CITIES, setCities] = useState<{id:string,name:string}[]>([])
  useEffect(() => {
    fetch('/api/admin/cities')
      .then(r => r.json())
      .then(d => { if (d.success) setCities(d.data) })
      .catch(() => {})
  }, [])

  // ── Existing form state (unchanged) ──
  const [form, setForm] = useState({
    clientName:'', clientPhone:'', clientAddress:'', cityId:'',
    yardsNeeded:'', priceQuoted:'', driverPay:'', truckTypeNeeded:'tandem_axle',
    urgency:'standard', notes:'', salesRep:''
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  // ── AI Parser state ──
  const [parserTab, setParserTab] = useState<'text'|'image'>('text')
  const [pasteText, setPasteText] = useState('')
  const [parserImages, setParserImages] = useState<string[]>([])
  const [imagePreviews, setImagePreviews] = useState<{url:string,name:string,size:string}[]>([])
  const [parsedOrders, setParsedOrders] = useState<ParsedOrder[]>([])
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [parseSuccess, setParseSuccess] = useState('')
  const [submittingOrderIndex, setSubmittingOrderIndex] = useState<number|null>(null)
  const [submittedIndexes, setSubmittedIndexes] = useState<Set<number>>(new Set())
  const [truckFixResult, setTruckFixResult] = useState<string|null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const set = (k: string, v: string) => setForm(f => ({...f, [k]: v}))

  // ── Existing submit (unchanged) ──
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
          driverPay: form.driverPay,
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
        setForm({clientName:'',clientPhone:'',clientAddress:'',cityId:'',yardsNeeded:'',priceQuoted:'',driverPay:'',truckTypeNeeded:'tandem_axle',urgency:'standard',notes:'',salesRep:''})
        setParsedOrders([])
        setSubmittedIndexes(new Set())
        setParserImages([])
        setImagePreviews([])
        setPasteText('')
        setParseSuccess('')
        if (imageInputRef.current) imageInputRef.current.value = ''
      } else {
        setError(data.error || 'Failed to create dispatch')
      }
    } catch { setError('Network error') }
    setLoading(false)
  }

  // ── AI Parser handlers ──
  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const newB64: string[] = []
    const newPrev: {url:string,name:string,size:string}[] = []
    for (const f of files.slice(0, 10)) {
      if (!f.type.startsWith('image/')) continue
      try {
        const b64 = await compressImage(f)
        newB64.push(b64)
        newPrev.push({ url: URL.createObjectURL(f), name: f.name, size: formatBytes(f.size) })
      } catch { /* skip bad files */ }
    }
    setParserImages(p => [...p, ...newB64].slice(0, 10))
    setImagePreviews(p => [...p, ...newPrev].slice(0, 10))
    if (e.target) e.target.value = ''
  }

  async function handleParseOrders() {
    if (parserTab === 'text' && !pasteText.trim()) { setParseError('Please paste some text first'); return }
    if (parserTab === 'image' && parserImages.length === 0) { setParseError('Please upload at least one screenshot'); return }
    setParsing(true); setParsedOrders([]); setParseError(''); setParseSuccess('')
    try {
      const body: Record<string, unknown> = {}
      if (parserTab === 'text') body.text = pasteText
      if (parserTab === 'image') body.images = parserImages
      const res = await fetch('/api/admin/parse-orders', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setParseError(data.error || 'Parse failed. Please try again.')
      } else {
        setParsedOrders(data.orders || [])
        if ((data.orders || []).length === 0) {
          setParseError('No orders found in that text. Try adding more context.')
        } else {
          setParseSuccess(`${data.orders.length} order${data.orders.length > 1 ? 's' : ''} found` + (data.skippedReason ? ` · ${data.skippedReason}` : ''))
        }
      }
    } catch { setParseError('Network error — please try again.') }
    setParsing(false)
  }

  function loadOrderIntoForm(order: ParsedOrder) {
    const matchedCity = CITIES.find(c => c.name.toLowerCase() === (order.cityName || '').toLowerCase())
    set('clientName', order.clientName || '')
    set('clientPhone', order.clientPhone || '')
    set('clientAddress', order.clientAddress || '')
    set('cityId', matchedCity?.id || '')
    set('yardsNeeded', order.yardsNeeded ? String(order.yardsNeeded) : '')
    set('priceQuoted', order.pricePerLoad ? String(order.pricePerLoad) : '')
    set('driverPay', order.driverPay ? String(order.driverPay) : '')
    set('truckTypeNeeded', order.truckTypeNeeded || 'tandem_axle')
    set('notes', order.notes || '')
    document.getElementById('manual-dispatch-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function submitParsedOrder(order: ParsedOrder, index: number) {
    if (!order.clientAddress) { setParsedOrders(prev => prev.map((o, i) => i === index ? {...o, submitError: 'Address is required'} : o)); return }
    if (!order.cityName) { setParsedOrders(prev => prev.map((o, i) => i === index ? {...o, submitError: 'City is required — use Edit in Form'} : o)); return }
    const matchedCity = CITIES.find(c => c.name.toLowerCase() === order.cityName!.toLowerCase())
    if (!matchedCity) { setParsedOrders(prev => prev.map((o, i) => i === index ? {...o, submitError: `City "${order.cityName}" not in system — use Edit in Form`} : o)); return }
    setSubmittingOrderIndex(index)
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          clientName: order.clientName || 'Unknown',
          clientPhone: order.clientPhone || '',
          clientAddress: order.clientAddress,
          cityId: matchedCity.id,
          yardsNeeded: String(order.yardsNeeded || 12),
          priceQuoted: String(order.pricePerLoad || 144),
          driverPay: String(order.driverPay || 45),
          truckTypeNeeded: order.truckTypeNeeded || 'tandem_axle',
          urgency: 'standard',
          notes: order.notes || '',
          source: 'manual',
          createdBy: 'AI Parser'
        })
      })
      const data = await res.json()
      if (data.success) {
        const newSubmitted = new Set([...submittedIndexes, index])
        setSubmittedIndexes(newSubmitted)
        setParsedOrders(prev => {
          const updated = prev.map((o, i) => i === index ? {...o, submitSuccess: true, driversNotified: data.driversNotified, submitError: undefined} : o)
          // Clear everything if all orders are submitted
          if (updated.every((o, i) => o.submitSuccess || newSubmitted.has(i))) {
            setTimeout(() => {
              setParsedOrders([])
              setSubmittedIndexes(new Set())
              setParserImages([])
              setImagePreviews([])
              setPasteText('')
              setParseSuccess('')
              if (imageInputRef.current) imageInputRef.current.value = ''
            }, 1500)
          }
          return updated
        })
      } else {
        setParsedOrders(prev => prev.map((o, i) => i === index ? {...o, submitError: data.error || 'Submit failed'} : o))
      }
    } catch {
      setParsedOrders(prev => prev.map((o, i) => i === index ? {...o, submitError: 'Network error'} : o))
    }
    setSubmittingOrderIndex(null)
  }

  async function submitAllReady() {
    const readyIndexes = parsedOrders.map((o, i) => ({o, i})).filter(({o, i}) =>
      o.overallConfidence === 'high' && !submittedIndexes.has(i) && !!o.clientAddress && !!o.cityName &&
      CITIES.some(c => c.name.toLowerCase() === (o.cityName || '').toLowerCase())
    ).map(({i}) => i)
    for (const idx of readyIndexes) {
      await submitParsedOrder(parsedOrders[idx], idx)
      await new Promise(r => setTimeout(r, 600))
    }
  }

  async function fixTruckAccess() {
    try {
      const res = await fetch('/api/admin/fix-truck-access', { method: 'POST' })
      const data = await res.json()
      if (data.success) setTruckFixResult(data.message)
      else setTruckFixResult('Error: ' + (data.error || 'Failed'))
    } catch { setTruckFixResult('Network error') }
  }

  const parserDisabled = parsing || (parserTab === 'text' && !pasteText.trim()) || (parserTab === 'image' && parserImages.length === 0)

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

        {/* ═══ AI ORDER PARSER ═══ */}
        <div style={{background:'rgba(245,166,35,0.04)',border:'1px solid rgba(245,166,35,0.15)',borderRadius:'14px',padding:'24px',marginBottom:'32px'}}>
          <div style={{marginBottom:'16px'}}>
            <div style={{fontSize:'16px',fontWeight:'800',color:'#F5A623',marginBottom:'4px'}}>AI Order Parser</div>
            <div style={{fontSize:'13px',color:'#606670'}}>Paste text messages or upload screenshots — AI extracts order details in seconds</div>
          </div>

          {/* Tab switcher */}
          <div style={{display:'flex',gap:'0',borderBottom:'1px solid #272B33',marginBottom:'16px'}}>
            {(['text','image'] as const).map(tab => (
              <button key={tab} onClick={() => { setParserTab(tab); setParseError(''); setParseSuccess('') }}
                style={{background:'transparent',border:'none',borderBottom:parserTab===tab ? '2px solid #F5A623' : '2px solid transparent',color:parserTab===tab ? '#F5A623' : '#606670',padding:'10px 20px',cursor:'pointer',fontSize:'13px',fontWeight:'700'}}>
                {tab === 'text' ? 'Paste Text' : 'Upload Screenshots'}
              </button>
            ))}
          </div>

          {/* Text tab */}
          {parserTab === 'text' && (
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
              placeholder={'Paste the full text message conversation here.\nCan be one message or an entire back-and-forth thread.\nAI reads the whole conversation and extracts order details.'}
              style={{width:'100%',minHeight:'180px',resize:'vertical',background:'#1C1F24',border:'1px solid #272B33',borderRadius:'9px',padding:'14px',color:'#E8E3DC',fontSize:'14px',outline:'none',boxSizing:'border-box'}} />
          )}

          {/* Image tab */}
          {parserTab === 'image' && (
            <div>
              <input ref={imageInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} style={{display:'none'}} />
              <div onClick={() => imageInputRef.current?.click()}
                style={{border:'2px dashed #272B33',borderRadius:'12px',padding:'40px 20px',textAlign:'center',cursor:'pointer',background:'#1C1F24',marginBottom:imagePreviews.length > 0 ? '12px' : '0'}}>
                <div style={{fontSize:'32px',marginBottom:'8px'}}>📸</div>
                <div style={{fontWeight:'700',fontSize:'15px',color:'#E8E3DC',marginBottom:'4px'}}>Tap to upload screenshots</div>
                <div style={{fontSize:'12px',color:'#606670'}}>Multiple screenshots OK · PNG, JPG, HEIC · Max 10</div>
              </div>
              {imagePreviews.length > 0 && (
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(80px,1fr))',gap:'8px',marginTop:'12px'}}>
                  {imagePreviews.map((prev, i) => (
                    <div key={i} style={{position:'relative'}}>
                      <img src={prev.url} alt={prev.name} style={{width:'100%',height:'80px',objectFit:'cover',borderRadius:'6px',border:'1px solid #272B33'}} />
                      <button onClick={() => { setParserImages(p => p.filter((_,j) => j !== i)); setImagePreviews(p => p.filter((_,j) => j !== i)) }}
                        style={{position:'absolute',top:'2px',right:'2px',background:'rgba(0,0,0,0.7)',color:'#fff',border:'none',borderRadius:'50%',width:'18px',height:'18px',cursor:'pointer',fontSize:'10px',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
                      <div style={{fontSize:'10px',color:'#606670',marginTop:'2px',textAlign:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{prev.size}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Parse button */}
          <button onClick={handleParseOrders} disabled={parserDisabled}
            style={{width:'100%',marginTop:'12px',height:'48px',background:parserDisabled ? '#272B33' : '#F5A623',color:parserDisabled ? '#606670' : '#111',border:'none',borderRadius:'9px',fontWeight:'800',fontSize:'14px',cursor:parserDisabled ? 'not-allowed' : 'pointer'}}>
            {parsing ? 'Analyzing...' : parserTab === 'text' ? 'Extract Order from Text' : 'Extract Order from Screenshots'}
          </button>

          {parseError && <div style={{marginTop:'10px',padding:'10px 14px',borderRadius:'8px',background:'rgba(231,76,60,0.12)',border:'1px solid rgba(231,76,60,0.3)',color:'#E74C3C',fontSize:'13px'}}>{parseError}</div>}
          {parseSuccess && !parseError && <div style={{marginTop:'10px',padding:'10px 14px',borderRadius:'8px',background:'rgba(39,174,96,0.12)',border:'1px solid rgba(39,174,96,0.3)',color:'#27AE60',fontSize:'13px',fontWeight:'600'}}>{parseSuccess}</div>}

          {/* Parsed order cards */}
          {parsedOrders.length > 0 && (
            <div style={{marginTop:'20px'}}>
              {parsedOrders.length > 1 && (
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px',flexWrap:'wrap',gap:'10px'}}>
                  <div style={{fontWeight:'700',fontSize:'14px'}}>
                    {parsedOrders.length} orders found · <span style={{color:'#27AE60'}}>{parsedOrders.filter(o => o.overallConfidence==='high' && o.clientAddress && o.cityName).length} ready</span> · <span style={{color:'#F5A623'}}>{parsedOrders.filter(o => o.overallConfidence !== 'high' || !o.clientAddress || !o.cityName).length} need review</span>
                  </div>
                  {parsedOrders.filter((o, i) => o.overallConfidence==='high' && o.clientAddress && o.cityName && !submittedIndexes.has(i)).length >= 2 && (
                    <button onClick={submitAllReady} disabled={submittingOrderIndex !== null}
                      style={{background:'#27AE60',color:'#fff',border:'none',padding:'10px 20px',borderRadius:'8px',fontWeight:'800',fontSize:'13px',cursor:'pointer'}}>Submit All Ready Orders</button>
                  )}
                </div>
              )}

              {parsedOrders.map((order, index) => {
                const badge = overallBadge(order)
                const isSubmitting = submittingOrderIndex === index

                if (order.submitSuccess) {
                  return (
                    <div key={index} style={{background:'rgba(39,174,96,0.08)',border:'1px solid rgba(39,174,96,0.3)',borderRadius:'12px',padding:'20px',marginBottom:'12px'}}>
                      <div style={{fontWeight:'800',fontSize:'16px',color:'#27AE60',marginBottom:'8px'}}>Order created!</div>
                      <div style={{fontSize:'13px',color:'#606670'}}>💰 ${order.pricePerLoad}/load · {order.yardsNeeded} yards</div>
                      <div style={{fontSize:'13px',color:'#606670'}}>{order.driversNotified || 0} drivers notified in {order.cityName}</div>
                      <div style={{fontSize:'13px',color:'#606670',marginTop:'8px'}}>{(order.yardsNeeded || 0) >= 100 ? 'End Dump · 18-Wheeler · Tandem accepted' : 'Tandem Only'}</div>
                    </div>
                  )
                }

                return (
                  <div key={index} style={{background:'#111316',border:'1px solid #272B33',borderRadius:'12px',padding:'20px',marginBottom:'12px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px',flexWrap:'wrap',gap:'8px'}}>
                      <div style={{fontWeight:'800',fontSize:'16px'}}>{order.clientName || 'Unknown Client'}</div>
                      <span style={{background:badge.bg,color:badge.color,padding:'4px 10px',borderRadius:'6px',fontSize:'11px',fontWeight:'800'}}>{badge.text}</span>
                    </div>

                    {([
                      {label:'Client Name',field:'clientName',type:'text',conf:order.confidence.clientName},
                      {label:'Phone',field:'clientPhone',type:'text',conf:order.confidence.clientPhone},
                      {label:'Address',field:'clientAddress',type:'text',conf:order.confidence.clientAddress},
                      {label:'City',field:'cityName',type:'city',conf:order.confidence.cityName},
                      {label:'Yards Needed',field:'yardsNeeded',type:'number',conf:order.confidence.yardsNeeded},
                      {label:'Price Per Load ($)',field:'pricePerLoad',type:'number',conf:order.confidence.pricePerLoad},
                    ] as const).map(({label, field, type, conf}) => (
                      <div key={field} style={{marginBottom:'12px'}}>
                        <label style={{fontSize:'10px',fontWeight:'700',letterSpacing:'0.07em',textTransform:'uppercase',color:'#606670',display:'block',marginBottom:'4px'}}>{label}</label>
                        {type === 'city' ? (
                          <select value={CITIES.find(c => c.name.toLowerCase() === (order.cityName||'').toLowerCase())?.id || ''}
                            onChange={e => { const city = CITIES.find(c => c.id === e.target.value); setParsedOrders(prev => prev.map((o,i) => i===index ? {...o, cityName: city?.name || ''} : o)) }}
                            style={{width:'100%',background:'#1C1F24',border:`1px solid ${confidenceBorderColor(conf)}`,borderRadius:'8px',padding:'10px 14px',color:'#E8E3DC',fontSize:'14px',outline:'none'}}>
                            <option value="">Select city...</option>
                            {CITIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        ) : (
                          <input type={type}
                            value={(order as any)[field] != null ? String((order as any)[field]) : ''}
                            onChange={e => { const val = type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value; setParsedOrders(prev => prev.map((o,i) => i===index ? {...o, [field]: val} : o)) }}
                            style={{width:'100%',background:'#1C1F24',border:`1px solid ${confidenceBorderColor(conf)}`,borderRadius:'8px',padding:'10px 14px',color:'#E8E3DC',fontSize:'14px',outline:'none',boxSizing:'border-box'}} />
                        )}
                        {conf === 'low' && <div style={{fontSize:'11px',color:'#E74C3C',marginTop:'3px'}}>Please verify this field</div>}
                      </div>
                    ))}

                    <div style={{marginBottom:'12px'}}>
                      <label style={{fontSize:'10px',fontWeight:'700',letterSpacing:'0.07em',textTransform:'uppercase',color:'#606670',display:'block',marginBottom:'4px'}}>Truck Type</label>
                      <select value={order.truckTypeNeeded} onChange={e => setParsedOrders(prev => prev.map((o,i) => i===index ? {...o, truckTypeNeeded: e.target.value as 'tandem_axle'|'end_dump'} : o))}
                        style={{width:'100%',background:'#1C1F24',border:'1px solid #272B33',borderRadius:'8px',padding:'10px 14px',color:'#E8E3DC',fontSize:'14px',outline:'none'}}>
                        <option value="tandem_axle">Tandem Axle</option>
                        <option value="end_dump">End Dump / 18-Wheeler</option>
                      </select>
                    </div>

                    <div style={{marginBottom:'12px'}}>
                      <label style={{fontSize:'10px',fontWeight:'700',letterSpacing:'0.07em',textTransform:'uppercase',color:'#606670',display:'block',marginBottom:'4px'}}>Notes</label>
                      <textarea value={order.notes || ''} onChange={e => setParsedOrders(prev => prev.map((o,i) => i===index ? {...o, notes: e.target.value} : o))} rows={2}
                        style={{width:'100%',background:'#1C1F24',border:'1px solid #272B33',borderRadius:'8px',padding:'10px 14px',color:'#E8E3DC',fontSize:'14px',outline:'none',resize:'vertical',boxSizing:'border-box'}} />
                    </div>

                    {order.reviewNotes && <div style={{background:'rgba(245,166,35,0.08)',border:'1px solid rgba(245,166,35,0.2)',borderRadius:'8px',padding:'10px 14px',fontSize:'12px',color:'#F5A623',marginBottom:'12px'}}>{order.reviewNotes}</div>}
                    {order.submitError && <div style={{background:'rgba(231,76,60,0.08)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:'8px',padding:'10px 14px',fontSize:'12px',color:'#E74C3C',marginBottom:'12px'}}>{order.submitError}</div>}
                    {(!order.clientAddress || !order.cityName || !order.yardsNeeded) && (
                      <div style={{background:'rgba(231,76,60,0.08)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:'8px',padding:'10px 14px',fontSize:'12px',color:'#E74C3C',marginBottom:'12px'}}>
                        {!order.clientAddress && 'Address is required. '}{!order.cityName && 'City is required. '}{!order.yardsNeeded && 'Yards needed is required.'}
                      </div>
                    )}

                    <button onClick={() => submitParsedOrder(order, index)} disabled={isSubmitting || !order.clientAddress || !order.cityName}
                      style={{width:'100%',height:'48px',background:(isSubmitting || !order.clientAddress || !order.cityName) ? '#272B33' : '#F5A623',color:(isSubmitting || !order.clientAddress || !order.cityName) ? '#606670' : '#111',border:'none',borderRadius:'9px',fontWeight:'800',fontSize:'14px',cursor:(isSubmitting || !order.clientAddress || !order.cityName) ? 'not-allowed' : 'pointer',marginBottom:'8px'}}>
                      {isSubmitting ? 'Submitting...' : 'Submit This Order'}
                    </button>
                    <button onClick={() => loadOrderIntoForm(order)} style={{width:'100%',height:'40px',background:'transparent',border:'1px solid #272B33',color:'#606670',borderRadius:'9px',fontSize:'13px',cursor:'pointer',marginBottom:'8px'}}>Edit in Form Below</button>
                    <button onClick={() => setParsedOrders(prev => prev.filter((_,i) => i !== index))} style={{background:'none',border:'none',color:'#606670',fontSize:'12px',cursor:'pointer',padding:'4px 0'}}>Skip this order</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Fix Truck Access button */}
        {!truckFixResult && (
          <button onClick={fixTruckAccess} style={{background:'transparent',border:'1px solid #272B33',color:'#606670',padding:'8px 16px',borderRadius:'6px',fontSize:'12px',cursor:'pointer',marginBottom:'24px'}}>
            Fix Truck Access on Existing Orders
          </button>
        )}
        {truckFixResult && <div style={{fontSize:'12px',color:'#27AE60',marginBottom:'24px'}}>{truckFixResult}</div>}

        {/* ═══ EXISTING MANUAL FORM (unchanged) ═══ */}
        <div id="manual-dispatch-form">
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
                  {CITIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Yards Needed *</label><input style={inp} value={form.yardsNeeded} onChange={e=>set('yardsNeeded',e.target.value)} placeholder="24" type="number" min="1" /></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'16px'}}>
              <div><label style={lbl}>Price Quoted ($)</label><input style={inp} value={form.priceQuoted} onChange={e=>set('priceQuoted',e.target.value)} placeholder="350.00" type="number" /></div>
              <div><label style={{...lbl,color:'#F5A623'}}>Driver Pay ($) *</label><input style={{...inp,borderColor:'#F5A623'}} value={form.driverPay} onChange={e=>set('driverPay',e.target.value)} placeholder="45.00" type="number" /></div>
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
            <div><label style={lbl}>Internal Notes</label><textarea style={{...inp,resize:'none' as const,height:'80px'}} value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Any special instructions..." /></div>
            <button onClick={submit} disabled={loading} style={{background:'#F5A623',color:'#111',border:'none',padding:'16px',borderRadius:'6px',fontWeight:'800',fontSize:'14px',letterSpacing:'0.08em',textTransform:'uppercase',cursor:loading?'not-allowed':'pointer',opacity:loading?0.7:1,width:'100%'}}>
              {loading ? 'Creating Dispatch...' : '+ Create Dispatch - Notify Drivers'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
