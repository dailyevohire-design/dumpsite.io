// IP blocklist with 60-second module cache.
// Populated automatically when an IP racks up critical security events.
import { createAdminSupabase } from './supabase'

let cache: { ips: Set<string>; loadedAt: number } | null = null
const TTL_MS = 60_000

async function loadCache(): Promise<Set<string>> {
  try {
    const supabase = createAdminSupabase()
    const { data, error } = await supabase
      .from('ip_blocklist')
      .select('ip')
      .eq('active', true)
    if (error) {
      console.error('[ip-blocklist] load error:', error.message)
      return cache?.ips || new Set()
    }
    const set = new Set((data || []).map((r) => r.ip))
    cache = { ips: set, loadedAt: Date.now() }
    return set
  } catch (e) {
    console.error('[ip-blocklist] load exception:', e)
    return cache?.ips || new Set()
  }
}

export async function isBlocked(ip: string): Promise<boolean> {
  if (!ip || ip === 'unknown') return false
  if (!cache || Date.now() - cache.loadedAt > TTL_MS) {
    await loadCache()
  }
  return cache?.ips.has(ip) || false
}

export async function blockIp(ip: string, reason: string): Promise<void> {
  if (!ip || ip === 'unknown') return
  try {
    const supabase = createAdminSupabase()
    const { error } = await supabase.from('ip_blocklist').upsert(
      { ip, reason, active: true, blocked_at: new Date().toISOString() },
      { onConflict: 'ip' },
    )
    if (error) {
      console.error('[ip-blocklist] block error:', error.message)
      return
    }
    // Force cache refresh next call
    cache = null
  } catch (e) {
    console.error('[ip-blocklist] block exception:', e)
  }
}
