'use client'
import { useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'

export default function SignupPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', company: '', phone: '', email: '', password: '', truckCount: '1', truckType: 'tandem_axle' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function submit(e: any) {
    e.preventDefault()
    setError('')
    if (!form.firstName || !form.lastName || !form.phone || !form.email || !form.password) {
      setError('Please fill in all required fields')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    let phone = form.phone.replace(/\D/g, '')
    if (phone.length === 10) phone = '1' + phone
    if (!phone.startsWith('+')) phone = '+' + phone

    setLoading(true)
    try {
      const supabase = createBrowserSupabase()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: { first_name: form.firstName, last_name: form.lastName, role: 'driver' }
        }
      })
      if (signUpError) { setError(signUpError.message); setLoading(false); return }
      if (data.user) {
        const tierId = (await supabase.from('tiers').select('id').eq('slug','trial').single()).data?.id
        const { error: profileError } = await supabase.from('driver_profiles').insert({
          user_id: data.user.id,
          first_name: form.firstName,
          last_name: form.lastName,
          company_name: form.company,
          phone: phone,
          phone_verified: false,
          truck_count: parseInt(form.truckCount),
          truck_type: form.truckType,
          tier_id: tierId
        })
        if (profileError) console.error('Profile error:', profileError)
      }
      setSuccess(true)
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    }
    setLoading(false)
  }

  const inp = { background: '#1C1F24', border: '1px solid #272B33', color: '#E8E3DC', padding: '11px 14px', borderRadius: '9px', fontSize: '14px', width: '100%', outline: 'none', marginTop: '5px' }
  const lbl = { fontSize: '11px', fontWeight: '700' as const, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: '#606670' }

  if (success) return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: '400px', padding: '20px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
        <h2 style={{ color: '#27AE60', fontWeight: '800', fontSize: '24px', marginBottom: '8px' }}>Account Created!</h2>
        <p style={{ color: '#606670', fontSize: '14px', lineHeight: '1.6', marginBottom: '20px' }}>Check your email and click the verification link before signing in.</p>
        <a href="/login" style={{ background: '#F5A623', color: '#111', padding: '12px 24px', borderRadius: '9px', textDecoration: 'none', fontWeight: '800', fontSize: '14px' }}>Sign In Now</a>
      </div>
    </div>
  )

  return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', color: '#E8E3DC', fontFamily: 'system-ui,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{textAlign:'center',marginBottom:'12px'}}><span style={{fontFamily:'Georgia,serif',fontSize:'22px',fontWeight:'700',color:'#F0EDE8'}}>DUMPSITE<span style={{color:'#F5A623'}}>.IO</span></span></div>
          <h1 style={{ fontWeight: '900', fontSize: '28px', marginBottom: '4px' }}>Create Driver Account</h1>
          <p style={{ color: '#606670', fontSize: '13px' }}>Free 30-day trial — no credit card required</p>
        </div>
        {error && <div style={{ background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#E74C3C', fontSize: '13px', fontWeight: '600' }}>{error}</div>}
        <form onSubmit={submit} style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '12px', padding: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div><label style={lbl}>First Name *</label><input style={inp} value={form.firstName} onChange={e => setForm({...form, firstName: e.target.value})} placeholder="Mike" /></div>
            <div><label style={lbl}>Last Name *</label><input style={inp} value={form.lastName} onChange={e => setForm({...form, lastName: e.target.value})} placeholder="Johnson" /></div>
          </div>
          <div style={{ marginBottom: '12px' }}><label style={lbl}>Company Name</label><input style={inp} value={form.company} onChange={e => setForm({...form, company: e.target.value})} placeholder="Johnson Hauling LLC" /></div>
          <div style={{ marginBottom: '12px' }}><label style={lbl}>Phone Number *</label><input style={inp} type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="(214) 555-0100" /></div>
          <div style={{ marginBottom: '12px' }}><label style={lbl}>Email *</label><input style={inp} type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="mike@hauling.com" /></div>
          <div style={{ marginBottom: '12px' }}><label style={lbl}>Password *</label><input style={inp} type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="At least 8 characters" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            <div><label style={lbl}>Number of Trucks</label><input style={inp} type="number" min="1" value={form.truckCount} onChange={e => setForm({...form, truckCount: e.target.value})} /></div>
            <div>
              <label style={lbl}>Primary Truck Type</label>
              <select style={inp} value={form.truckType} onChange={e => setForm({...form, truckType: e.target.value})}>
                <option value="tandem_axle">Tandem Axle</option>
                <option value="end_dump">End Dump</option>
                <option value="tri_axle">Tri-Axle</option>
                <option value="super_dump">Super Dump</option>
                <option value="semi_transfer">Semi Transfer</option>
                <option value="bottom_dump">Bottom Dump</option>
              </select>
            </div>
          </div>
          <button type="submit" disabled={loading} style={{ width: '100%', background: '#F5A623', color: '#111', border: 'none', padding: '13px', borderRadius: '9px', fontWeight: '800', fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {loading ? 'Creating Account...' : 'Create Free Account'}
          </button>
          <p style={{ textAlign: 'center', marginTop: '14px', fontSize: '12px', color: '#606670' }}>
            Already have an account? <a href="/login" style={{ color: '#F5A623', textDecoration: 'none', fontWeight: '700' }}>Sign in</a>
          </p>
        </form>
      </div>
    </div>
  )
}
