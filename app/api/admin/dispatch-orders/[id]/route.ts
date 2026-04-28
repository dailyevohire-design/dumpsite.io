// app/api/admin/dispatch-orders/[id]/route.ts
//
// Admin server-side mutations on dispatch_orders. Replaces the dead RLS policies
// admin_update_dispatch_orders / admin_delete_dispatch_orders dropped in migration
// 20260428_lockdown_create_sms_driver_and_dead_admin_policies.
//
// SECURITY NOTE — 2026-04-28
// requireAdmin() checks user_metadata.role, which is USER-WRITABLE via
// supabase.auth.updateUser({ data: { role: 'admin' } }) from any authenticated
// session. The 4 current admins are correctly configured, but this gate is
// trivially bypassable by any authenticated user. Hardening: move to a server-
// side admin allowlist (auth.users.id IN (SELECT id FROM admin_users)) or to
// app_metadata.role with a backfill + auth.admin.updateUserById trigger.
// Tracked as post-launch P0.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_STATUSES = [
  'dispatching','dispatched','in_transit','delivered',
  'completed','cancelled','rejected','quoted','pending',
] as const;
type AllowedStatus = typeof ALLOWED_STATUSES[number];

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (!xff) return null;
  return xff.split(',')[0]?.trim() || null;
}

async function writeAuditLog(
  sb: ReturnType<typeof createAdminSupabase>,
  row: {
    actor_id: string | null;
    actor_email: string | null;
    action: string;
    entity_id: string;
    ip_address: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await sb.from('audit_logs').insert({
      actor_id: row.actor_id,
      action: row.action,
      entity_type: 'dispatch_orders',
      entity_id: row.entity_id,
      ip_address: row.ip_address,
      metadata: { ...row.metadata, actor_email: row.actor_email },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[admin/dispatch-orders] audit_log_write_failed', {
      action: row.action, entity_id: row.entity_id, err: msg,
    });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'invalid_id' }, { status: 400 });
  }

  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const status = (body as { status?: unknown } | null)?.status;
  if (typeof status !== 'string' || !ALLOWED_STATUSES.includes(status as AllowedStatus)) {
    return NextResponse.json(
      { success: false, error: 'invalid_status', allowed: ALLOWED_STATUSES },
      { status: 400 },
    );
  }

  const sb = createAdminSupabase();

  const { data: before, error: readErr } = await sb
    .from('dispatch_orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ success: false, error: 'read_failed' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
  }

  const { error: updErr } = await sb
    .from('dispatch_orders')
    .update({ status })
    .eq('id', id);

  if (updErr) {
    return NextResponse.json({ success: false, error: 'update_failed' }, { status: 500 });
  }

  await writeAuditLog(sb, {
    actor_id: auth.user.id,
    actor_email: auth.user.email ?? null,
    action: 'admin.dispatch_orders.update',
    entity_id: id,
    ip_address: clientIp(req),
    metadata: { before: { status: before.status }, after: { status } },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'invalid_id' }, { status: 400 });
  }

  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const sb = createAdminSupabase();

  const { data: before, error: readErr } = await sb
    .from('dispatch_orders')
    .select('id, client_name, status')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ success: false, error: 'read_failed' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
  }

  const { error: delErr } = await sb
    .from('dispatch_orders')
    .delete()
    .eq('id', id);

  if (delErr) {
    return NextResponse.json({ success: false, error: 'delete_failed' }, { status: 500 });
  }

  await writeAuditLog(sb, {
    actor_id: auth.user.id,
    actor_email: auth.user.email ?? null,
    action: 'admin.dispatch_orders.delete',
    entity_id: id,
    ip_address: clientIp(req),
    metadata: { before },
  });

  return NextResponse.json({ success: true });
}
