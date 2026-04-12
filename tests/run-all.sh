#!/usr/bin/env bash
# Sarah brain master test runner.
# Runs vitest unit+integration, bun E2E flows, and optional promptfoo eval.
# Usage: bash tests/run-all.sh
set -uo pipefail

cd "$(dirname "$0")/.."

PASS=0
FAIL=0

echo "═══════════════════════════════════════════════════════"
echo "  Sarah Brain — Master Test Suite"
echo "═══════════════════════════════════════════════════════"
echo ""

# 1. Vitest: unit tests + lightweight integration (174+ tests, ~10s)
echo "── 1/3 Vitest (unit + light integration) ──"
if npm run test:sarah 2>&1 | tail -5; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
echo ""

# 2. Bun E2E: full conversation flows (requires dev server on :3000)
if curl -sf http://localhost:3000 > /dev/null 2>&1; then
  echo "── 2/3 Bun E2E: test-full-flow.ts (7 scenarios) ──"
  if bun tests/test-full-flow.ts 2>&1 | tail -10; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
  echo ""

  echo "── 2/3 Bun E2E: test-forensic-fixes.ts (7 patterns) ──"
  if bun tests/test-forensic-fixes.ts 2>&1 | tail -10; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
  echo ""
else
  echo "── 2/3 Skipping bun E2E (dev server not running on :3000) ──"
  echo ""
fi

# 3. Promptfoo eval (if config exists)
if [ -f "promptfooconfig.yaml" ]; then
  echo "── 3/3 Promptfoo eval ──"
  if npx promptfoo eval 2>&1 | tail -5; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
  echo ""
else
  echo "── 3/3 Skipping promptfoo (no promptfooconfig.yaml) ──"
  echo ""
fi

# Summary
echo "═══════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
if [ $FAIL -eq 0 ]; then
  echo "  RESULT: ALL PASS ($PASS/$TOTAL suites)"
  echo "═══════════════════════════════════════════════════════"
  exit 0
else
  echo "  RESULT: $FAIL/$TOTAL suites FAILED"
  echo "═══════════════════════════════════════════════════════"
  exit 1
fi
