'use client'
import { useEffect, useState, useCallback } from 'react'

interface Hit {
  id: string
  phone: string
  customer_name: string | null
  delivery_address: string | null
  original_agent_name: string | null
  shopping_agent_name: string | null
  original_total_cents: number | null
  applied_total_cents: number | null
  surcharge_pct: number | null
  shop_attempt_number: number | null
  detected_at: string
}
interface PriceRow {
  phone: string
  agent_id: string
  delivery_address: string | null
  total_price_cents: number | null
  yards_needed: number | null
  material_type: string | null
  quoted_at: string
}
interface ShopJourney {
  phone: string
  agentCount: number
  rows: PriceRow[]
}
interface Data {
  success: boolean
  stats: {
    totalHits: number
    uniqueShoppers: number
    totalExtraCents: number
    avgSurchargePct: number
    windowDays: number
  }
  hits: Hit[]
  shopJourneys: ShopJourney[]
}

const fmt$ = (cents: number | null) => cents == null ? '—' : '$' + Math.round(cents / 100).toLocaleString()
const fmtPct = (n: number | null) => n == null ? '—' : Math.round(Number(n) * 100) + '%'
const fmtPhone = (p: string) => {
  const d = p.replace(/\D/g, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p
}
const ago = (ts: string) => {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function ArbitrageDashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/arbitrage', { cache: 'no-store' })
      if (!r.ok) throw new Error(`${r.status}`)
      setData(await r.json())
      setErr('')
    } catch (e: any) { setErr(e.message) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const iv = setInterval(load, 30000); return () => clearInterval(iv) }, [load])

  if (err) return <div style={{ padding: 40, background: '#0a0a0a', color: '#ef4444', minHeight: '100vh', fontFamily: 'monospace' }}>Error: {err}</div>
  if (!data) return <div style={{ padding: 40, background: '#0a0a0a', color: '#6b7280', minHeight: '100vh', fontFamily: 'monospace' }}>Loading…</div>

  const selectedJourney = selectedPhone ? data.shopJourneys.find(j => j.phone === selectedPhone) : null

  return (
    <div style={{ background: '#080b0f', minHeight: '100vh', color: '#e2e8f0', fontFamily: '"JetBrains Mono","Fira Code",monospace', fontSize: 13, padding: 20 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: '#D97706', fontWeight: 700, marginBottom: 4 }}>CROSS-AGENT ARBITRAGE</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#f3f4f6' }}>Shop Attempt Monitor</div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Last {data.stats.windowDays} days · auto-refresh 30s</div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Shop Attempts', value: data.stats.totalHits.toString(), color: '#f59e0b' },
          { label: 'Unique Customers', value: data.stats.uniqueShoppers.toString(), color: '#3b82f6' },
          { label: 'Extra Revenue', value: fmt$(data.stats.totalExtraCents), color: '#10b981' },
          { label: 'Avg Surcharge', value: fmtPct(data.stats.avgSurchargePct), color: '#8b5cf6' },
        ].map(k => (
          <div key={k.label} style={{ background: '#111316', border: '1px solid #1f2328', borderRadius: 6, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: '#6b7280', letterSpacing: 1 }}>{k.label.toUpperCase()}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color, marginTop: 4 }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        {/* Left: recent hits */}
        <div style={{ background: '#0d0f12', border: '1px solid #1f2328', borderRadius: 6 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #1f2328', fontSize: 11, color: '#9ca3af', letterSpacing: 1, fontWeight: 700 }}>RECENT SHOP ATTEMPTS</div>
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {data.hits.length === 0 && (
              <div style={{ padding: 20, color: '#6b7280', fontStyle: 'italic', textAlign: 'center' }}>No shop attempts yet. Guard is live — waiting.</div>
            )}
            {data.hits.map(h => {
              const extra = (h.applied_total_cents || 0) - (h.original_total_cents || 0)
              return (
                <div key={h.id} onClick={() => setSelectedPhone(h.phone)} style={{ padding: '10px 14px', borderBottom: '1px solid #15181c', cursor: 'pointer', background: selectedPhone === h.phone ? '#14181e' : 'transparent' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 600, color: '#f3f4f6' }}>{h.customer_name || '(no name)'} <span style={{ color: '#6b7280', fontWeight: 400 }}>· {fmtPhone(h.phone)}</span></div>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>{ago(h.detected_at)} ago</div>
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                    <span style={{ color: '#f59e0b' }}>Attempt #{h.shop_attempt_number}</span>
                    {' · '}
                    <span>{h.original_agent_name || '?'} → <b style={{ color: '#f3f4f6' }}>{h.shopping_agent_name || '?'}</b></span>
                  </div>
                  <div style={{ fontSize: 11, marginTop: 4, display: 'flex', gap: 16 }}>
                    <span>orig <b style={{ color: '#e2e8f0' }}>{fmt$(h.original_total_cents)}</b></span>
                    <span>→ applied <b style={{ color: '#10b981' }}>{fmt$(h.applied_total_cents)}</b></span>
                    <span style={{ color: '#8b5cf6' }}>+{fmtPct(h.surcharge_pct)}</span>
                    <span style={{ color: '#10b981' }}>+{fmt$(extra)}</span>
                  </div>
                  {h.delivery_address && <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.delivery_address}</div>}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: shop journeys OR selected customer detail */}
        <div style={{ background: '#0d0f12', border: '1px solid #1f2328', borderRadius: 6 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #1f2328', fontSize: 11, color: '#9ca3af', letterSpacing: 1, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
            <span>{selectedJourney ? `JOURNEY · ${fmtPhone(selectedJourney.phone)}` : 'MULTI-AGENT SHOPPERS'}</span>
            {selectedPhone && <span onClick={() => setSelectedPhone(null)} style={{ color: '#6b7280', cursor: 'pointer', fontWeight: 400 }}>✕ clear</span>}
          </div>
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {selectedJourney ? (
              selectedJourney.rows.map((r, i) => (
                <div key={i} style={{ padding: '10px 14px', borderBottom: '1px solid #15181c' }}>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{new Date(r.quoted_at).toLocaleString()}</div>
                  <div style={{ fontSize: 12, color: '#f3f4f6', marginTop: 4 }}>
                    <b>{fmt$(r.total_price_cents)}</b> · {r.yards_needed || '?'}yds {r.material_type?.replace(/_/g, ' ') || '?'}
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>agent: {r.agent_id.slice(0, 8)}… · {r.delivery_address || '(no address)'}</div>
                </div>
              ))
            ) : data.shopJourneys.length === 0 ? (
              <div style={{ padding: 20, color: '#6b7280', fontStyle: 'italic', textAlign: 'center' }}>No multi-agent shoppers yet.</div>
            ) : (
              data.shopJourneys.map(j => (
                <div key={j.phone} onClick={() => setSelectedPhone(j.phone)} style={{ padding: '10px 14px', borderBottom: '1px solid #15181c', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 600, color: '#f3f4f6' }}>{fmtPhone(j.phone)}</div>
                    <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>{j.agentCount} agents</div>
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>{j.rows.length} quotes · most recent {ago(j.rows[0].quoted_at)} ago</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
