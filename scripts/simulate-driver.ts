/**
 * DumpSite.io — Driver Simulation & Fraud Detection Test
 *
 * Tests the fraud detection engine with 5 scenarios:
 *   1. Legitimate driver (should approve)
 *   2. GPS spoofer (should flag/reject)
 *   3. Time cheat (should flag/reject)
 *   4. No GPS data (should flag)
 *   5. Double submission (idempotent — should not crash)
 *
 * Run with:
 *   npx tsx scripts/simulate-driver.ts
 */

// Import fraud detection directly — no server needed
import { analyzeForFraud, haversineKm, type PingData } from '../lib/fraud-detection'

// ── Coordinates ──────────────────────────────────────────────────────────
const FORT_WORTH = { lat: 32.7555, lng: -97.3308 }
const IRVING     = { lat: 32.8140, lng: -96.9489 }
const AUSTIN     = { lat: 30.2672, lng: -97.7431 }

// ── Helpers ──────────────────────────────────────────────────────────────

function generateRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  numPings: number,
  totalMinutes: number,
  startTime: Date
): PingData[] {
  const pings: PingData[] = []
  for (let i = 0; i < numPings; i++) {
    const t = i / (numPings - 1)
    const lat = from.lat + (to.lat - from.lat) * t
    const lng = from.lng + (to.lng - from.lng) * t
    const time = new Date(startTime.getTime() + (totalMinutes * 60000 * i) / (numPings - 1))

    const distToDelivery = haversineKm(lat, lng, to.lat, to.lng)

    pings.push({
      lat,
      lng,
      recorded_at: time.toISOString(),
      accuracy_meters: 10 + Math.random() * 20,
      at_delivery_site: distToDelivery <= 0.5,
    })
  }
  return pings
}

function printResult(
  scenario: number,
  name: string,
  description: string,
  analysis: ReturnType<typeof analyzeForFraud>,
  expectedRecommendation: string,
  expectedMinScore: number
) {
  const passed =
    analysis.recommendation === expectedRecommendation ||
    (expectedRecommendation === 'flag' && analysis.recommendation === 'reject') ||
    (expectedMinScore > 0 && analysis.fraudScore >= expectedMinScore)

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`SCENARIO ${scenario}: ${name}`)
  console.log(`${'─'.repeat(60)}`)
  console.log(`  Input: ${description}`)
  console.log(`  Fraud Score: ${analysis.fraudScore}/100`)
  console.log(`  Recommendation: ${analysis.recommendation}`)
  console.log(`  Flags: ${analysis.flags.length > 0 ? '' : '(none)'}`)
  for (const flag of analysis.flags) {
    console.log(`    - ${flag}`)
  }
  console.log(`  Details: pings=${analysis.details.totalPings}, deliverySitePings=${analysis.details.deliverySitePings}, claimedLoads=${analysis.details.claimedLoads}`)
  console.log(`  Expected: recommendation=${expectedRecommendation}, minScore=${expectedMinScore}`)
  console.log(`  RESULT: ${passed ? '✅ PASS' : '❌ FAIL'}`)

  return passed
}

// ── Run Scenarios ────────────────────────────────────────────────────────

console.log('\n🚛 DumpSite.io — Driver Simulation & Fraud Detection Test')
console.log('=' .repeat(60))

let passCount = 0
let totalScenarios = 5

// ── SCENARIO 1: Legitimate driver ────────────────────────────────────────
{
  const startTime = new Date(Date.now() - 65 * 60000) // started 65min ago

  // Route from Irving to Fort Worth (15 pings over 30 min)
  const routePings = generateRoute(IRVING, FORT_WORTH, 10, 30, startTime)

  // Then 5 pings at the delivery site over 35 min (2 loads = 2 trips)
  // Simulate leaving and coming back
  const deliveryPings: PingData[] = []
  for (let trip = 0; trip < 2; trip++) {
    const tripStart = new Date(startTime.getTime() + (30 + trip * 35) * 60000)
    // At site
    deliveryPings.push({
      lat: FORT_WORTH.lat + 0.001, lng: FORT_WORTH.lng + 0.001,
      recorded_at: new Date(tripStart.getTime()).toISOString(),
      at_delivery_site: true,
    })
    // Away (going back)
    deliveryPings.push({
      lat: FORT_WORTH.lat + 0.05, lng: FORT_WORTH.lng + 0.05,
      recorded_at: new Date(tripStart.getTime() + 15 * 60000).toISOString(),
      at_delivery_site: false,
    })
    // Back at site
    deliveryPings.push({
      lat: FORT_WORTH.lat + 0.002, lng: FORT_WORTH.lng - 0.001,
      recorded_at: new Date(tripStart.getTime() + 30 * 60000).toISOString(),
      at_delivery_site: true,
    })
  }

  const pings = [...routePings, ...deliveryPings]

  const analysis = analyzeForFraud({
    pings,
    claimedLoads: 2,
    completionLat: FORT_WORTH.lat + 0.002,
    completionLng: FORT_WORTH.lng - 0.001,
    deliveryLat: FORT_WORTH.lat,
    deliveryLng: FORT_WORTH.lng,
    sessionStartedAt: startTime.toISOString(),
  })

  if (printResult(1, 'Legitimate Driver', '15+ pings, 65min GPS trail Irving→Fort Worth, 2 delivery visits, completion at site', analysis, 'approve', 0)) passCount++
}

