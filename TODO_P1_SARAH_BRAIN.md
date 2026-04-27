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

## P1 — repo-hygiene baseline captured 2026-04-26 at commit 6
- Repair tests/unit/dispatch-flow.test.ts (17 failing cases on STATUS/DONE/CANCEL/free-text/unknown-driver)
- Repair tests/unit/customer-name-extraction.test.ts (1 failing case)
- Sweep no-explicit-any: 588 errors / 105 warnings repo-wide, primarily test files + route handlers
- These failures pre-date this branch and were not introduced by P0 commits c4d0a00 → commit 6.

## P1 — Alert acknowledgment system (proposed Apr 27)

**Status:** Spec only. Awaiting operator sign-off on 4 open questions before implementation.

**Goal:** Reduce admin SMS volume from "fire-and-forget on every error" to "send once per (class, phone), expect ack, escalate if unacked." Saves Twilio cost, reduces noise fatigue, gives the operator visibility into open issues that today only live as silent rows in `brain_alerts`. Supersedes/extends section 10 above ("Sentry alert routing").

### Open design questions (recommendations included — operator to confirm or redirect)

1. **Dedupe key**
   - Question: per `alert_class` only, or per `(alert_class, phone)`?
   - Recommendation: per `(alert_class, phone)`. A `brain_error` on Sergio and a `brain_error` on Christy are different problems even when the class matches. The open row gates Twilio send for that pair only — so two unrelated customers with the same failure class still each surface once.

2. **Ack vocabulary**
   - Question: just YES/NO, or also SNOOZE/MUTE/STOP? Case sensitivity?
   - Recommendation: case-insensitive parse.
     - `YES` / `Y` / `RESOLVED` / `DONE` → ack (status=`acked`, send "Resolved." confirmation)
     - `NO` / `N` / `NOTYET` → leave open + schedule midday reminder (send "Noted, will remind at noon." confirmation)
     - `SNOOZE` → push escalation by 4 hours (status=`snoozed`, `snooze_until=now()+4h`, send "Snoozed 4h." confirmation)
     - `STOP` → mute that `alert_class` for 24 hours (status=`muted`, `snooze_until=now()+24h`, send "Muted 24h." confirmation)
     - Anything else → ignore the reply, do **not** reply back (avoid feedback loops with auto-responders)

3. **Escalation channel after N missed acks**
   - Question: what happens if the admin ignores the midday reminder too?
   - Recommendation: Sentry alert + email to the admin email after 2 missed reminders (initial SMS + midday SMS unanswered = ~6+ hours total). The whole point of this system is to NOT go silent; the third channel must use a different transport in case SMS itself is the failure mode.

4. **Multi-admin (`ADMIN_PHONE` / `ADMIN_PHONE_2` / future)**
   - Question: do replies from either phone resolve the same alert? Are alerts duplicated initially or routed?
   - Recommendation: route initial alert to primary `ADMIN_PHONE` only. `ADMIN_PHONE_2` receives the midday escalation if primary hasn't acked. Either phone's `YES` resolves the row. Track who resolved in `brain_alerts.acknowledged_by`.

### Schema additions

```sql
ALTER TABLE brain_alerts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',  -- open | acked | snoozed | escalated | muted
  ADD COLUMN IF NOT EXISTS first_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS snooze_until timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by text,
  ADD COLUMN IF NOT EXISTS dedupe_key text GENERATED ALWAYS AS (alert_class || ':' || phone) STORED;

CREATE INDEX idx_brain_alerts_open_dedupe ON brain_alerts (dedupe_key) WHERE status = 'open';
CREATE INDEX idx_brain_alerts_reminder_due ON brain_alerts (last_reminder_at) WHERE status = 'open' AND reminder_count < 2;
```

### Files to add / change (spec only — do not write code yet)

- `lib/alerts/notify-admin.ts` (NEW helper) — central path. Skips Twilio send if an open row exists for `dedupe_key`. Otherwise inserts/updates `brain_alerts` with `status='open'`, `first_notified_at=now()`, `reminder_count=0`, then sends one SMS that includes the ack instruction. Existing `notifyAdmin()` callers in `lib/services/customer-brain.service.ts` and `lib/services/brain.service.ts` proxy through this helper unchanged at call sites; only the body of `notifyAdmin` changes.
- `app/api/sms/admin-webhook/route.ts` (NEW) — inbound webhook accepting only ADMIN_PHONE / ADMIN_PHONE_2 as `From`. Twilio signature gate. Parses reply, finds the most-recent `open` `brain_alerts` row whose phone-pair was last notified to this admin number, mutates state per the ack vocabulary above, sends a small confirmation SMS.
- `app/api/cron/admin-alert-reminder/route.ts` (NEW) — runs hourly. Selects `brain_alerts WHERE status='open' AND reminder_count < 2 AND last_reminder_at < now() - interval '6 hours'`. Sends midday reminder via primary admin (or `ADMIN_PHONE_2` per question 4 above), increments `reminder_count`. When `reminder_count` reaches 2, mark `status='escalated'` and trigger Sentry + email (escalation channel from question 3).
- `vercel.json` — add hourly cron entry for `admin-alert-reminder`.
- Tests: vitest cases for
  - dedupe (same class+phone twice within open window → 1 SMS, second call inserts no row update except a counter)
  - YES ack flow → `status=acked`, confirmation SMS sent, `acknowledged_by` populated
  - SNOOZE flow → `status=snoozed`, `snooze_until` set, reminder cron skips until `snooze_until` passes
  - STOP flow → `status=muted`, future inserts of same `(class, phone)` skipped for 24h
  - escalation after 2 missed reminders → Sentry + email fired, `status=escalated`

### Risks / mitigations

- **Race:** alert fires while admin is mid-reply; ack lands against wrong row.
  *Mitigate:* ack always targets the *most-recent open row* for that phone-pair (the admin's `From`), not a parsed alert id. If we later need precise targeting, embed a short token in the alert body and require it in the reply.
- **Reply loop:** if a confirmation SMS itself triggers an alert (e.g., its log-insert fails), feedback loop.
  *Mitigate:* hard exclusion on admin phones inside the alert-insertion path. Admin phone numbers must never produce `brain_alerts` rows. Belt-and-suspenders: rate-limit `notify-admin.ts` to N alerts per minute per `dedupe_key` even before the open-row check, so a runaway loop caps at N rather than infinity.
- **Silent failure if Twilio send fails:** alert exists in table but the admin never sees the SMS.
  *Mitigate:* reuse the `withFailClosed` pattern from the P0 commit set; post to Sentry as the last-resort channel before leaving the row dangling. Reminder cron also catches it on the next hourly tick because `last_reminder_at` is null.
- **Twilio inbound config (manual, easy to forget):** the admin Twilio number must have its inbound webhook pointed at `/api/sms/admin-webhook`.
  *Mitigate:* spec the exact URLs and verify as part of the merge checklist.
  - Production: `https://dumpsite.io/api/sms/admin-webhook`
  - Method: POST
  - Twilio number: whichever is configured as the admin `From` for outbound alerts (currently the driver-side `TWILIO_FROM_NUMBER_2` so admin replies don't hit the customer webhook — confirm this still holds)

### Decision required from operator before build

Sign off (or redirect) on each of the 4 recommendations above. Once that's done, this becomes a P0 or P1 implementation commit set on its own branch.
