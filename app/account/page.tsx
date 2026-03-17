'use client'
import { useState, useEffect, useRef } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function AccountPage() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [activeSection, setActiveSection] = useState('profile')
  const [uploadingW9, setUploadingW9] = useState(false)
  const w9Ref = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const [form, setForm] = useState({
    firstName: '', lastName: '', companyName: '', phone: '',
    truckCount: '1', truckType: 'tandem_axle',
    bankName: '', accountHolderName: '', routingNumber: '', accountNumber: '',
    accountType: 'checking', paymentMethod: 'ach',
    w9Url: ''
  })

  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabase.auth.getUser().then(async ({data}) => {
      if (!data.user) { router.push('/login'); return }
      setUser(data.user)
      const { data: p } = await supabase
        .from('driver_profiles')
        .select('*, tiers(name,slug)')
        .eq('user_id', data.user.id)
        .single()
      if (p) {
        setProfile(p)
        setForm(f => ({
          ...f,
          firstName: p.first_name || '',
          lastName: p.last_name || '',
          companyName: p.company_name || '',
          phone: p.phone || '',
          truckCount: String(p.truck_count || 1),
          truckType: p.truck_type || 'tandem_axle',
          bankName: p.bank_name || '',
          accountHolderName: p.account_holder_name || '',
          routingNumber: p.routing_number || '',
          accountNumber: p.account_number || '',
          accountType: p.account_type || 'checking',
          paymentMethod: p.payment_method || 'ach',
          w9Url: p.w9_url || ''
        }))
      }
      setLoading(false)
    })
  }, [])

  async function saveProfile() {
    setSaving(true)
    const supabase = createBrowserSupabase()
    const { error } = await supabase
      .from('driver_profiles')
      .update({
        first_name: form.firstName,
        last_name: form.lastName,
        company_name: form.companyName,
        phone: form.phone,
        truck_count: parseInt(form.truckCount),
        truck_type: form.truckType,
        bank_name: form.bankName,
        account_holder_name: form.accountHolderName,
        routing_number: form.routingNumber,
        account_number: form.accountNumber,
        account_type: form.accountType,
        payment_method: form.paymentMethod
      })
      .eq('user_id', user.id)
    if (error) {
      setResult({success:false,message:'Failed to save. Please try again.'})
    } else {
      setResult({success:true,message:'✅ Profile saved successfully!'})
    }
    setSaving(false)
    setTimeout(()=>setResult(null),4000)
  }

  async function uploadW9(e: any) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { alert('File must be under 10MB'); return }
    setUploadingW9(true)
    const supabase = createBrowserSupabase()
    const ext = file.name.split('.').pop() || 'pdf'
    const path = `${user.id}/w9/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('dirt-photos').upload(path, file, { upsert: true })
    if (error) {
      setResult({success:false,message:'W9 upload failed. Please try again.'})
      setUploadingW9(false)
      return
    }
    const { data: urlData } = supabase.storage.from('dirt-photos').getPublicUrl(path)
    const w9Url = urlData.publicUrl
    await supabase.from('driver_profiles').update({ w9_url: w9Url }).eq('user_id', user.id)
    setForm(f => ({...f, w9Url}))
    setResult({success:true,message:'✅ W9 uploaded successfully!'})
    setUploadingW9(false)
    setTimeout(()=>setResult(null),4000)
  }

  const inp = {background:'#1C1F24',border:'1px solid #272B33',color:'#E8E3DC',padding:'11px 14px',borderRadius:'9px',fontSize:'14px',width:'100%',outline:'none',marginTop:'5px'}
  const lbl = {fontSize:'11px',fontWeight:'700' as const,letterSpacing:'0.07em',textTransform:'uppercase' as const,color:'#606670',display:'block',marginBottom:'0px'}

  if (loading) return <div style={{background:'#0A0C0F',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#606670',fontFamily:'system-ui'}}>Loading...</div>

  return (
    <div style={{background:'#0A0C0F',minHeight:'100vh',color:'#E8E3DC',fontFamily:'system-ui,sans-serif'}}>
      <div style={{background:'#080A0C',borderBottom:'1px solid #272B33',padding:'14px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <div style={{width:'30px',height:'30px',background:'#F5A623',borderRadius:'7px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'16px'}}>🚛</div>
          <span style={{fontWeight:'800',fontSize:'17px',color:'#F5A623'}}>DumpSite.io</span>
        </div>
        <a href="/dashboard" style={{background:'transparent',border:'1px solid #272B33',color:'#606670',padding:'7px 14px',borderRadius:'8px',textDecoration:'none',fontSize:'13px'}}>← Back to Dashboard</a>
      </div>

      <div style={{maxWidth:'700px',margin:'0 auto',padding:'24px 20px'}}>
        <h1 style={{fontWeight:'900',fontSize:'26px',marginBottom:'4px'}}>My Account</h1>
        <p style={{color:'#606670',fontSize:'13px',marginBottom:'24px'}}>Manage your profile, payment info, and documents</p>

        {result&&(
          <div style={{marginBottom:'16px',padding:'13px 16px',borderRadius:'10px',background:result.success?'rgba(39,174,96,0.12)':'rgba(231,76,60,0.12)',border:`1px solid ${result.success?'rgba(39,174,96,0.3)':'rgba(231,76,60,0.3)'}`,color:result.success?'#27AE60':'#E74C3C',fontWeight:'600',fontSize:'14px'}}>
            {result.message}
          </div>
        )}

        <div style={{display:'flex',gap:'8px',marginBottom:'24px',flexWrap:'wrap'}}>
          {[['profile','👤 Profile'],['truck','🚛 Truck Info'],['payment','💳 Payment Info'],['documents','📄 Documents']].map(([sec,label])=>(
            <button key={sec} onClick={()=>setActiveSection(sec)} style={{padding:'9px 18px',borderRadius:'8px',border:`1px solid ${activeSection===sec?'#F5A623':'#272B33'}`,background:activeSection===sec?'rgba(245,166,35,0.1)':'transparent',color:activeSection===sec?'#F5A623':'#606670',cursor:'pointer',fontWeight:'700',fontSize:'12px',textTransform:'uppercase',letterSpacing:'0.05em'}}>
              {label}
            </button>
          ))}
        </div>

        {activeSection==='profile'&&(
          <div style={{background:'#111316',border:'1px solid #272B33',borderRadius:'14px',padding:'22px'}}>
            <h2 style={{fontWeight:'800',fontSize:'18px',marginBottom:'18px'}}>Personal Information</h2>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px',marginBottom:'14px'}}>
              <div><label style={lbl}>First Name</label><input style={inp} value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})} placeholder="Mike"/></div>
              <div><label style={lbl}>Last Name</label><input style={inp} value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})} placeholder="Johnson"/></div>
            </div>
            <div style={{marginBottom:'14px'}}><label style={lbl}>Company Name</label><input style={inp} value={form.companyName} onChange={e=>setForm({...form,companyName:e.target.value})} placeholder="Johnson Hauling LLC"/></div>
            <div style={{marginBottom:'20px'}}><label style={lbl}>Phone Number</label><input style={inp} type="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+12145550100"/></div>
            <div style={{background:'#1C1F24',border:'1px solid #272B33',borderRadius:'10px',padding:'14px',marginBottom:'20px'}}>
              <div style={{fontSize:'12px',color:'#606670',marginBottom:'8px'}}>Account Status</div>
              <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
                <span style={{background:'rgba(245,166,35,0.12)',color:'#F5A623',border:'1px solid rgba(245,166,35,0.3)',padding:'4px 12px',borderRadius:'6px',fontSize:'11px',fontWeight:'800'}}>{profile?.tiers?.name||'Trial'} Plan</span>
                <span style={{background:'rgba(39,174,96,0.12)',color:'#27AE60',border:'1px solid rgba(39,174,96,0.3)',padding:'4px 12px',borderRadius:'6px',fontSize:'11px',fontWeight:'800'}}>GPS {profile?.gps_score||100}%</span>
                {profile?.rating&&<span style={{background:'rgba(59,138,232,0.12)',color:'#3A8AE8',border:'1px solid rgba(59,138,232,0.3)',padding:'4px 12px',borderRadius:'6px',fontSize:'11px',fontWeight:'800'}}>★ {profile.rating}</span>}
              </div>
            </div>
            <button onClick={saveProfile} disabled={saving} style={{width:'100%',background:'#F5A623',color:'#111',border:'none',padding:'13px',borderRadius:'10px',fontWeight:'800',fontSize:'15px',cursor:saving?'not-allowed':'pointer',opacity:saving?0.7:1}}>
              {saving?'Saving...':'Save Profile'}
            </button>
          </div>
        )}

        {activeSection==='truck'&&(
          <div style={{background:'#111316',border:'1px solid #272B33',borderRadius:'14px',padding:'22px'}}>
            <h2 style={{fontWeight:'800',fontSize:'18px',marginBottom:'18px'}}>Truck Information</h2>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px',marginBottom:'20px'}}>
              <div>
                <label style={lbl}>Primary Truck Type</label>
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
                <label style={lbl}>Number of Trucks</label>
                <input style={inp} type="number" min="1" max="100" value={form.truckCount} onChange={e=>setForm({...form,truckCount:e.target.value})}/>
              </div>
            </div>
            <div style={{background:'rgba(245,166,35,0.07)',border:'1px solid rgba(245,166,35,0.18)',borderRadius:'9px',padding:'12px',fontSize:'12px',color:'#606670',marginBottom:'20px'}}>
              💡 Having more trucks means more jobs you can claim. Keep this updated so dispatchers know your capacity.
            </div>
            <button onClick={saveProfile} disabled={saving} style={{width:'100%',background:'#F5A623',color:'#111',border:'none',padding:'13px',borderRadius:'10px',fontWeight:'800',fontSize:'15px',cursor:saving?'not-allowed':'pointer',opacity:saving?0.7:1}}>
              {saving?'Saving...':'Save Truck Info'}
            </button>
          </div>
        )}

        {activeSection==='payment'&&(
          <div style={{background:'#111316',border:'1px solid #272B33',borderRadius:'14px',padding:'22px'}}>
            <h2 style={{fontWeight:'800',fontSize:'18px',marginBottom:'4px'}}>Payment Information</h2>
            <p style={{color:'#606670',fontSize:'12px',marginBottom:'20px'}}>Your banking info is encrypted and used only to send your payments. We never share it.</p>
            <div style={{marginBottom:'16px'}}>
              <label style={lbl}>Payment Method</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginTop:'8px'}}>
                {[['ach','🏦 ACH Transfer','1-2 business days'],['wire','⚡ Wire Transfer','Same day']].map(([val,label,desc])=>(
                  <div key={val} onClick={()=>setForm({...form,paymentMethod:val})} style={{background:form.paymentMethod===val?'rgba(245,166,35,0.1)':'#1C1F24',border:`2px solid ${form.paymentMethod===val?'#F5A623':'#272B33'}`,borderRadius:'10px',padding:'14px',cursor:'pointer'}}>
                    <div style={{fontWeight:'700',fontSize:'14px',marginBottom:'3px'}}>{label}</div>
                    <div style={{fontSize:'11px',color:'#606670'}}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{marginBottom:'14px'}}><label style={lbl}>Account Holder Name</label><input style={inp} value={form.accountHolderName} onChange={e=>setForm({...form,accountHolderName:e.target.value})} placeholder="Mike Johnson or Johnson Hauling LLC"/></div>
            <div style={{marginBottom:'14px'}}><label style={lbl}>Bank Name</label><input style={inp} value={form.bankName} onChange={e=>setForm({...form,bankName:e.target.value})} placeholder="Chase, Wells Fargo, Bank of America..."/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px',marginBottom:'14px'}}>
              <div><label style={lbl}>Routing Number</label><input style={inp} value={form.routingNumber} onChange={e=>setForm({...form,routingNumber:e.target.value})} placeholder="9 digits"/></div>
              <div><label style={lbl}>Account Number</label><input style={inp} value={form.accountNumber} onChange={e=>setForm({...form,accountNumber:e.target.value})} placeholder="Your account number"/></div>
            </div>
            <div style={{marginBottom:'20px'}}>
              <label style={lbl}>Account Type</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginTop:'8px'}}>
                {[['checking','Checking'],['savings','Savings']].map(([val,label])=>(
                  <div key={val} onClick={()=>setForm({...form,accountType:val})} style={{background:form.accountType===val?'rgba(39,174,96,0.1)':'#1C1F24',border:`2px solid ${form.accountType===val?'#27AE60':'#272B33'}`,borderRadius:'9px',padding:'12px',cursor:'pointer',textAlign:'center',fontWeight:'700',fontSize:'14px',color:form.accountType===val?'#27AE60':'#606670'}}>
                    {label}
                  </div>
                ))}
              </div>
            </div>
            <div style={{background:'rgba(231,76,60,0.07)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:'9px',padding:'12px',fontSize:'12px',color:'#606670',marginBottom:'20px'}}>
              🔒 Your banking information is encrypted and stored securely. It is never visible to other drivers or shared with third parties.
            </div>
            <button onClick={saveProfile} disabled={saving} style={{width:'100%',background:'#F5A623',color:'#111',border:'none',padding:'13px',borderRadius:'10px',fontWeight:'800',fontSize:'15px',cursor:saving?'not-allowed':'pointer',opacity:saving?0.7:1}}>
              {saving?'Saving...':'Save Payment Info'}
            </button>
          </div>
        )}

        {activeSection==='documents'&&(
          <div style={{background:'#111316',border:'1px solid #272B33',borderRadius:'14px',padding:'22px'}}>
            <h2 style={{fontWeight:'800',fontSize:'18px',marginBottom:'4px'}}>Documents</h2>
            <p style={{color:'#606670',fontSize:'12px',marginBottom:'20px'}}>Upload your W9 and other required documents to get paid faster.</p>
            <input ref={w9Ref} type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={uploadW9} style={{display:'none'}}/>
            <div style={{marginBottom:'20px'}}>
              <div style={{fontWeight:'700',fontSize:'15px',marginBottom:'4px'}}>W9 Tax Form</div>
              <div style={{fontSize:'12px',color:'#606670',marginBottom:'12px'}}>Required for payment processing. Download a blank W9 at irs.gov/pub/irs-pdf/fw9.pdf, fill it out, and upload it here.</div>
              {form.w9Url?(
                <div style={{background:'rgba(39,174,96,0.08)',border:'1px solid rgba(39,174,96,0.25)',borderRadius:'10px',padding:'14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:'700',color:'#27AE60',marginBottom:'3px'}}>✅ W9 on file</div>
                    <div style={{fontSize:'11px',color:'#606670'}}>Uploaded and verified</div>
                  </div>
                  <div style={{display:'flex',gap:'8px'}}>
                    <a href={form.w9Url} target="_blank" rel="noopener noreferrer" style={{background:'rgba(59,138,232,0.12)',color:'#3A8AE8',border:'1px solid rgba(59,138,232,0.3)',padding:'8px 14px',borderRadius:'7px',textDecoration:'none',fontSize:'12px',fontWeight:'700'}}>View</a>
                    <button onClick={()=>w9Ref.current?.click()} style={{background:'rgba(245,166,35,0.12)',color:'#F5A623',border:'1px solid rgba(245,166,35,0.3)',padding:'8px 14px',borderRadius:'7px',fontSize:'12px',fontWeight:'700',cursor:'pointer'}}>Replace</button>
                  </div>
                </div>
              ):(
                <div onClick={()=>w9Ref.current?.click()} style={{border:'2px dashed #272B33',borderRadius:'10px',padding:'30px',textAlign:'center',cursor:'pointer',background:'#1C1F24'}}>
                  {uploadingW9?(
                    <div style={{color:'#606670',fontSize:'14px'}}>Uploading...</div>
                  ):(
                    <div>
                      <div style={{fontSize:'36px',marginBottom:'10px'}}>📄</div>
                      <div style={{fontWeight:'700',fontSize:'15px',marginBottom:'5px'}}>Upload your W9</div>
                      <div style={{fontSize:'12px',color:'#606670'}}>PDF, JPG, or PNG — max 10MB</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{background:'rgba(245,166,35,0.07)',border:'1px solid rgba(245,166,35,0.18)',borderRadius:'9px',padding:'14px'}}>
              <div style={{fontWeight:'700',fontSize:'13px',marginBottom:'8px',color:'#F5A623'}}>📋 Payment Requirements Checklist</div>
              {[
                [!!form.routingNumber&&!!form.accountNumber,'Banking info on file'],
                [!!form.w9Url,'W9 uploaded'],
                [!!form.phone,'Phone number verified'],
                [!!form.companyName||!!form.firstName,'Profile complete']
              ].map(([done,label])=>(
                <div key={label as string} style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px',fontSize:'13px'}}>
                  <span style={{color:done?'#27AE60':'#606670',fontSize:'16px'}}>{done?'✅':'⬜'}</span>
                  <span style={{color:done?'#E8E3DC':'#606670'}}>{label as string}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
