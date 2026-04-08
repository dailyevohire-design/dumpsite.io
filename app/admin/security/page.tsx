'use client'
import { useEffect, useState } from 'react'

interface SecurityEvent {
  id: string
  event_type: string
  session_id: string | null
  url: string | null
  ip: string | null
  user_agent: string | null
  country: string | null
  city: string | null
  payload: any
  bot_confidence: number | null
  alerted: boolean
  created_at: string
}

interface Stats {
  total: number
  critical: number
  bots: number
  csp: number
  alerted: number
}

const TYPES = [
  { key: '', label: 'All' },
  { key: 'address_leak', label: 'Address leaks' },
  { key: 'honeypot_form', label: 'Honeypots' },
  { key: 'fingerprint', label: 'Fingerprints' },
  { key: 'csp_violation', label: 'CSP' },
  { key: 'behavior', label: 'Behavior' },
]

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'America/Chicago',
  })
}

function severityColor(e: SecurityEvent): string {
  if (e.event_type === 'address_leak' || e.event_type === 'honeypot_form') return '#dc2626'
  if ((e.bot_confidence || 0) >= 0.7) return '#ea580c'
  if (e.event_type === 'csp_violation') return '#ca8a04'
  return '#475569'
}

export default function SecurityPage() {
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/security${filter ? `?type=${filter}` : ''}`)
      const json = await res.json()
      if (json.success) {
        setEvents(json.events)
        setStats(json.stats)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filter])
  useEffect(() => {
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [filter])

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, margin: 0 }}>Security Events</h1>
        <button
          onClick={load}
          style={{ padding: '8px 16px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '24px' }}>
          <StatCard label="Total" value={stats.total} color="#475569" />
          <StatCard label="Critical" value={stats.critical} color="#dc2626" />
          <StatCard label="Bots ≥0.7" value={stats.bots} color="#ea580c" />
          <StatCard label="CSP" value={stats.csp} color="#ca8a04" />
          <StatCard label="SMS Alerted" value={stats.alerted} color="#0891b2" />
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            style={{
              padding: '6px 14px',
              borderRadius: '999px',
              border: '1px solid #e2e8f0',
              background: filter === t.key ? '#0f172a' : 'white',
              color: filter === t.key ? 'white' : '#0f172a',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
        {events.length === 0 && !loading && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>No events</div>
        )}
        {events.map((e) => (
          <div key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
            <div
              onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '140px 110px 1fr 130px 90px 60px', gap: '12px', alignItems: 'center', cursor: 'pointer', fontSize: '13px' }}
            >
              <span style={{ color: '#64748b' }}>{fmtTime(e.created_at)}</span>
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
                background: severityColor(e), color: 'white', fontSize: '11px', fontWeight: 600,
                textAlign: 'center',
              }}>
                {e.event_type}
              </span>
              <span style={{ color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.url || '—'}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#475569' }}>
                {e.ip} {e.country && `(${e.country})`}
              </span>
              <span>
                {e.bot_confidence != null && (
                  <span style={{ color: e.bot_confidence >= 0.7 ? '#dc2626' : '#64748b' }}>
                    bot {e.bot_confidence.toFixed(2)}
                  </span>
                )}
              </span>
              <span>
                {e.alerted && <span style={{ color: '#0891b2', fontSize: '11px', fontWeight: 600 }}>SMS</span>}
              </span>
            </div>
            {expanded === e.id && (
              <div style={{ padding: '12px 16px', background: '#f8fafc', borderTop: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>UA: {e.user_agent}</div>
                <pre style={{ margin: 0, fontSize: '12px', background: 'white', padding: '12px', borderRadius: '4px', border: '1px solid #e2e8f0', overflow: 'auto' }}>
{JSON.stringify(e.payload, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
      <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 700, color, marginTop: '4px' }}>{value}</div>
    </div>
  )
}
