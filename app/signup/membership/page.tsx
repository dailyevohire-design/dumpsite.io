'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const PLANS: Record<string, {
  name: string; price: number; per: string; slug: string
  tagline: string; saves: string; features: string[]; highlight: string
}> = {
  pickup: {
    name: 'Pickup', price: 99, per: '/mo', slug: 'pickup',
    tagline: 'The one-truck crew. The dad-and-son. The small excavator getting it done.',
    saves: 'Avg. member saves $2,000+/mo vs. landfill',
    highlight: 'Your own dedicated dirt dispatcher',
    features: [
      'Up to 50 yards/month at free dump sites',
      'Full load tracking & documentation',
      'Access to DFW & Denver sites',
      'Standard response time',
    ],
  },
  tandem: {
    name: 'Tandem', price: 299, per: '/mo', slug: 'tandem',
    tagline: 'The working contractor. The excavation crew running 2–5 trucks every day.',
    saves: 'Avg. member saves $5,000–10,000+/mo',
    highlight: 'Your own dedicated dirt dispatcher',
    features: [
      'Up to 300 yards/month at free dump sites',
      'Priority site access & guaranteed availability',
      'Volume discounts on dirt delivery',
      'Monthly savings report',
      'Savings guarantee — money back + 1 month free',
    ],
  },
  fleet: {
    name: 'Fleet', price: 599, per: '/mo', slug: 'fleet',
    tagline: 'The boss. The GC running 10+ trucks. Thousands of yards every month.',
    saves: 'Members save $10,000–30,000+/mo',
    highlight: 'Your own dedicated dirt dispatcher',
    features: [
      'Unlimited yards/month at free dump sites',
      'Guaranteed site availability — always',
      'Fleet load tracking & reporting',
      'Best rates on dirt delivery & trucking',
      'Savings guarantee — money back + 1 month free',
      'Priority access to all new markets',
    ],
  },
}

const YARD_OPTIONS = ['0–50', '50–300', '300–1,000', '1,000–5,000', '5,000+']

const CSS = `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Instrument Sans',-apple-system,sans-serif;background:#111010;color:#fff;-webkit-font-smoothing:antialiased}
.ms-page{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px;position:relative;overflow:hidden}
.ms-page::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 50% 40% at 30% 20%,rgba(201,139,10,.06),transparent 50%),radial-gradient(ellipse 40% 50% at 80% 80%,rgba(83,73,62,.08),transparent 40%)}
.ms-wrap{position:relative;z-index:1;width:100%;max-width:960px;display:grid;grid-template-columns:1fr 440px;gap:0;background:#1c1a18;border:1px solid rgba(255,255,255,.06);border-radius:24px;overflow:hidden}
.ms-left{padding:48px 40px;display:flex;flex-direction:column;justify-content:center;border-right:1px solid rgba(255,255,255,.05)}
.ms-right{padding:44px 36px;background:#191714}
.ms-logo{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:-.3px;margin-bottom:32px;display:inline-block}
.ms-logo span{color:#e4a41d}
.ms-plan-label{font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#e4a41d;margin-bottom:10px;font-weight:500}
.ms-plan-name{font-family:'DM Serif Display',Georgia,serif;font-size:36px;color:#fff;line-height:1.1;margin-bottom:4px}
.ms-plan-price{display:flex;align-items:baseline;gap:4px;margin-bottom:6px}
.ms-plan-dollar{font-family:'JetBrains Mono',monospace;font-size:42px;font-weight:700;color:#e4a41d;line-height:1}
.ms-plan-per{font-size:14px;color:#968877}
.ms-plan-saves{font-size:12px;color:#68c06c;font-weight:600;margin-bottom:8px}
.ms-plan-tag{font-size:13px;color:#b5a594;line-height:1.6;margin-bottom:28px}
.ms-features{list-style:none;margin-bottom:32px}
.ms-features li{font-size:13px;color:#d1c5b6;padding:8px 0 8px 26px;position:relative;line-height:1.5;border-bottom:1px solid rgba(255,255,255,.03)}
.ms-features li:last-child{border-bottom:none}
.ms-features li::before{content:'✓';position:absolute;left:0;color:#68c06c;font-weight:700;font-size:13px}
.ms-features li.hl{color:#f2be42;font-weight:600}
.ms-features li.hl::before{color:#e4a41d}
.ms-guarantee{display:flex;align-items:center;gap:12px;background:rgba(72,168,76,.06);border:1px solid rgba(72,168,76,.15);border-radius:12px;padding:14px 18px}
.ms-guarantee svg{flex-shrink:0}
.ms-guar-text h4{font-size:13px;font-weight:700;color:#68c06c;margin-bottom:1px}
.ms-guar-text p{font-size:11px;color:#968877;line-height:1.4}
.ms-change{display:inline-block;margin-top:20px;font-size:12px;color:#968877;text-decoration:none;transition:color .2s}
.ms-change:hover{color:#e4a41d}
/* Form */
.ms-form-title{font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#fff;margin-bottom:6px}
.ms-form-sub{font-size:13px;color:#968877;line-height:1.5;margin-bottom:28px}
.ms-row{margin-bottom:16px}
.ms-row-half{display:flex;gap:12px;margin-bottom:16px}
.ms-label{display:block;font-size:10px;font-weight:600;color:#968877;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px}
.ms-input{width:100%;padding:12px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;font-family:'Instrument Sans',sans-serif;font-size:14px;color:#fff;outline:none;transition:border-color .3s,box-shadow .3s}
.ms-input:focus{border-color:#e4a41d;box-shadow:0 0 0 3px rgba(228,164,29,.08)}
.ms-input::placeholder{color:#53493e}
.ms-select{width:100%;padding:12px 14px;background:#262320;border:1px solid rgba(255,255,255,.08);border-radius:10px;font-family:'Instrument Sans',sans-serif;font-size:14px;color:#fff;outline:none;appearance:auto}
.ms-error{background:rgba(191,57,43,.08);border:1px solid rgba(191,57,43,.2);border-radius:10px;padding:11px 16px;font-size:13px;color:#e74c3c;margin-bottom:16px}
.ms-btn{width:100%;padding:15px;background:#e4a41d;color:#111010;border:none;border-radius:10px;font-family:'Instrument Sans',sans-serif;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;margin-top:4px}
.ms-btn:hover{background:#f2be42;transform:translateY(-1px);box-shadow:0 6px 20px rgba(228,164,29,.2)}
.ms-btn:disabled{opacity:.6;cursor:not-allowed;transform:none;box-shadow:none}
.ms-fine{font-size:11px;color:#746859;text-align:center;line-height:1.5;margin-top:16px}
.ms-fine a{color:#e4a41d}
/* Success */
.ms-success{max-width:520px;width:100%;background:#1c1a18;border:1px solid rgba(255,255,255,.06);border-radius:24px;padding:56px 40px;text-align:center;position:relative;z-index:1}
.ms-success h1{font-family:'DM Serif Display',Georgia,serif;font-size:32px;color:#fff;margin:20px 0 12px}
.ms-success p{font-size:15px;color:#b5a594;line-height:1.65;max-width:380px;margin:0 auto}
.ms-success a{display:inline-block;margin-top:28px;font-size:13px;color:#e4a41d;text-decoration:none}
/* Responsive */
@media(max-width:800px){
  .ms-wrap{grid-template-columns:1fr;max-width:500px}
  .ms-left{padding:32px 28px;border-right:none;border-bottom:1px solid rgba(255,255,255,.05)}
  .ms-right{padding:32px 28px}
  .ms-plan-name{font-size:28px}
  .ms-plan-dollar{font-size:34px}
  .ms-row-half{flex-direction:column;gap:16px}
}
@media(max-width:500px){
  .ms-page{padding:16px 12px}
  .ms-left{padding:28px 22px}
  .ms-right{padding:28px 22px}
  .ms-success{padding:40px 24px}
}
`

