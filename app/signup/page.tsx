'use client'
import { useState, useEffect } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/posthog'

export default function SignupPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', company: '', phone: '', email: '', password: '', truckCount: '1', truckType: 'tandem_axle', userType: '', monthlyYardage: '', referralCode: '', city: '' })
  const [cities, setCities] = useState<any[]>([])

  useEffect(() => {
    createBrowserSupabase().from('cities').select('id, name').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setCities(data)
    })
  }, [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)

  useEffect(() => { trackEvent('signup_started') }, [])

  // Check for pending job on mount
  useEffect(() => {
    try {
      const jobId = sessionStorage.getItem('pendingJobId')
      if (jobId) setPendingJobId(jobId)
    } catch {}
  }, [])

  function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 10) return '+1' + digits
    if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
    if (raw.startsWith('+')) return raw
    return '+1' + digits
  }

  async function submit(e: any) {
    e.preventDefault()
    setError('')
    if (!form.firstName || !form.lastName || !form.phone || !form.email || !form.password || !form.userType || !form.monthlyYardage || !form.city) {
      setError('Please fill in all required fields')
      return
    }
    const phoneDigits = form.phone.replace(/\D/g, '')
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      setError('Please enter a valid 10-digit phone number')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (!/\d/.test(form.password)) {
      setError('Password must contain at least one number')
      return
    }

    setLoading(true)
    try {
      const supabase = createBrowserSupabase()
      const normalizedPhone = normalizePhone(form.phone)

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: { first_name: form.firstName, last_name: form.lastName, role: 'driver', user_type: form.userType, monthly_yardage: form.monthlyYardage }
        }
      })

      if (signUpError) { setError(signUpError.message); setLoading(false); return }

      if (data.user) {
        // Create profile via server API (bypasses RLS)
        try {
          await fetch('/api/driver/create-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: data.user.id,
              firstName: form.firstName,
              lastName: form.lastName,
              company: form.company,
              phone: normalizedPhone,
              truckCount: form.truckCount,
              truckType: form.truckType,
              cityId: form.city,
            })
          })
        } catch {
          // Don't block signup if profile fails — auth was created
        }

        // Handle referral code if provided
        if (form.referralCode.trim() && data.user) {
          try {
            const supabase = createBrowserSupabase()
            const { data: referrer } = await supabase.from('driver_profiles').select('user_id').eq('referral_code', form.referralCode.trim().toUpperCase()).maybeSingle()
            if (referrer) {
              await fetch('/api/driver/create-referral', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ referrerId: referrer.user_id, referredId: data.user.id, referralCode: form.referralCode.trim().toUpperCase() })
              })
            }
          } catch {}
        }
      }

      // Clean up pending job from sessionStorage — it's saved in pendingJobId state
      try { sessionStorage.removeItem('pendingJobId') } catch {}

      setSuccess(true)
      trackEvent('signup_completed', { truckType: form.truckType, truckCount: form.truckCount, pendingJobId })
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
      trackEvent('signup_failed', { error: err.message })
    }
    setLoading(false)
  }

  const inp = { background: '#1C1F24', border: '1px solid #272B33', color: '#E8E3DC', padding: '11px 14px', borderRadius: '9px', fontSize: '14px', width: '100%', outline: 'none', marginTop: '5px' }
  const lbl = { fontSize: '11px', fontWeight: '700' as const, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: '#606670' }

  if (success) return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: '400px', padding: '20px' }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>&#x2705;</div>
        <h2 style={{ color: '#27AE60', fontWeight: '800', fontSize: '26px', marginBottom: '8px' }}>You&apos;re In!</h2>
        <p style={{ color: '#606670', fontSize: '14px', lineHeight: '1.6', marginBottom: '8px' }}>
          Check your email and click the verification link to activate your account.
        </p>
        {pendingJobId && (
          <p style={{ color: '#27AE60', fontSize: '13px', fontWeight: '700', marginBottom: '8px' }}>
            Your job is saved — sign in after verifying to claim it.
          </p>
        )}
        <p style={{ color: '#F5A623', fontSize: '13px', fontWeight: '700', marginBottom: '24px' }}>
          &#x26A0;&#xFE0F; You must verify your email before signing in.
        </p>
        <a href={pendingJobId ? `/login?redirect=/dashboard&jobId=${pendingJobId}` : '/login'} style={{ background: '#F5A623', color: '#111', padding: '13px 28px', borderRadius: '9px', textDecoration: 'none', fontWeight: '800', fontSize: '15px' }}>
          Go to Sign In
        </a>
      </div>
    </div>
  )

  return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', color: '#E8E3DC', fontFamily: 'system-ui,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontFamily: 'Georgia,serif', fontSize: '22px', fontWeight: '700', letterSpacing: '0.02em', color: '#F0EDE8' }}>DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span></span>
          </div>
          <h1 style={{ fontWeight: '900', fontSize: '28px', marginBottom: '4px' }}>Create Driver Account</h1>
          <p style={{ color: '#606670', fontSize: '13px' }}>Free trial — no credit card required</p>
        </div>

        {pendingJobId && (
          <div style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', textAlign: 'center' }}>
            <div style={{ fontWeight: '800', color: '#F5A623', fontSize: '13px' }}>&#x1F69B; You have a job waiting — sign up to claim it</div>
          </div>
        )}

        <div style={{ background: 'rgba(39,174,96,0.08)', border: '1px solid rgba(39,174,96,0.2)', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', textAlign: 'center' }}>
          <div style={{ fontWeight: '800', color: '#27AE60', fontSize: '14px', marginBottom: '2px' }}>Stop paying to dump. Start getting paid to haul.</div>
          <div style={{ fontSize: '12px', color: '#606670' }}>Access active DFW dump sites paying $35–$55 per load</div>
        </div>

        {error && (
          <div style={{ background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#E74C3C', fontSize: '13px', fontWeight: '600' }}>
            {error}
          </div>
        )}

        <form onSubmit={submit} style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '12px', padding: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div><label style={lbl}>First Name *</label><input style={inp} value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} placeholder="Mike" /></div>
            <div><label style={lbl}>Last Name *</label><input style={inp} value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} placeholder="Johnson" /></div>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={lbl}>Company Name</label>
            <input style={inp} value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Johnson Hauling LLC" />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={lbl}>Phone Number * (for job SMS notifications)</label>
            <input style={inp} type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="(214) 555-0100" />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={lbl}>Your City * (where you haul)</label>
            <select style={inp} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}>
              <option value="">Select your city...</option>
              {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={lbl}>I am a... *</label>
            <select style={inp} value={form.userType} onChange={e => setForm({ ...form, userType: e.target.value })}>
              <option value="">Select your role...</option>
              <option value="driver">Driver</option>
              <option value="contractor">Contractor</option>
              <option value="excavator">Excavator</option>
              <option value="homeowner">Home Owner</option>
            </select>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={lbl}>Estimated Monthly Cubic Yardage *</label>
            <select style={inp} value={form.monthlyYardage} onChange={e => setForm({ ...form, monthlyYardage: e.target.value })}>
              <option value="">Select range...</option>
              <option value="0-100">0 – 100</option>
              <option value="100-500">100 – 500</option>
              <option value="500-1000">500 – 1,000</option>
              <option value="1000-5000">1,000 – 5,000</option>
              <option value="5000-10000">5,000 – 10,000</option>
              <option value="10000+">10,000+</option>
            </select>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={lbl}>Email *</label>
            <input style={inp} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="mike@hauling.com" />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={lbl}>Password *</label>
            <input style={inp} type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters + 1 number" />
            {form.password && (
              <div style={{ marginTop: '6px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                {[1,2,3].map(i => {
                  const strength = form.password.length >= 12 && /\d/.test(form.password) && /[A-Z]/.test(form.password) ? 3
                    : form.password.length >= 8 && /\d/.test(form.password) ? 2 : 1
                  return <div key={i} style={{ height: '4px', flex: 1, borderRadius: '2px', background: i <= strength ? (strength === 3 ? '#27AE60' : strength === 2 ? '#F5A623' : '#E74C3C') : '#272B33' }} />
                })}
                <span style={{ fontSize: '10px', marginLeft: '6px', color: form.password.length >= 12 && /\d/.test(form.password) && /[A-Z]/.test(form.password) ? '#27AE60' : form.password.length >= 8 && /\d/.test(form.password) ? '#F5A623' : '#E74C3C', fontWeight: '700' }}>
                  {form.password.length >= 12 && /\d/.test(form.password) && /[A-Z]/.test(form.password) ? 'Strong' : form.password.length >= 8 && /\d/.test(form.password) ? 'Medium' : 'Weak'}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            <div>
              <label style={lbl}>Number of Trucks</label>
              <input style={inp} type="number" min="1" max="50" value={form.truckCount} onChange={e => setForm({ ...form, truckCount: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>Primary Truck Type</label>
              <select style={inp} value={form.truckType} onChange={e => setForm({ ...form, truckType: e.target.value })}>
                <option value="tandem_axle">Tandem Axle</option>
                <option value="end_dump">End Dump</option>
                <option value="tri_axle">Tri-Axle</option>
                <option value="super_dump">Super Dump</option>
                <option value="semi_transfer">Semi Transfer</option>
                <option value="bottom_dump">Bottom Dump</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={lbl}>Referral Code (optional)</label>
            <input style={inp} value={form.referralCode} onChange={e => setForm({ ...form, referralCode: e.target.value.toUpperCase() })} placeholder="e.g. MIKE42" maxLength={8} />
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
