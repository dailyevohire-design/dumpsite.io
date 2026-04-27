# P1 — next commits, after the P0 set ships and is verified live

This document tracks the followups deferred from the P0 commit
`fix(audit-log) → fix(p0-rescue-cron-fail-closed-and-viewer)`.
Every item here is real work, not aspiration. Pick them up in order.

## 1. State carry-forward
**Symptom:** Customer says "5 loads day 1, 5 day 2". Sarah re-asks "tandems or
end dumps?" without acknowledging the day-split.
**Root cause:** Extraction step writes to context, but next-step decision reads
stale context. Need to verify upsert_conversation actually persists multi-load
split, and decision pipeline re-reads after extraction.

## 2. Defer-classifier upgrade
Current `mark_defer_if_detected` uses regex. Replace with Claude Haiku
classifier (cheap, fast) that returns
`{defer: bool, reason: string, suggested_pause_hours: int}`.
Persist `reason` for analytics. Keep regex as fallback if classifier fails.

## 3. Acknowledgment gating
**Symptom:** Sergio quoted at 3-4 yd → Sarah offers 10 yd minimum + $50 fee →
customer never accepts → Sarah moves on to ask address as if accepted.
**Fix:** Add `NEEDS_ACK` state. Non-standard offers (small-load fee, surcharge,
alt date) cannot progress until next inbound contains ack-class signal
(yes / sounds good / let's do it / ok / sure).

## 4. Audit & dedupe stale `024f2627-b16b-4ef7-bc21-fe195688360c` rows
A single agent_id appears as duplicate `customer_conversations` rows across
many phones with `state=QUOTING`, `follow_up_count=null`. Looks like an
import artifact (sentinel-agent row created at first inbound before real
agent_id was bound).
- Inventory: how many rows? Distribution by created_at?
- Determine if any are referenced by `dispatch_orders` — if not, safe to delete.
- After dedupe, add `UNIQUE(phone)` constraint on `customer_conversations`.
- Once unique, simplify the canonical-row picker in
  `app/api/command-center/conversation/route.ts` and the dedupe in
  `app/api/command-center/route.ts` (no longer needed).

## 5. Nightly TTL on `processed_messages`
The idempotency table (`processed_messages`, written by the existing single-arg
`check_and_mark_message(p_sid)` RPC) grows unbounded. Add a Vercel cron that
deletes rows older than 7 days. Suggested schedule: `0 4 * * *` (4am UTC).

## 6. Migrate driver-side (Jesse) to fail-closed + sanitizer
Currently the fail-closed wrapper, sanitizer, and shared followup RPCs
only protect customer-facing paths (Sarah). Apply the same pattern to:
- `app/api/sms/webhook/route.ts` (driver inbound)
- `app/api/agents/rescue-stuck/route.ts` Jesse block (we did Sarah only)
- Driver follow-up cron(s) (none currently — but if one is added, gate it
  through the same RPC pattern)

## 7. Consolidate 20+ direct `twilio.messages.create` call sites
Inventory of sites still calling Twilio directly (admin alerts, Stripe internal
admin SMS, sms-healthcheck, otw-followup, approval-followup, retry-pending-sms,
jesse.service, sms-dispatch.service, brain.service, customer-brain.service):
- Phase 1: route remaining customer-facing sends through `sendOutboundSMS`.
- Phase 2: ESLint `no-restricted-syntax` rule banning direct
  `twilio().messages.create` — force everything through the helper.
- Phase 3: convert admin-alert paths to `sendAdminAlert()` wrapper that also
  passes through sanitizer (defense for cases where admin alerts include
  customer body excerpts).

## 8. Lowercase `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`
Current value has a capital `A` (`https://Agsjodzzjrnqdopysjbb.supabase.co`).
DNS-tolerant for now, but PostgREST clients in some libraries are case-sensitive
on hostnames. Lowercase in a separate housekeeping commit + rotate Vercel env.

## 9. Restore + test `pending_send` recovery cron
Customer-webhook still writes `pending_send` rows for crash recovery. Verify
the `sms-healthcheck` cron actually picks these up and either re-sends or
marks them as lost. Test by deliberately interrupting an `after()` block in
staging.

## 10. Sentry alert routing
`brain_alerts` rows are currently passive (just logged). Wire a Vercel cron OR
a Postgres trigger → webhook to send a Slack/email/SMS alert when an unack'd
`fail_closed_pause` row appears. Today operators only see them by checking
the table.
