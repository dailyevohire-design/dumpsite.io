'use client'
import { useState } from 'react'

type ClassifierResult = {
  intent: string
  material_type: string | null
  quantity_yards: number | null
  city: string | null
  state: string | null
  urgency_days: number | null
  phone_extracted: string | null
  confidence: number
}

type MatchResult = {
  match_id: string
  distance_miles: number | null
  total_score: number
  client_name: string
  delivery_city: string | null
  yards_needed: number
  material_type: string | null
  status: string
}

type ApiResponse = {
  success: boolean
  error?: string
  signal_id?: string
  classifier?: ClassifierResult
  matches?: MatchResult[]
}

export default function FbTestPage() {
  const [postText, setPostText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ApiResponse | null>(null)

  async function handleSubmit() {
    if (!postText.trim() || loading) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/fb-test/classify-and-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_text: postText.trim() }),
      })
      const data = await res.json()
      setResult(data)
    } catch (e: any) {
      setResult({ success: false, error: e.message || 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#e5e5e5' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>FB Signal Classifier Test</h1>
      <p style={{ fontSize: 14, color: '#888', marginBottom: 24 }}>Paste a Facebook post below. We&apos;ll classify intent, geocode, insert into fb_signals, run fb_match_signal, and show top matches.</p>

      <textarea
        value={postText}
        onChange={e => setPostText(e.target.value)}
        placeholder="Paste a Facebook post here..."
        rows={6}
        style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #333', background: '#111', color: '#e5e5e5', fontSize: 14, resize: 'vertical', marginBottom: 16 }}
      />

      <button
        onClick={handleSubmit}
        disabled={loading || !postText.trim()}
        style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: loading ? '#333' : '#D97706', color: loading ? '#888' : '#000', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', marginBottom: 32 }}
      >
        {loading ? 'Classifying...' : 'Classify & Match'}
      </button>

      {result && !result.success && (
        <div style={{ padding: 16, borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#ef4444', marginBottom: 4 }}>Error</div>
          <div style={{ fontSize: 13, color: '#fca5a5' }}>{result.error}</div>
        </div>
      )}

      {result?.success && result.classifier && (
        <>
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#D97706' }}>Classifier Output</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {Object.entries(result.classifier).map(([k, v]) => (
                <div key={k} style={{ background: '#111', border: '1px solid #262626', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>{k}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2, color: v === null ? '#555' : '#e5e5e5' }}>
                    {v === null ? '—' : String(v)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 8 }}>signal_id: {result.signal_id}</div>
          </div>

          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#D97706' }}>
              Top Matches ({result.matches?.length ?? 0})
            </h2>
            {result.matches && result.matches.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #333' }}>
                      {['Score', 'Distance', 'Client', 'City', 'Yards', 'Material', 'Status'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#888', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.matches.map((m, i) => (
                      <tr key={m.match_id} style={{ borderBottom: '1px solid #1a1a1a', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: '#10b981' }}>{Number(m.total_score).toFixed(3)}</td>
                        <td style={{ padding: '8px 10px' }}>{m.distance_miles != null ? Number(m.distance_miles).toFixed(1) + ' mi' : '—'}</td>
                        <td style={{ padding: '8px 10px' }}>{m.client_name}</td>
                        <td style={{ padding: '8px 10px' }}>{m.delivery_city ?? '—'}</td>
                        <td style={{ padding: '8px 10px' }}>{m.yards_needed}</td>
                        <td style={{ padding: '8px 10px' }}>{m.material_type ?? '—'}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: m.status === 'dispatching' ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)', color: m.status === 'dispatching' ? '#3b82f6' : '#888' }}>
                            {m.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 16, background: '#111', borderRadius: 8, border: '1px solid #262626', color: '#666', fontSize: 13 }}>No matches found within 50 miles.</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
