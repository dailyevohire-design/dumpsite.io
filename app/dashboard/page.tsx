'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

interface Conv { phone: string; state: string; extracted_city: string | null; extracted_truck_type: string | null; extracted_yards: number | null; updated_at: string; photo_public_url: string | null; pending_approval_order_id: string | null; active_order_id: string | null }
interface SMSLog { phone: string; body: string; direction: 'inbound' | 'outbound'; created_at: string }
interface Payment { driver_phone: string; amount_cents: number; status: string; created_at: string; loads_delivered: number }
interface LiveData { timestamp: string; activeConversations: Conv[]; liveMessages: SMSLog[]; orderStats: { statusCounts: Record<string, number>; totalYards: number; totalRevenue: number }; payments: { pending: number; paid: number; records: Payment[] } }

const STATE: Record<string, { color: string; label: string; dot: string }> = {
  DISCOVERY: { color: '#4f46e5', label: 'DISCOVERY', dot: '#818cf8' },
  ASKING_TRUCK: { color: '#7c3aed', label: 'TRUCK', dot: '#a78bfa' },
  PHOTO_PENDING: { color: '#d97706', label: 'PHOTO', dot: '#fbbf24' },
  APPROVAL_PENDING: { color: '#dc2626', label: 'APPROVAL', dot: '#f87171' },
  ACTIVE: { color: '#059669', label: 'ACTIVE', dot: '#34d399' },
  OTW_PENDING: { color: '#0891b2', label: 'OTW', dot: '#22d3ee' },
  PAYMENT_METHOD_PENDING: { color: '#ea580c', label: 'PAYMENT', dot: '#fb923c' },
  PAYMENT_ACCOUNT_PENDING: { color: '#ea580c', label: 'PAY ACCT', dot: '#fb923c' },
  AWAITING_CUSTOMER_CONFIRM: { color: '#9333ea', label: 'CONFIRM', dot: '#c084fc' },
  CLOSED: { color: '#374151', label: 'CLOSED', dot: '#6b7280' },
  GETTING_NAME: { color: '#1d4ed8', label: 'ONBOARD', dot: '#60a5fa' },
}
const stateOf = (s: string) => STATE[s] || { color: '#374151', label: s, dot: '#6b7280' }
const fmt = (phone: string) => { const d = phone.replace(/\D/g,''); return d.length === 10 ? `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}` : phone }
const ago = (ts: string) => { const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000); if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s/60)}m ago`; return `${Math.floor(s/3600)}h ago` }
const truckFmt = (t: string | null) => t ? t.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()) : null

export default function Dashboard() {
  const [data, setData] = useState<LiveData | null>(null)
  const [err, setErr] = useState('')
  const [live, setLive] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const router = useRouter()

  useEffect(() => {
    const checkRole = async () => {
      const supabase = createBrowserSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }
      const role = user.user_metadata?.role
      if (role !== 'admin' && role !== 'superadmin') { router.replace('/map'); return }
      setAuthorized(true)
    }
    checkRole()
  }, [router])

  const load = useCallback(async () => {
    try { const r = await fetch('/api/dashboard/live', { cache: 'no-store' }); if (!r.ok) throw new Error(`${r.status}`); setData(await r.json()); setErr('') } catch (e: any) { setErr(e.message) }
  }, [])
  useEffect(() => { if (authorized) load() }, [authorized, load])
  useEffect(() => { if (!live) { intervalRef.current && clearInterval(intervalRef.current); return }; intervalRef.current = setInterval(load, 6000); return () => { intervalRef.current && clearInterval(intervalRef.current) } }, [live, load])
  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight }, [data?.liveMessages])

  const convs = data?.activeConversations || [], msgs = data?.liveMessages || []
  const selectedMsgs = selected ? msgs.filter(m => m.phone === selected) : msgs
  const stats = data?.orderStats, pay = data?.payments
  const byPhone: Record<string, SMSLog[]> = {}
  for (const m of msgs) { if (!byPhone[m.phone]) byPhone[m.phone] = []; byPhone[m.phone].push(m) }

  if (!authorized) return <div style={{ background: '#080b0f', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>Checking access...</div>

  return (
    <div style={{ background: '#080b0f', minHeight: '100vh', color: '#e2e8f0', fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace', fontSize: 13, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100vh' }}>
      {/* HEADER */}
      <div style={{ background: '#0d1117', borderBottom: '1px solid #1e2530', padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: live ? '#22c55e' : '#4b5563', boxShadow: live ? '0 0 10px #22c55e88' : 'none', animation: live ? 'pulse 2s infinite' : 'none' }}/>
            <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 15, letterSpacing: 2 }}>DUMPSITE</span>
            <span style={{ color: '#374151', fontSize: 15 }}>|</span>
            <span style={{ color: '#6b7280', fontSize: 11, letterSpacing: 1 }}>DISPATCH CONTROL</span>
          </div>
          {err && <span style={{ color: '#ef4444', fontSize: 11 }}>{err}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: '#374151', fontSize: 11 }}>{data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '--:--:--'}</span>
          <button onClick={() => setLive(l => !l)} style={{ background: live ? '#052e16' : '#1c1c1c', border: `1px solid ${live ? '#166534' : '#374151'}`, color: live ? '#22c55e' : '#6b7280', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 11, letterSpacing: 1, fontFamily: 'inherit' }}>{live ? 'LIVE' : 'PAUSED'}</button>
          <button onClick={load} style={{ background: '#1c1c1c', border: '1px solid #374151', color: '#9ca3af', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>{'Refresh'}</button>
        </div>
      </div>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #1e2530', flexShrink: 0 }}>
        {[
          { label: 'DRIVERS ACTIVE', val: convs.filter(c => !['CLOSED','DISCOVERY'].includes(c.state)).length, color: '#22c55e', sub: `${convs.length} total` },
          { label: 'DISPATCHING', val: stats?.statusCounts?.dispatching || 0, color: '#4f46e5', sub: 'orders' },
          { label: 'JOBS ACTIVE', val: stats?.statusCounts?.active || 0, color: '#f59e0b', sub: 'in progress' },
          { label: 'COMPLETED', val: stats?.statusCounts?.completed || 0, color: '#06b6d4', sub: 'today' },
          { label: 'YARDS MOVING', val: (stats?.totalYards || 0).toLocaleString(), color: '#a855f7', sub: 'cubic yards' },
          { label: 'PENDING PAY', val: `$${(pay?.pending || 0).toFixed(0)}`, color: '#f97316', sub: 'to send' },
          { label: 'PAID OUT', val: `$${(pay?.paid || 0).toFixed(0)}`, color: '#22c55e', sub: 'today' },
        ].map((k, i) => (
          <div key={i} style={{ padding: '12px 16px', borderRight: i < 6 ? '1px solid #1e2530' : 'none', background: '#0d1117' }}>
            <div style={{ color: '#374151', fontSize: 9, letterSpacing: 1.5, marginBottom: 4 }}>{k.label}</div>
            <div style={{ color: k.color, fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{k.val}</div>
            <div style={{ color: '#374151', fontSize: 10, marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* MAIN */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 280px', flex: 1, overflow: 'hidden' }}>
        {/* LEFT */}
        <div style={{ borderRight: '1px solid #1e2530', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e2530', background: '#0d1117' }}>
            <span style={{ color: '#6b7280', fontSize: 10, letterSpacing: 1.5 }}>{'ACTIVE DRIVERS (' + convs.length + ')'}</span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {convs.length === 0 && <div style={{ color: '#374151', padding: 20, textAlign: 'center', fontSize: 12 }}>No active conversations</div>}
            {convs.map(c => { const st = stateOf(c.state); const isSel = selected === c.phone; const last = byPhone[c.phone]?.slice(-1)[0]; return (
              <div key={c.phone} onClick={() => setSelected(isSel ? null : c.phone)} style={{ padding: '12px 16px', borderBottom: '1px solid #111827', cursor: 'pointer', background: isSel ? '#0f172a' : 'transparent', borderLeft: `3px solid ${isSel ? st.color : 'transparent'}`, transition: 'all 0.1s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#e2e8f0', fontSize: 12 }}>{fmt(c.phone)}</span>
                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: st.color + '22', color: st.dot, border: `1px solid ${st.color}44`, letterSpacing: 0.5 }}>{st.label}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
                  {c.extracted_city && <span style={{ color: '#6b7280', fontSize: 10 }}>{c.extracted_city}</span>}
                  {c.extracted_truck_type && <span style={{ color: '#6b7280', fontSize: 10 }}>{truckFmt(c.extracted_truck_type)}</span>}
                  {c.extracted_yards && <span style={{ color: '#6b7280', fontSize: 10 }}>{c.extracted_yards + 'yds'}</span>}
                </div>
                {last && <div style={{ marginTop: 5, color: '#4b5563', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(last.direction === 'outbound' ? '> ' : '< ') + last.body}</div>}
                <div style={{ color: '#1f2937', fontSize: 9, marginTop: 3 }}>{ago(c.updated_at)}</div>
              </div>
            )})}
          </div>
        </div>

        {/* CENTER */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e2530', background: '#0d1117', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#6b7280', fontSize: 10, letterSpacing: 1.5 }}>{selected ? 'CONVERSATION +1' + selected : 'LIVE SMS FEED'}</span>
            {selected && <button onClick={() => setSelected(null)} style={{ background: 'transparent', border: '1px solid #374151', color: '#6b7280', padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit' }}>{'x ALL'}</button>}
          </div>
          <div ref={feedRef} style={{ overflowY: 'auto', flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {selectedMsgs.slice(-60).map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.direction === 'outbound' ? 'flex-end' : 'flex-start' }}>
                <div style={{ fontSize: 9, color: '#374151', marginBottom: 2, display: 'flex', gap: 6 }}>
                  {m.direction === 'inbound' && <span style={{ color: '#4b5563' }}>{'+1' + m.phone}</span>}
                  <span>{new Date(m.created_at).toLocaleTimeString()}</span>
                  {m.direction === 'outbound' && <span style={{ color: '#1d4ed8' }}>{'JESSE \u203A'}</span>}
                </div>
                <div style={{ maxWidth: '72%', background: m.direction === 'outbound' ? '#0f2040' : '#111827', border: `1px solid ${m.direction === 'outbound' ? '#1e3a5f' : '#1f2937'}`, borderRadius: m.direction === 'outbound' ? '10px 2px 10px 10px' : '2px 10px 10px 10px', padding: '7px 12px', color: m.direction === 'outbound' ? '#93c5fd' : '#d1d5db', fontSize: 12, lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {m.body || '[photo]'}
                </div>
              </div>
            ))}
            {selectedMsgs.length === 0 && <div style={{ color: '#374151', textAlign: 'center', padding: 40, fontSize: 12 }}>{selected ? 'No messages for this driver' : 'No messages yet'}</div>}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ borderLeft: '1px solid #1e2530', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ borderBottom: '1px solid #1e2530' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #111827', background: '#0d1117' }}><span style={{ color: '#6b7280', fontSize: 10, letterSpacing: 1.5 }}>PIPELINE</span></div>
            <div style={{ padding: '8px 0' }}>
              {Object.entries(STATE).map(([state, cfg]) => { const count = convs.filter(c => c.state === state).length; if (count === 0) return null; return (
                <div key={state} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 16px' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }}/>
                  <span style={{ color: '#6b7280', fontSize: 10, flex: 1 }}>{cfg.label}</span>
                  <span style={{ color: cfg.dot, fontWeight: 700, fontSize: 13, background: cfg.color + '22', padding: '1px 8px', borderRadius: 3 }}>{count}</span>
                </div>
              )})}
            </div>
          </div>
          <div style={{ borderBottom: '1px solid #1e2530' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #111827', background: '#0d1117' }}><span style={{ color: '#6b7280', fontSize: 10, letterSpacing: 1.5 }}>ORDERS (24H)</span></div>
            <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(stats?.statusCounts || {}).map(([status, count]) => (
                <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#4b5563', fontSize: 10, flex: 1, textTransform: 'capitalize' }}>{status}</span>
                  <div style={{ height: 3, width: Math.min((count as number) * 10, 100), background: status === 'completed' ? '#22c55e' : status === 'active' ? '#f59e0b' : '#4f46e5', borderRadius: 2 }}/>
                  <span style={{ color: '#9ca3af', fontSize: 11, minWidth: 16, textAlign: 'right' }}>{count as number}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #111827', background: '#0d1117' }}><span style={{ color: '#6b7280', fontSize: 10, letterSpacing: 1.5 }}>PAYMENTS (24H)</span></div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <div style={{ padding: '8px 16px', display: 'flex', gap: 12, borderBottom: '1px solid #111827' }}>
              <div><div style={{ color: '#374151', fontSize: 9 }}>PENDING</div><div style={{ color: '#f97316', fontSize: 18, fontWeight: 700 }}>${'{'}(pay?.pending || 0).toFixed(0){'}'}</div></div>
              <div style={{ width: 1, background: '#1f2937' }}/>
              <div><div style={{ color: '#374151', fontSize: 9 }}>PAID</div><div style={{ color: '#22c55e', fontSize: 18, fontWeight: 700 }}>${'{'}(pay?.paid || 0).toFixed(0){'}'}</div></div>
            </div>
            {(pay?.records || []).slice(0, 15).map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 16px', borderBottom: '1px solid #0d1117' }}>
                <div><div style={{ color: '#6b7280', fontSize: 10 }}>{fmt(p.driver_phone)}</div><div style={{ color: '#374151', fontSize: 9 }}>{ago(p.created_at)}</div></div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: p.status === 'paid' ? '#22c55e' : '#f97316', fontSize: 12, fontWeight: 700 }}>{'$' + (p.amount_cents / 100).toFixed(0)}</div>
                  <div style={{ fontSize: 9, color: p.status === 'paid' ? '#166534' : '#92400e', background: p.status === 'paid' ? '#052e16' : '#1c0a00', padding: '1px 5px', borderRadius: 2 }}>{p.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; } ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0d1117; } ::-webkit-scrollbar-thumb { background: #1e2530; border-radius: 2px; } @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  )
}
