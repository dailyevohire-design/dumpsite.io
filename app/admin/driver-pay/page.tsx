"use client"
import { useState, useEffect, useMemo } from "react"

interface CityRow {
  id: string
  name: string
  driverPayCents: number
  dispatchCount: number
  avgQuoteCents: number
}

const DEFAULT_CENTS = 4000

function fmtDollars(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`
}

function marginPct(quoteCents: number, payCents: number): number {
  if (quoteCents <= 0) return 0
  return Math.round(((quoteCents - payCents) / quoteCents) * 100)
}

export default function DriverPayPage() {
  const [rows, setRows] = useState<CityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/admin/cities/driver-pay")
        const json = await res.json()
        if (cancelled) return
        if (!json.success) {
          setErr(json.error || "Failed to load")
        } else {
          setRows(json.data || [])
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Network error")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => r.name.toLowerCase().includes(q))
  }, [rows, search])

  const summary = useMemo(() => {
    const total = rows.length
    const atDefault = rows.filter(r => r.driverPayCents === DEFAULT_CENTS).length
    const atDefaultWithDispatch = rows.filter(
      r => r.driverPayCents === DEFAULT_CENTS && r.dispatchCount > 0
    ).length
    const min = rows.length ? Math.min(...rows.map(r => r.driverPayCents)) : 0
    const max = rows.length ? Math.max(...rows.map(r => r.driverPayCents)) : 0
    return { total, atDefault, atDefaultWithDispatch, min, max }
  }, [rows])

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", padding: 16 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Driver Pay Rates</h1>
        <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
          Per-city flat rate paid to drivers per delivered load. Range: $25–$70.
        </p>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
          <SummaryCard label="Total cities" value={String(summary.total)} />
          <SummaryCard label="At $40 default" value={String(summary.atDefault)} dim />
          <SummaryCard
            label="Default + has dispatch"
            value={String(summary.atDefaultWithDispatch)}
            warn={summary.atDefaultWithDispatch > 0}
          />
          <SummaryCard label="Range" value={`${fmtDollars(summary.min)}–${fmtDollars(summary.max)}`} />
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by city name…"
          style={{
            width: "100%",
            background: "#111",
            color: "#fff",
            border: "1px solid #333",
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 14,
            marginBottom: 12,
          }}
        />

        {loading && <div style={{ color: "#888", padding: 16 }}>Loading…</div>}
        {err && (
          <div style={{ background: "#3b0a0a", border: "1px solid #ef4444", color: "#fca5a5", padding: 12, borderRadius: 6 }}>
            {err}
          </div>
        )}

        {!loading && !err && (
          <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.6fr 0.7fr 0.9fr 0.9fr 1.4fr",
                padding: "10px 12px",
                background: "#0a0a0a",
                borderBottom: "1px solid #222",
                fontSize: 11,
                color: "#888",
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              <div>City</div>
              <div style={{ textAlign: "right" }}>Disp.</div>
              <div style={{ textAlign: "right" }}>Avg Quote</div>
              <div style={{ textAlign: "right" }}>Margin</div>
              <div style={{ textAlign: "right" }}>Driver Pay</div>
            </div>
            {filtered.map(row => (
              <CityRowEditor
                key={row.id}
                row={row}
                onUpdated={updated =>
                  setRows(rs => rs.map(r => (r.id === updated.id ? { ...r, driverPayCents: updated.driverPayCents } : r)))
                }
              />
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: 16, color: "#666", fontSize: 13, textAlign: "center" }}>No cities match</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, warn, dim }: { label: string; value: string; warn?: boolean; dim?: boolean }) {
  const color = warn ? "#f59e0b" : dim ? "#888" : "#10b981"
  return (
    <div style={{ background: "#111", border: "1px solid #222", borderRadius: 6, padding: "10px 12px" }}>
      <div style={{ color: "#888", fontSize: 11, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function CityRowEditor({ row, onUpdated }: { row: CityRow; onUpdated: (r: CityRow) => void }) {
  const [draft, setDraft] = useState<string>(String(row.driverPayCents / 100))
  const [saving, setSaving] = useState(false)
  const [rowErr, setRowErr] = useState<string | null>(null)

  useEffect(() => {
    setDraft(String(row.driverPayCents / 100))
  }, [row.driverPayCents])

  const isDefaultWithDispatch = row.driverPayCents === DEFAULT_CENTS && row.dispatchCount > 0
  const dirty = Number(draft) * 100 !== row.driverPayCents
  const margin = marginPct(row.avgQuoteCents, row.driverPayCents)

  async function save() {
    setRowErr(null)
    const dollars = Number(draft)
    if (!Number.isFinite(dollars) || dollars < 25 || dollars > 70) {
      setRowErr("$25–$70")
      return
    }
    const cents = Math.round(dollars * 100)
    const prev = row.driverPayCents

    // Optimistic
    onUpdated({ ...row, driverPayCents: cents })
    setSaving(true)

    try {
      const res = await fetch(`/api/admin/cities/${row.id}/driver-pay`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_driver_pay_cents: cents }),
      })
      const json = await res.json()
      if (!json.success) {
        onUpdated({ ...row, driverPayCents: prev }) // revert
        setRowErr(json.error || "Save failed")
      }
    } catch (e) {
      onUpdated({ ...row, driverPayCents: prev })
      setRowErr(e instanceof Error ? e.message : "Network error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.6fr 0.7fr 0.9fr 0.9fr 1.4fr",
        padding: "10px 12px",
        borderBottom: "1px solid #1a1a1a",
        background: isDefaultWithDispatch ? "#1a1305" : "transparent",
        alignItems: "center",
        fontSize: 13,
      }}
    >
      <div style={{ color: "#fff", fontWeight: 500 }}>
        {row.name}
        {isDefaultWithDispatch && (
          <span style={{ color: "#f59e0b", fontSize: 10, marginLeft: 6, fontWeight: 600 }}>NEEDS PRICING</span>
        )}
      </div>
      <div style={{ textAlign: "right", color: row.dispatchCount > 0 ? "#fff" : "#555" }}>
        {row.dispatchCount}
      </div>
      <div style={{ textAlign: "right", color: row.avgQuoteCents > 0 ? "#ccc" : "#555" }}>
        {row.avgQuoteCents > 0 ? fmtDollars(row.avgQuoteCents) : "—"}
      </div>
      <div style={{ textAlign: "right", color: row.avgQuoteCents > 0 ? "#10b981" : "#555" }}>
        {row.avgQuoteCents > 0 ? `${margin}%` : "—"}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
        <span style={{ color: "#666" }}>$</span>
        <input
          type="number"
          inputMode="numeric"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          disabled={saving}
          style={{
            width: 56,
            background: "#0a0a0a",
            color: "#fff",
            border: `1px solid ${rowErr ? "#ef4444" : "#333"}`,
            borderRadius: 4,
            padding: "4px 6px",
            fontSize: 13,
            textAlign: "right",
          }}
        />
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{
            background: !dirty ? "#222" : saving ? "#0e6b3f" : "#10b981",
            color: !dirty ? "#555" : "#000",
            border: "none",
            borderRadius: 4,
            padding: "5px 10px",
            fontSize: 12,
            fontWeight: 700,
            cursor: !dirty || saving ? "default" : "pointer",
          }}
        >
          {saving ? "…" : "Save"}
        </button>
        {rowErr && <span style={{ color: "#ef4444", fontSize: 11, marginLeft: 4 }}>{rowErr}</span>}
      </div>
    </div>
  )
}