export default function MembershipSignupPage() {
  return (
    <Suspense fallback={<div className="ms-page"><div className="ms-success"><p style={{color:'#968877'}}>Loading...</p></div></div>}>
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=DM+Serif+Display:ital@0;1&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <MembershipForm />
    </Suspense>
  )
}

function MembershipForm() {
  const searchParams = useSearchParams()
  const paramPlan = searchParams.get('plan') || ''
  const isPaymentSuccess = searchParams.get('success') === 'true'

  const [form, setForm] = useState({
    fullName: '', companyName: '', phone: '', email: '', plan: '', monthlyYards: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (paramPlan in PLANS) setForm(f => ({ ...f, plan: paramPlan }))
  }, [paramPlan])

  const formatPhone = (val: string) => {
    let v = val.replace(/\D/g, '').slice(0, 10)
    if (v.length >= 6) return `(${v.slice(0,3)}) ${v.slice(3,6)}-${v.slice(6)}`
    if (v.length >= 3) return `(${v.slice(0,3)}) ${v.slice(3)}`
    return v
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.fullName.trim()) return setError('Full name is required')
    if (form.phone.replace(/\D/g, '').length < 10) return setError('Valid 10-digit phone number is required')
    if (!form.email.includes('@') || !form.email.includes('.')) return setError('Valid email is required')
    if (!form.plan || !(form.plan in PLANS)) return setError('Please select a plan')

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
      if (!data.success) return setError(data.error || 'Something went wrong.')
      if (data.data?.checkoutUrl) {
        window.location.href = data.data.checkoutUrl
      } else {
        setError('Could not start checkout. Please try again or call (469) 717-4225.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const plan = PLANS[form.plan]

  // Payment confirmed — returned from Stripe
  if (isPaymentSuccess) {
    const confirmedPlan = PLANS[paramPlan]
    return (
      <div className="ms-page">
        <div className="ms-success">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#68c06c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <h1>You're in. Payment confirmed.</h1>
          {confirmedPlan && <p style={{fontFamily:"'JetBrains Mono',monospace",fontSize:'18px',fontWeight:700,color:'#e4a41d',marginBottom:'8px'}}>{confirmedPlan.name} — ${confirmedPlan.price}/mo</p>}
          <p>Welcome to DumpSite. Your membership is active and your dedicated dispatcher is being assigned. Expect a text within the hour to get your first dump site matched.</p>
          <a href="/">&larr; Back to DumpSite.io</a>
        </div>
      </div>
    )
  }

  return (
    <div className="ms-page">
      <div className="ms-wrap">
        {/* LEFT — Plan details */}
        <div className="ms-left">
          <a href="/" className="ms-logo">DUMP<span>SITE</span>.IO</a>

          {plan ? (
            <>
              <div className="ms-plan-label">{plan.name} Plan</div>
              <div className="ms-plan-name">{plan.name}</div>
              <div className="ms-plan-price">
                <span className="ms-plan-dollar">${plan.price}</span>
                <span className="ms-plan-per">{plan.per}</span>
              </div>
              <div className="ms-plan-saves">{plan.saves}</div>
              <p className="ms-plan-tag">{plan.tagline}</p>

              <ul className="ms-features">
                <li className="hl">{plan.highlight}</li>
                {plan.features.map((f, i) => <li key={i}>{f}</li>)}
              </ul>

              <div className="ms-guarantee">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#68c06c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
                <div className="ms-guar-text">
                  <h4>Savings Guarantee</h4>
                  <p>Save more than your membership costs or get a full refund + next month free.</p>
                </div>
              </div>
              <a href="/#membership" className="ms-change">&larr; Compare all plans</a>
            </>
          ) : (
            <>
              <div className="ms-plan-label">Membership</div>
              <div className="ms-plan-name">Pick your plan</div>
              <p className="ms-plan-tag" style={{marginBottom:'20px'}}>Every plan includes your own dedicated dirt dispatcher, access to free dump sites, and full load tracking.</p>
              {Object.values(PLANS).map(p => (
                <button key={p.slug} onClick={() => setForm(f => ({...f, plan: p.slug}))} style={{
                  display:'block', width:'100%', padding:'14px 18px', marginBottom:'8px',
                  background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.07)',
                  borderRadius:'12px', cursor:'pointer', textAlign:'left' as const, color:'#fff',
                  fontFamily:'inherit', fontSize:'14px', transition:'border-color .2s',
                }}>
                  <span style={{fontFamily:"'DM Serif Display',serif",fontSize:'17px'}}>{p.name}</span>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:'#e4a41d',marginLeft:'10px'}}>${p.price}/mo</span>
                  <span style={{display:'block',fontSize:'12px',color:'#968877',marginTop:'2px'}}>{p.features[0]}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* RIGHT — Form */}
        <div className="ms-right">
          <h2 className="ms-form-title">Get started</h2>
          <p className="ms-form-sub">Fill this out and you'll be taken to secure checkout. Your dispatcher gets assigned the moment payment confirms.</p>

          <form onSubmit={handleSubmit}>
            <div className="ms-row">
              <label className="ms-label">Full Name *</label>
              <input className="ms-input" type="text" value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})} placeholder="John Smith" autoComplete="name" />
            </div>

            <div className="ms-row">
              <label className="ms-label">Company Name</label>
              <input className="ms-input" type="text" value={form.companyName} onChange={e => setForm({...form, companyName: e.target.value})} placeholder="Smith Excavation LLC" autoComplete="organization" />
            </div>

            <div className="ms-row-half">
              <div style={{flex:1}}>
                <label className="ms-label">Phone *</label>
                <input className="ms-input" type="tel" value={form.phone} onChange={e => setForm({...form, phone: formatPhone(e.target.value)})} placeholder="(469) 555-0123" autoComplete="tel" maxLength={14} />
              </div>
              <div style={{flex:1}}>
                <label className="ms-label">Email *</label>
                <input className="ms-input" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="john@company.com" autoComplete="email" />
              </div>
            </div>

            <div className="ms-row">
              <label className="ms-label">Estimated Monthly Volume</label>
              <select className="ms-select" value={form.monthlyYards} onChange={e => setForm({...form, monthlyYards: e.target.value})}>
                <option value="">How many cubic yards per month?</option>
                {YARD_OPTIONS.map(o => <option key={o} value={o}>{o} yards/month</option>)}
              </select>
            </div>

            {!plan && (
              <div className="ms-row">
                <label className="ms-label">Plan *</label>
                <select className="ms-select" value={form.plan} onChange={e => setForm({...form, plan: e.target.value})}>
                  <option value="">Select a plan</option>
                  {Object.values(PLANS).map(p => <option key={p.slug} value={p.slug}>{p.name} — ${p.price}/mo</option>)}
                </select>
              </div>
            )}

            {error && <div className="ms-error">{error}</div>}

            <button type="submit" className="ms-btn" disabled={loading}>
              {loading ? 'Redirecting to checkout...' : plan ? `Continue to Payment — $${plan.price}/mo →` : 'Continue to Payment →'}
            </button>

            <p className="ms-fine">
              Secure payment via Stripe. Cancel anytime, no contracts. Questions? Call <a href="tel:+14697174225">(469) 717-4225</a>
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
