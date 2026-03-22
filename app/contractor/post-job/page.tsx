'use client'
import { useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function PostJobPage() {
  const [form, setForm] = useState({ title: '', address: '', materialType: 'clean_fill', yardsEstimated: '', loadsNeeded: '1', budgetPerLoad: '35', urgency: 'standard', availableDates: '', accessInstructions: '', contactName: '', contactPhone: '', cityName: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  async function submit(e: any) {
    e.preventDefault()
    if (!form.title || !form.address || !form.contactName || !form.contactPhone || !form.cityName) { setError('Please fill in all required fields'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/contractor/post-job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = await res.json()
      if (data.success) { setSuccess(true); setTimeout(() => router.push('/contractor'), 2000) }
      else setError(data.error || 'Failed to post job')
    } catch { setError('Network error') }
    setLoading(false)
  }

  const inp: React.CSSProperties = { background: '#1C1F24', border: '1px solid #272B33', color: '#E8E3DC', padding: '11px 14px', borderRadius: '9px', fontSize: '14px', width: '100%', outline: 'none', marginTop: '5px' }
  const lbl: React.CSSProperties = { fontSize: '11px', fontWeight: '700', letterSpacing: '0.07em', textTransform: 'uppercase', color: '#606670' }

  if (success) return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', color: '#27AE60', fontSize: '20px', fontWeight: '800' }}>Job posted! Redirecting to dashboard...</div>
  )

  return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', color: '#E8E3DC', fontFamily: 'system-ui, sans-serif', padding: '20px' }}>
      <div style={{ maxWidth: '520px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: '18px', fontWeight: '700', color: '#F0EDE8' }}>DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span></span>
          <a href="/contractor" style={{ color: '#606670', textDecoration: 'none', fontSize: '13px' }}>← Back</a>
        </div>
        <h1 style={{ fontWeight: '900', fontSize: '24px', marginBottom: '20px' }}>Post a Job</h1>
        {error && <div style={{ background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '8px', padding: '10px', marginBottom: '16px', color: '#E74C3C', fontSize: '13px' }}>{error}</div>}
        <form onSubmit={submit} style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '12px', padding: '24px' }}>
          <div style={{ marginBottom: '14px' }}><label style={lbl}>Job Title *</label><input style={inp} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Fill dirt needed for grading" /></div>
          <div style={{ marginBottom: '14px' }}><label style={lbl}>Delivery Address *</label><input style={inp} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Full street address" /></div>
          <div style={{ marginBottom: '14px' }}><label style={lbl}>City *</label><input style={inp} value={form.cityName} onChange={e => setForm({ ...form, cityName: e.target.value })} placeholder="e.g. Fort Worth" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div><label style={lbl}>Material Type</label><select style={inp} value={form.materialType} onChange={e => setForm({ ...form, materialType: e.target.value })}><option value="clean_fill">Clean Fill</option><option value="topsoil">Topsoil</option><option value="sandy_loam">Sandy Loam</option><option value="clay_free">Clay-Free</option><option value="caliche">Caliche</option></select></div>
            <div><label style={lbl}>Yards Estimated *</label><input style={inp} type="number" min="1" value={form.yardsEstimated} onChange={e => setForm({ ...form, yardsEstimated: e.target.value })} placeholder="100" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div><label style={lbl}>Budget Per Load ($)</label><input style={inp} type="number" min="20" value={form.budgetPerLoad} onChange={e => setForm({ ...form, budgetPerLoad: e.target.value })} /></div>
            <div><label style={lbl}>Urgency</label><select style={inp} value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}><option value="standard">Standard</option><option value="urgent">Urgent</option></select></div>
          </div>
          <div style={{ marginBottom: '14px' }}><label style={lbl}>Access Instructions (gate codes, etc.)</label><textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.accessInstructions} onChange={e => setForm({ ...form, accessInstructions: e.target.value })} placeholder="Optional — encrypted and only shared with approved drivers" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
            <div><label style={lbl}>Contact Name *</label><input style={inp} value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} /></div>
            <div><label style={lbl}>Contact Phone *</label><input style={inp} type="tel" value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} /></div>
          </div>
          <button type="submit" disabled={loading} style={{ width: '100%', background: '#F5A623', color: '#111', border: 'none', padding: '13px', borderRadius: '9px', fontWeight: '800', fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>{loading ? 'Posting...' : 'Post Job — Dispatch Drivers'}</button>
        </form>
      </div>
    </div>
  )
}
