# DumpSite.io — Pre-Launch Test Checklist

## 🔴 MUST PASS — Do not launch without these

### Security (run: npm run test:e2e -- --grep "API Security")
- [ ] GET /api/admin/loads returns 401 unauthenticated
- [ ] GET /api/admin/dispatch returns 401 unauthenticated
- [ ] PATCH /api/admin/loads/:id/approve returns 401 unauthenticated
- [ ] PATCH /api/admin/loads/:id/reject returns 401 unauthenticated
- [ ] POST /api/driver/submit-load returns 401 unauthenticated
- [ ] POST /api/driver/complete-load returns 401 unauthenticated
- [ ] PATCH /api/driver/update-profile returns 401 unauthenticated
- [ ] POST /api/webhook/zapier returns 401 without secret

### Auth flows (run: npm run test:e2e -- --grep "Authentication")
- [ ] Driver login redirects to /dashboard
- [ ] Admin login redirects to /admin
- [ ] Unauthenticated /dashboard redirects to /login
- [ ] Unauthenticated /admin redirects to /login
- [ ] Driver visiting /admin redirects to /dashboard
- [ ] Hidden admin link NOT present on homepage
- [ ] Sign out clears session

### Data integrity (run: npm test -- validation)
- [ ] Empty truckCount string rejected (NaN guard)
- [ ] Past haul date rejected
- [ ] truckCount > 50 rejected
- [ ] Missing photo URL rejected
- [ ] tier_id blocked from profile update
- [ ] gps_score blocked from profile update

### Address protection (run: npm test -- failure-scenarios)
- [ ] client_address NOT in driver job query
- [ ] client_address NOT in driver loads query
- [ ] price_quoted_cents NOT in driver query

### Encryption (run: npm test -- crypto)
- [ ] encryptAddress + decryptAddress round-trip succeeds
- [ ] Tampered authTag throws error
- [ ] Missing encryption key throws error

### Business logic (run: npm test -- load-service)
- [ ] Trial driver at limit is blocked
- [ ] Driver with 5 pending requests is blocked
- [ ] Caliche flagged as requires_extra_review
- [ ] trial_loads_used increments after submission

### Abuse prevention (run: npm test -- abuse)
- [ ] Driver cannot inflate payout via client body
- [ ] loadsDelivered > 200 is rejected
- [ ] tier_id stripped from profile update
- [ ] Duplicate zapier_row_id does not re-dispatch

## 🟠 SHOULD PASS before launch

### Mobile (run: npm run test:e2e -- --project=mobile-chrome)
- [ ] Homepage readable on Pixel 7
- [ ] Login form usable on mobile
- [ ] Photo upload area meets 44px tap target
- [ ] Tab buttons meet 44px tap target
- [ ] Date input works on iOS Safari

### Admin workflows
- [ ] Reject requires reason (validation)
- [ ] Approve shows success message
- [ ] Load list renders without crash

## How to run

\`\`\`bash
# Install test dependencies
npm install

# Unit + integration tests
npm test

# E2E tests (requires dev server running)
npm run dev &
npm run test:e2e

# Specific test file
npx vitest run tests/unit/crypto.test.ts

# Specific E2E spec
npx playwright test tests/e2e/api-security.spec.ts

# Coverage report
npm run test:coverage
\`\`\`

## Test environment variables needed for E2E

\`\`\`
TEST_DRIVER_EMAIL=test-driver@dumpsite.io
TEST_DRIVER_PASS=testpass123!
TEST_ADMIN_EMAIL=test-admin@dumpsite.io
TEST_ADMIN_PASS=adminpass123!
BASE_URL=http://localhost:3000
\`\`\`

Create these test accounts in Supabase before running E2E tests.
