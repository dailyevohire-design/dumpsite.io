'use client'
import { useState, useEffect, Suspense } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'

function ResetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Supabase automatically picks up the recovery token from the URL hash
    // when the page loads — we just need to wait for the session
    const supabase = createBrowserSupabase()
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true)
      }
    })
    // Also check if already in recovery state
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSessionReady(true)
    })
  }, [])

  async function handleReset(e: any) {
    e.preventDefault()
    setError('')

    if (!password || !confirm) {
      setError('Please fill in both fields')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (!/\d/.test(password)) {
      setError('Password must contain at least one number')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const supabase = createBrowserSupabase()
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
      } else {
        setSuccess(true)
      }
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  const inp = { background: '#1C1F24', border: '1px solid #272B33', color: '#E8E3DC', padding: '12px 14px', borderRadius: '9px', fontSize: '14px', width: '100%', outline: 'none', marginTop: '5px' }
  const lbl = { fontSize: '11px', fontWeight: '700' as const, letterSpacing: '0.07em', textTransform: 'uppercase' as const, color: '#606670' }

  if (success) {
    return (
      <div style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>&#10003;</div>
        <h2 style={{ color: '#27AE60', fontWeight: '800', fontSize: '24px', marginBottom: '8px' }}>Password Updated</h2>
        <p style={{ color: '#606670', fontSize: '14px', marginBottom: '24px' }}>
          Your password has been reset. You can now sign in.
        </p>
        <a href="/login" style={{ background: '#F5A623', color: '#111', padding: '13px 28px', borderRadius: '9px', textDecoration: 'none', fontWeight: '800', fontSize: '15px' }}>
          Go to Sign In
        </a>
      </div>
    )
  }

  if (!sessionReady) {
    return (
      <div style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
        <div style={{ fontFamily: 'Georgia,serif', fontSize: '22px', fontWeight: '700', letterSpacing: '0.02em', color: '#F0EDE8', marginBottom: '24px' }}>
          DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span>
        </div>
        <p style={{ color: '#606670', fontSize: '14px', marginBottom: '16px' }}>
          Verifying your reset link...
        </p>
        <p style={{ color: '#606670', fontSize: '12px' }}>
          If this takes too long, your link may have expired.{' '}
          <a href="/login" style={{ color: '#F5A623' }}>Request a new one</a>
        </p>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', maxWidth: '400px' }}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <div style={{ fontFamily: 'Georgia,serif', fontSize: '22px', fontWeight: '700', letterSpacing: '0.02em', color: '#F0EDE8', marginBottom: '12px' }}>
          DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span>
        </div>
        <h1 style={{ fontWeight: '900', fontSize: '28px', marginBottom: '4px' }}>Reset Password</h1>
        <p style={{ color: '#606670', fontSize: '13px' }}>Enter your new password below</p>
      </div>

      {error && (
        <div style={{ background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#E74C3C', fontSize: '13px', fontWeight: '600' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleReset} style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '12px', padding: '24px' }}>
        <div style={{ marginBottom: '14px' }}>
          <label style={lbl}>New Password</label>
          <input style={inp} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters + 1 number" autoComplete="new-password" />
        </div>
        <div style={{ marginBottom: '20px' }}>
          <label style={lbl}>Confirm Password</label>
          <input style={inp} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Re-enter your password" autoComplete="new-password" />
        </div>
        <button type="submit" disabled={loading} style={{ width: '100%', background: '#F5A623', color: '#111', border: 'none', padding: '13px', borderRadius: '9px', fontWeight: '800', fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {loading ? 'Updating...' : 'Reset Password'}
        </button>
      </form>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', color: '#E8E3DC', fontFamily: 'system-ui,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <Suspense fallback={<div style={{ color: '#606670' }}>Loading...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}