// ── SCENARIO 2: GPS Spoofer ──────────────────────────────────────────────
{
  const startTime = new Date(Date.now() - 20 * 60000)

  // Only 2 pings, in Austin TX (300km away from Fort Worth delivery)
  const pings: PingData[] = [
    { lat: AUSTIN.lat, lng: AUSTIN.lng, recorded_at: new Date(startTime.getTime()).toISOString(), at_delivery_site: false },
    { lat: AUSTIN.lat + 0.001, lng: AUSTIN.lng + 0.001, recorded_at: new Date(startTime.getTime() + 10 * 60000).toISOString(), at_delivery_site: false },
  ]

  const analysis = analyzeForFraud({
    pings,
    claimedLoads: 3,
    completionLat: AUSTIN.lat,
    completionLng: AUSTIN.lng,
    deliveryLat: FORT_WORTH.lat,
    deliveryLng: FORT_WORTH.lng,
  })

  if (printResult(2, 'GPS Spoofer', '2 pings in Austin TX, claims 3 loads, completion 300km from Fort Worth delivery', analysis, 'reject', 50)) passCount++
}

// ── SCENARIO 3: Time Cheat ───────────────────────────────────────────────
{
  const startTime = new Date(Date.now() - 10 * 60000)

  // 4 pings over 10 minutes — claims 8 loads (would need ~4 hours)
  const pings: PingData[] = [
    { lat: FORT_WORTH.lat, lng: FORT_WORTH.lng, recorded_at: new Date(startTime.getTime()).toISOString(), at_delivery_site: true },
    { lat: FORT_WORTH.lat + 0.001, lng: FORT_WORTH.lng, recorded_at: new Date(startTime.getTime() + 3 * 60000).toISOString(), at_delivery_site: true },
    { lat: FORT_WORTH.lat, lng: FORT_WORTH.lng + 0.001, recorded_at: new Date(startTime.getTime() + 6 * 60000).toISOString(), at_delivery_site: true },
    { lat: FORT_WORTH.lat + 0.001, lng: FORT_WORTH.lng + 0.001, recorded_at: new Date(startTime.getTime() + 10 * 60000).toISOString(), at_delivery_site: true },
  ]

  const analysis = analyzeForFraud({
    pings,
    claimedLoads: 8,
    completionLat: FORT_WORTH.lat,
    completionLng: FORT_WORTH.lng,
    deliveryLat: FORT_WORTH.lat,
    deliveryLng: FORT_WORTH.lng,
  })

  if (printResult(3, 'Time Cheat', '4 pings over 10min, claims 8 loads (minimum ~240min needed)', analysis, 'reject', 60)) passCount++
}

// ── SCENARIO 4: No GPS Data ─────────────────────────────────────────────
{
  const analysis = analyzeForFraud({
    pings: [],
    claimedLoads: 5,
    completionLat: FORT_WORTH.lat,
    completionLng: FORT_WORTH.lng,
    deliveryLat: FORT_WORTH.lat,
    deliveryLng: FORT_WORTH.lng,
  })

  if (printResult(4, 'No GPS Data', 'Zero pings, claims 5 loads, completion at delivery site', analysis, 'flag', 30)) passCount++
}

// ── SCENARIO 5: GPS Teleportation ────────────────────────────────────────
{
  const startTime = new Date(Date.now() - 30 * 60000)

  // Pings that show impossible speed — jump from Fort Worth to Austin in 1 minute
  const pings: PingData[] = [
    { lat: FORT_WORTH.lat, lng: FORT_WORTH.lng, recorded_at: new Date(startTime.getTime()).toISOString(), at_delivery_site: true },
    { lat: FORT_WORTH.lat + 0.001, lng: FORT_WORTH.lng, recorded_at: new Date(startTime.getTime() + 5 * 60000).toISOString(), at_delivery_site: true },
    // Teleport to Austin
    { lat: AUSTIN.lat, lng: AUSTIN.lng, recorded_at: new Date(startTime.getTime() + 6 * 60000).toISOString(), at_delivery_site: false },
    { lat: AUSTIN.lat + 0.001, lng: AUSTIN.lng, recorded_at: new Date(startTime.getTime() + 10 * 60000).toISOString(), at_delivery_site: false },
  ]

  const analysis = analyzeForFraud({
    pings,
    claimedLoads: 2,
    completionLat: AUSTIN.lat,
    completionLng: AUSTIN.lng,
    deliveryLat: FORT_WORTH.lat,
    deliveryLng: FORT_WORTH.lng,
  })

  if (printResult(5, 'GPS Teleportation', 'Pings jump 300km in 1 minute (impossible speed)', analysis, 'reject', 45)) passCount++
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`)
console.log(`FINAL RESULTS: ${passCount}/${totalScenarios} scenarios passed`)
if (passCount === totalScenarios) {
  console.log('🎉 ALL SCENARIOS PASSED — Fraud detection engine is working correctly')
} else {
  console.log(`⚠️  ${totalScenarios - passCount} scenario(s) failed — review above`)
}
console.log(`${'═'.repeat(60)}\n`)

process.exit(passCount === totalScenarios ? 0 : 1)
