'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

const PLANS = [
  { slug: 'pickup', name: 'Pickup', price: '$99/mo', desc: 'Up to 50 yards/month' },
  { slug: 'tandem', name: 'Tandem', price: '$299/mo', desc: 'Up to 300 yards/month' },
  { slug: 'fleet', name: 'Fleet', price: '$599/mo', desc: 'Unlimited yards/month' },
]

const YARD_OPTIONS = ['0–50', '50–300', '300–1,000', '1,000–5,000', '5,000+']

export default function MembershipSignupPage() {
  const searchParams = useSearchParams()
  const paramPlan = searchParams.get('plan') || ''
  const isPaymentSuccess = searchParams.get('success') === 'true'

  const [form, setForm] = useState({
    fullName: '',
    companyName: '',
    phone: '',
    email: '',
    plan: '',
    monthlyYards: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (['pickup', 'tandem', 'fleet'].includes(paramPlan)) {
      setForm(f => ({ ...f, plan: paramPlan }))
    }
  }, [paramPlan])

  const formatPhone = (val: string) => {
    let v = val.replace(/\D/g, '')
    if (v.length > 10) v = v.slice(0, 10)
    if (v.length >= 6) return `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}`
    if (v.length >= 3) return `(${v.slice(0, 3)}) ${v.slice(3)}`
    return v
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!form.fullName.trim()) return setError('Full name is required')
    if (!form.phone.replace(/\D/g, '') || form.phone.replace(/\D/g, '').length < 10) return setError('Valid phone number is required')
    if (!form.email.trim() || !form.email.includes('@')) return setError('Valid email is required')
    if (!form.plan) return setError('Please select a plan')

    setLoading(true)
    try {
      const res = await fetch('/api/membership-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          companyName: form.companyName.trim(),
          phone: form.phone.replace(/\D/g, ''),
          email: form.email.trim().toLowerCase(),
          plan: form.plan,
          monthlyYards: form.monthlyYards,
        }),
      })

      const data = await res.json()
      if (!data.success) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }

      if (data.data?.checkoutUrl) {
        window.location.href = data.data.checkoutUrl
        return
      }

      setSuccess(true)
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  const selectedPlan = PLANS.find(p => p.slug === form.plan)

  if (isPaymentSuccess) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.successIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#68c06c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <h1 style={styles.successTitle}>Payment Confirmed</h1>
          <p style={styles.successText}>Welcome to DumpSite. Your membership is active and your dispatcher is being assigned. Expect a text within the hour.</p>
          <a href="/" style={styles.backLink}>&larr; Back to DumpSite.io</a>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.successIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#68c06c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <h1 style={styles.successTitle}>You're in.</h1>
          <p style={styles.successText}>
            Your dispatcher will reach out within 1 business day at <strong style={{ color: '#e4a41d' }}>{form.phone}</strong> to get you set up on the {selectedPlan?.name} plan.
          </p>
          <p style={{ ...styles.successText, fontSize: '13px', color: '#746859', marginTop: '12px' }}>
            No payment due until your first dump site is matched.
          </p>
          <a href="/" style={styles.backLink}>&larr; Back to DumpSite.io</a>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <a href="/" style={styles.logo}>DUMP<span style={{ color: '#e4a41d' }}>SITE</span>.IO</a>
        <h1 style={styles.title}>Start your membership</h1>
        <p style={styles.subtitle}>Your dedicated dirt dispatcher is one form away. No commitment until we match your first site.</p>

        {selectedPlan && (
          <div style={styles.planBadge}>
            <div style={styles.planBadgeName}>{selectedPlan.name}</div>
            <div style={styles.planBadgePrice}>{selectedPlan.price}</div>
            <div style={styles.planBadgeDesc}>{selectedPlan.desc}</div>
            <a href="/#membership" style={styles.changePlan}>Change plan</a>
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.row}>
            <label style={styles.label}>Full Name *</label>
            <input
              style={styles.input}
              type="text"
              value={form.fullName}
              onChange={e => setForm({ ...form, fullName: e.target.value })}
              placeholder="John Smith"
              autoComplete="name"
            />
          </div>

          <div style={styles.row}>
            <label style={styles.label}>Company Name</label>
            <input
              style={styles.input}
              type="text"
              value={form.companyName}
              onChange={e => setForm({ ...form, companyName: e.target.value })}
              placeholder="Smith Excavation LLC"
              autoComplete="organization"
            />
          </div>

          <div style={styles.rowHalf}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Phone *</label>
              <input
                style={styles.input}
                type="tel"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: formatPhone(e.target.value) })}
                placeholder="(469) 555-0123"
                autoComplete="tel"
                maxLength={14}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Email *</label>
              <input
                style={styles.input}
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="john@company.com"
                autoComplete="email"
              />
            </div>
          </div>

          {!selectedPlan && (
            <div style={styles.row}>
              <label style={styles.label}>Plan *</label>
              <select
                style={styles.select}
                value={form.plan}
                onChange={e => setForm({ ...form, plan: e.target.value })}
              >
                <option value="">Select a plan</option>
                {PLANS.map(p => (
                  <option key={p.slug} value={p.slug}>{p.name} — {p.price} ({p.desc})</option>
                ))}
              </select>
            </div>
          )}

          <div style={styles.row}>
            <label style={styles.label}>Estimated Monthly Cubic Yards</label>
            <select
              style={styles.select}
              value={form.monthlyYards}
              onChange={e => setForm({ ...form, monthlyYards: e.target.value })}
            >
              <option value="">Select an estimate</option>
              {YARD_OPTIONS.map(o => (
                <option key={o} value={o}>{o} yards/month</option>
              ))}
            </select>
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" style={styles.btn} disabled={loading}>
            {loading ? 'Submitting...' : 'Get Started →'}
          </button>

          <p style={styles.fine}>
            Your dispatcher will reach out to finalize setup. No payment collected until your first site is matched. Questions? Call <a href="tel:+14697174225" style={{ color: '#e4a41d' }}>(469) 717-4225</a>.
          </p>
        </form>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#111010',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    fontFamily: "'Instrument Sans', -apple-system, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '480px',
    background: '#1c1a18',
    border: '1px solid rgba(255,255,255,.06)',
    borderRadius: '20px',
    padding: '40px 32px',
  },
  logo: {
    display: 'block',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '15px',
    fontWeight: 700,
    color: '#fff',
    textDecoration: 'none',
    marginBottom: '24px',
    letterSpacing: '-0.3px',
  },
  title: {
    fontFamily: "'DM Serif Display', Georgia, serif",
    fontSize: '28px',
    color: '#fff',
    lineHeight: 1.15,
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '14px',
    color: '#968877',
    lineHeight: 1.6,
    marginBottom: '28px',
  },
  planBadge: {
    background: 'rgba(228,164,29,.06)',
    border: '1px solid rgba(228,164,29,.2)',
    borderRadius: '14px',
    padding: '16px 20px',
    marginBottom: '28px',
    textAlign: 'center' as const,
    position: 'relative' as const,
  },
  planBadgeName: {
    fontFamily: "'DM Serif Display', Georgia, serif",
    fontSize: '20px',
    color: '#fff',
  },
  planBadgePrice: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '24px',
    fontWeight: 700,
    color: '#e4a41d',
    margin: '4px 0',
  },
  planBadgeDesc: {
    fontSize: '12px',
    color: '#968877',
  },
  changePlan: {
    fontSize: '11px',
    color: '#b5a594',
    textDecoration: 'underline',
    position: 'absolute' as const,
    top: '12px',
    right: '16px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0px',
  },
  row: {
    marginBottom: '16px',
  },
  rowHalf: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '11px',
    fontWeight: 600,
    color: '#968877',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.8px',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '13px 14px',
    background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.08)',
    borderRadius: '10px',
    fontFamily: "'Instrument Sans', sans-serif",
    fontSize: '15px',
    color: '#fff',
    outline: 'none',
  },
  select: {
    width: '100%',
    padding: '13px 14px',
    background: '#262320',
    border: '1px solid rgba(255,255,255,.08)',
    borderRadius: '10px',
    fontFamily: "'Instrument Sans', sans-serif",
    fontSize: '15px',
    color: '#fff',
    outline: 'none',
    appearance: 'auto' as const,
  },
  error: {
    background: 'rgba(191,57,43,.1)',
    border: '1px solid rgba(191,57,43,.25)',
    borderRadius: '10px',
    padding: '12px 16px',
    fontSize: '13px',
    color: '#e74c3c',
    marginBottom: '16px',
  },
  btn: {
    width: '100%',
    padding: '15px',
    background: '#e4a41d',
    color: '#111010',
    border: 'none',
    borderRadius: '10px',
    fontFamily: "'Instrument Sans', sans-serif",
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: '4px',
  },
  fine: {
    fontSize: '11px',
    color: '#746859',
    textAlign: 'center' as const,
    lineHeight: 1.5,
    marginTop: '16px',
  },
  successIcon: {
    textAlign: 'center' as const,
    marginBottom: '20px',
  },
  successTitle: {
    fontFamily: "'DM Serif Display', Georgia, serif",
    fontSize: '28px',
    color: '#fff',
    textAlign: 'center' as const,
    marginBottom: '12px',
  },
  successText: {
    fontSize: '15px',
    color: '#b5a594',
    textAlign: 'center' as const,
    lineHeight: 1.65,
  },
  backLink: {
    display: 'block',
    textAlign: 'center' as const,
    marginTop: '28px',
    fontSize: '13px',
    color: '#e4a41d',
    textDecoration: 'none',
  },
}
