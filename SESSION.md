# DumpSite.io — Session Primer
> Auto-generated 2026-04-08T01:51:05.849Z
> Commit: 74a91c2 Move bearer-token admin endpoints to /api/ops to bypass Supabase session proxy

## Stack
- Next.js 16 on Vercel → dumpsite.io
- Supabase: dumpsite-production (agsjodzzjrnqdopysjbb)
- Twilio SMS+Voice: TWILIO_FROM_NUMBER_2 = +14697174225
- Claude Haiku: extraction + responses
- GitHub: dailyevohire-design/dumpsite.io

## Live Stats
- Open orders: 13
- Active drivers: 135
- Active reservations: 0
- Material photos: 11
- Pending payouts: $0
- Conversations: 2

## Open Orders (top 5)
  - Joshua — 24 yds — $45/load
  - Fort Worth — 60 yds — $40/load
  - Fort Worth — 20 yds — $40/load
  - Gordonville — 240 yds — $30/load
  - Sachse — 100 yds — $45/load

## Core Rules — NEVER BREAK THESE
1. Driver pay = dispatch_orders.driver_pay_cents ONLY. Never hardcode. Never expose to driver.
2. Address never sent until customer approves photo
3. Texas drivers always get paid, never charged
4. 500+ yards escalates to admin (7134439223)
5. Phone numbers stored WITHOUT +1 (e.g. 7134439223)
6. dispatch_orders is the central table. dump_sites is EMPTY.

## 7 Subsystem Status

### 1. Extraction Engine — BUILT (lib/services/extraction.service.ts)
Built: intent, city, yards, truck type, material, photo detection, done report, admin commands
Missing: confidence scores, evidence strings, multi-intent conflict handling

### 2. Policy Engine — PARTIAL (inline in sms-dispatch.service.ts)
Built: opt-out, STOP/START, admin commands, customer phone detection
Missing: standalone service, quiet hours, rate limiting, template-bounded responses

### 3. State Machine — BUILT (conversations table)
States: DISCOVERY → ASKING_TRUCK → JOBS_SHOWN → PHOTO_PENDING → APPROVAL_PENDING → ACTIVE → CLOSED
Missing: PAUSED_BAD_SIGNAL, HUMAN_ESCALATION, full non-linear recovery

### 4. Routing Engine — BUILT (lib/services/routing.service.ts)
Built: Haversine 15mi, 30mi fallback, truck family matching, atomic RPC reservation, 30min TTL
Missing: material quality filter, site scoring algorithm

### 5. Approval Engine — BUILT (lib/services/approval.service.ts)
Built: photo download, Supabase storage, MMS to customer, SMS fallback, signed URL, voice call 2min, admin escalation 500+ yds, YES/NO detection, driver notification
Missing: rejection reason parsing, material quality AI assessment

### 6. Delivery Verification — PARTIAL (active job intercept in sms-dispatch.service.ts)
Built: completion phrase detection, bare number catch, load count parsing, payment record, admin alert, address resend
Missing: geofence, GPS tracking, photo at dump site, satisfaction followup, partial delivery tracking

### 7. Billing Engine — PARTIAL (driver_payments table)
Built: payment record on completion, load x pay_per_load calc, pending status
Missing: idempotency on all payments, Stripe Connect, 1099 tracking, Zelle automation

## Conversation Flow
Driver texts → active job intercept (if ACTIVE state)
  → bare number or done/dumped/dropped/finished = completion
  → addy/address/where = resend address
  → else remind of active job
No active job → extraction (Claude Haiku)
  → city detected → ask truck type
  → city + truck → findNearbyJobs (15mi)
  → pick 1-5 → atomicClaimJob (30min TTL)
  → PHOTO_PENDING → send pic
  → download → Supabase → MMS to customer
  → 2min no reply → voice call
  → YES → sendJobLink → address + map link
  → driver texts load count → payment created

## Key Files
- lib/services/sms-dispatch.service.ts — main handler + state machine + active intercept
- lib/services/extraction.service.ts — Claude Haiku extraction
- lib/services/routing.service.ts — proximity + atomic reservation
- lib/services/approval.service.ts — photo + MMS + voice
- app/api/sms/webhook/route.ts — pure Twilio passthrough
- app/api/cron/approval-followup/route.ts — 2min voice cron
- app/job-access/[token]/page.tsx — driver address page

## Juan Texting Style (AI responses must match)
Ultra short. No punctuation at end. Trucker casual.
"Yes sir" | "10.4" | "Ok np" | "Perfect" | "Morning" | "Send pic of dirt" | "Being sent rn" | "Give me hour max" | "3 miles" | "Fs that" | "Got you" | "Whats address your coming from"
