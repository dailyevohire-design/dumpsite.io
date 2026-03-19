# CLAUDE.md

## Project Purpose
DumpSite.io is a production-grade dirt logistics marketplace connecting dump truck drivers, contractors, and excavation companies with approved dump sites across DFW — scaling nationally.

The platform must:
- Allow drivers and contractors to sign up and get approved
- Show available jobs by city without exposing exact dump site addresses
- Allow drivers to submit material details, photos, and load info for approval
- Release dump site addresses ONLY via SMS after admin approval — never in the UI
- Track loads, completions, and payouts per driver
- Evolve into automated dispatch, real-time dirt exchange, and AI-driven matching

## This Is Not A Demo
Every decision must be production-grade:
- No hacks, no shortcuts, no demo-level code
- All sensitive data (addresses, banking) must be encrypted
- Security enforced at the API level — never trust the UI
- Every API route must validate auth before doing anything
- Handle errors, edge cases, and race conditions

## Tech Stack
- Next.js 16 (App Router, Turbopack)
- Supabase (Postgres + Auth + Storage + RLS)
- Tailwind (minimal — mostly inline styles)
- Twilio (SMS for dispatch and approvals)
- Sentry (error monitoring)
- Vercel (deployment)
- TypeScript (strict mode)

## Architecture Rules
- `lib/supabase.ts` — browser and admin clients ONLY (no next/headers)
- `lib/supabase.server.ts` — server client using next/headers (API routes only)
- `lib/sms.ts` — all Twilio SMS logic
- `lib/crypto.ts` — AES-256-GCM encryption for addresses and banking
- `lib/services/` — business logic services
- `app/api/` — all API routes, always verify auth first
- Middleware handles RBAC for /admin, /dashboard, /account, /map routes

## Security Rules — Never Break These
- Dump site addresses are NEVER returned in any API response to drivers
- Addresses are sent ONLY via SMS after admin approval
- Banking info (routing/account numbers) must be encrypted at rest
- Admin routes require role === 'admin' or 'superadmin' in user_metadata
- Driver routes require authenticated user with driver role
- Service role key NEVER exposed to client

## Current Priorities
1. Twilio SMS verification (platform depends on it)
2. Middleware deprecation fix (Next.js 16 uses proxy not middleware)
3. Admin realtime notifications (Supabase realtime on load_requests)
4. City selection at signup (drivers defaulting to Dallas — wrong)
5. Automated dispatch testing end to end

## Business Model
- Drivers sign up free (trial tier — limited loads)
- Paid tiers: hauler, pro, elite (more loads, priority dispatch, faster SMS)
- Platform charges per load or subscription
- Dump sites pay to list (future)
- Revenue = margin between what sites pay and what drivers earn

## Product Vision
Become the dominant dirt movement marketplace in the US.
- Start DFW, expand city by city
- Create network effects: more drivers = more sites = more jobs
- Reduce manual dispatch through automation
- Build supply/demand visibility across cities
- Long term: AI matching, automated pricing, real-time exchange

## User Experience Principles
- Mobile-first always — most drivers are on their phones in trucks
- Every screen must work perfectly on a 375px wide screen
- Loading states on every async action — never leave the user wondering
- Clear error messages in plain English — not technical jargon
- Every action must have confirmation feedback (success/error)
- Minimize steps to complete any task — drivers are busy people
- Fast load times — drivers on cell networks, not WiFi

## Code Quality Rules
- Never leave console.log in production code
- Every API route returns consistent JSON: { success: true/false, error?, data? }
- Never expose internal error messages to the client — log them, return generic message
- All database queries must have error handling
- No any types unless absolutely necessary — use proper TypeScript types
- Keep components under 300 lines — split if larger
- Reuse existing patterns — don't invent new ones

## Database Rules
- Never run raw SQL from API routes — use Supabase client
- Always use admin client for writes — never trust client-side inserts
- RLS is a backup — primary security is at the API route level
- Never expose dispatch_orders.client_address to drivers — ever
- Never expose dump_sites exact coordinates or address to unapproved users
- Always paginate large queries — never SELECT * without a limit

## What Success Looks Like
A driver in Fort Worth wakes up, opens DumpSite.io on their phone,
sees a job paying $40/load near them, submits their load request in
under 2 minutes, gets an SMS with the address within the hour, delivers
the dirt, uploads a completion photo, and gets paid. That is the core
loop. Everything we build must make that loop faster, easier, and more
reliable.

## Tone and Communication
This platform serves hardworking truck drivers and contractors.
- UI copy should be direct, confident, and respectful
- No corporate jargon
- Dollar amounts should always be clear and prominent
- Tell drivers exactly what to do next at every step
- Never leave them on a screen with no clear action

## Error Recovery
- If SMS fails, log it and alert admin — never silently fail
- If a payment fails, flag it immediately — driver must know
- If a dispatch has no drivers, alert admin immediately
- All critical failures must appear in Sentry with full context
- Build retry logic for SMS and critical notifications
