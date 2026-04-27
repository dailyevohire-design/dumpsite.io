import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { notifyAdminThrottled } from '@/lib/alerts/notify-admin-throttled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN!;
const FDNM_URL = process.env.FDNM_URL ?? 'https://www.filldirtnearme.net';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const healthRes = await fetch(`${FDNM_URL}/api/internal/health/rep-content`, {
    headers: { Authorization: `Bearer ${INTERNAL_TOKEN}` },
    cache: 'no-store',
  });
  if (!healthRes.ok) {
    await pageAdmin(`Rep content watchdog: health endpoint returned ${healthRes.status}`);
    return NextResponse.json({ error: 'health_check_failed' }, { status: 502 });
  }
  const health = await healthRes.json();
  const unhealthy: any[] = health.unhealthy_reps ?? [];
  if (unhealthy.length === 0) {
    return NextResponse.json({ ok: true, healed: 0, alerted: 0 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let healed = 0;
  let cooled = 0;
  const failures: string[] = [];

  for (const r of unhealthy) {
    const { data: shouldHeal } = await supabase.rpc('fdnm_should_auto_heal', { p_rep_id: r.rep_id, p_cooldown_min: 30 });
    if (shouldHeal === false) {
      cooled++;
      continue;
    }
    const { error } = await supabase.rpc('fdnm_emergency_generate_for_rep', {
      p_rep_id: r.rep_id, p_count: 5,
    });
    if (error) failures.push(`${r.rep_id}: ${error.message}`);
    else healed++;
  }

  if (failures.length > 0) {
    await pageAdmin(`Rep content auto-heal failed for: ${failures.join(' | ')}`);
  }
  return NextResponse.json({ ok: true, healed, cooled, alerted: failures.length, unhealthy_count: unhealthy.length });
}

async function pageAdmin(body: string) {
  try {
    await notifyAdminThrottled('cron_rep_content', 'system', body, { source: 'cron:rep-content-watchdog' });
  } catch { /* swallow — alert path must never throw */ }
}
