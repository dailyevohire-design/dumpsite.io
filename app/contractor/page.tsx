'use client'
import { useState, useEffect } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function ContractorDashboard() {
  const [user, setUser] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      setUser(data.user)
      fetch('/api/contractor/jobs').then(r => r.json()).then(d => { setJobs(d.jobs || []); setLoading(false) }).catch(() => setLoading(false))
    })
  }, [])

  if (!user) return <div style={{ background: '#0A0C0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#606670', fontFamily: 'system-ui' }}>Loading...</div>

  const active = jobs.filter(j => j.status === 'dispatching')
  const completed = jobs.filter(j => j.status === 'completed')

  return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', color: '#E8E3DC', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#080A0C', borderBottom: '1px solid #272B33', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'Georgia, serif', fontSize: '18px', fontWeight: '700', color: '#F0EDE8' }}>DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span></span>
        <a href="/contractor/post-job" style={{ background: '#F5A623', color: '#111', padding: '9px 18px', borderRadius: '8px', textDecoration: 'none', fontWeight: '800', fontSize: '13px' }}>+ Post New Job</a>
      </div>

      <div style={{ padding: '20px', maxWidth: '860px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '24px' }}>
          <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700' }}>Active Jobs</div>
            <div style={{ fontSize: '28px', fontWeight: '900', color: '#27AE60' }}>{active.length}</div>
          </div>
          <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700' }}>Completed</div>
            <div style={{ fontSize: '28px', fontWeight: '900', color: '#3A8AE8' }}>{completed.length}</div>
          </div>
          <div style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#606670', fontWeight: '700' }}>Total Loads</div>
            <div style={{ fontSize: '28px', fontWeight: '900', color: '#F5A623' }}>{jobs.reduce((s, j) => s + (j.loads?.completed || 0), 0)}</div>
          </div>
        </div>

        <h2 style={{ fontWeight: '800', fontSize: '18px', marginBottom: '14px' }}>Your Jobs</h2>
        {loading ? <div style={{ textAlign: 'center', padding: '40px', color: '#606670' }}>Loading...</div>
        : jobs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#606670' }}>
            <div style={{ fontSize: '48px', marginBottom: '14px' }}>🏗️</div>
            <div style={{ fontWeight: '800', fontSize: '18px', marginBottom: '8px' }}>No jobs posted yet</div>
            <a href="/contractor/post-job" style={{ display: 'inline-block', marginTop: '12px', background: '#F5A623', color: '#111', padding: '12px 28px', borderRadius: '9px', textDecoration: 'none', fontWeight: '800' }}>Post Your First Job</a>
          </div>
        ) : jobs.map(job => (
          <div key={job.id} style={{ background: '#111316', border: '1px solid #272B33', borderRadius: '13px', padding: '16px', marginBottom: '12px', borderLeft: `3px solid ${job.status === 'dispatching' ? '#27AE60' : job.status === 'completed' ? '#3A8AE8' : '#606670'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <div>
                <div style={{ fontWeight: '800', fontSize: '16px' }}>{(job.cities as any)?.name || 'DFW'}</div>
                <div style={{ fontSize: '12px', color: '#606670' }}>{job.yards_needed} yards · {new Date(job.created_at).toLocaleDateString()}</div>
              </div>
              <span style={{ background: job.status === 'dispatching' ? 'rgba(39,174,96,0.12)' : 'rgba(59,138,232,0.12)', color: job.status === 'dispatching' ? '#27AE60' : '#3A8AE8', padding: '4px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase' }}>{job.status}</span>
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#606670' }}>
              <span>Pending: {job.loads?.pending || 0}</span>
              <span>Approved: {job.loads?.approved || 0}</span>
              <span style={{ color: '#27AE60' }}>Completed: {job.loads?.completed || 0}</span>
              <span style={{ color: '#F5A623', fontWeight: '700' }}>${Math.round((job.price_quoted_cents || 3000) / 100)}/load</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
