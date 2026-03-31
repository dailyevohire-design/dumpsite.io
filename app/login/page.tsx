'use client'
import { useState, Suspense } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { trackEvent } from '@/lib/posthog'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [resetting, setResetting] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionExpired = searchParams.get('reason') === 'session_expired'

  async function submit(e: any) {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Please enter your email and password'); return }
    setLoading(true)
    try {
      const supabase = createBrowserSupabase()
      const { data, error: loginError } = await supabase.auth.signInWithPassword({ email, password })
      if (loginError) { setError('Invalid email or password'); setLoading(false); return }
      if (data.user) {
        trackEvent('login_completed')
        const role = data.user.user_metadata?.role
        if (role === 'admin' || role === 'superadmin') {
          router.push('/admin')
        } else {
          router.push('/map')
        }
      }
    } catch { setError('Something went wrong. Please try again.'); trackEvent('login_failed') }
    setLoading(false)
  }

  async function forgotPassword() {
    if (!email) { setError('Enter your email above, then click Forgot Password'); return }
    setResetting(true)
    setError('')
    try {
      const supabase = createBrowserSupabase()
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      setResetSent(true)
    } catch { setError('Failed to send reset email. Try again.') }
    setResetting(false)
  }

  const inp = { background: '#1C1F24', border: '1px solid #272B33', color: '#E8E3DC', padding: '12px 14px', borderRadius: '9px', fontSize: '14px', width: '100%', outline: 'none', marginTop: '5px' }
  const lbl = { fontSize: '11px', fontWeight: '700' as const, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: '#606670' }

  return (
    <div style={{ width: '100%', maxWidth: '400px' }}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <a href="/" style={{ textDecoration: 'none' }}>
          <div style={{textAlign:'center',marginBottom:'12px'}}><span style={{fontFamily:'Georgia,serif',fontSize:'22px',fontWeight:'700',letterSpacing:'0.02em',color:'#F0EDE8'}}>DUMPSITE<span style={{color:'#F5A623'}}>.IO</span></span></div>
        </a>
        <h1 style={{ fontWeight: '900', fontSize: '28px', marginBottom: '4px' }}>Welcome Back</h1>
        <p style={{ color: '#606670', fontSize: '13px' }}>Sign in to your DumpSite.io account</p>
      </div>

      {sessionExpired && (
        <div style={{ background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#F5A623', fontSize: '13px', fontWeight: '600' }}>
          Your admin session expired for security. Please sign in again.
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#E74C3C', fontSize: '13px', fontWeight: '600' }}>
          {error}
        </div>
      )}

      {resetSent && (
        <div style={{ background: 'rgba(39,174,96,0.12)', border: '1px solid rgba(39,174,96,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#27AE60', fontSize: '13px', fontWeight: '600' }}>
          Check your email for a reset link
        </div>
      )}

      <form onSubmit={submit} style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '12px', padding: '24px' }}>
        <div style={{ marginBottom: '14px' }}>
          <label style={lbl}>Email</label>
          <input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="mike@hauling.com" autoComplete="email" />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={lbl}>Password</label>
          <input style={inp} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        </div>
        <div style={{ textAlign: 'right', marginBottom: '16px' }}>
          <button type="button" onClick={forgotPassword} disabled={resetting} style={{ background: 'none', border: 'none', color: '#F5A623', cursor: 'pointer', fontSize: '12px', fontWeight: '700', padding: 0 }}>
            {resetting ? 'Sending...' : 'Forgot Password?'}
          </button>
        </div>
        <button type="submit" disabled={loading} style={{ width: '100%', background: '#F5A623', color: '#111', border: 'none', padding: '13px', borderRadius: '9px', fontWeight: '800', fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {loading ? 'Signing In...' : 'Sign In'}
        </button>
        <p style={{ textAlign: 'center', marginTop: '14px', fontSize: '12px', color: '#606670' }}>
          No account yet? <a href="/signup" style={{ color: '#F5A623', textDecoration: 'none', fontWeight: '700' }}>Sign up free</a>
        </p>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', color: '#E8E3DC', fontFamily: 'system-ui,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <Suspense fallback={<div style={{ color: '#606670' }}>Loading...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
