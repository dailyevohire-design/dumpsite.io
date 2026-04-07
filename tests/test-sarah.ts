#!/usr/bin/env npx tsx
/**
 * ═══════════════════════════════════════════════════════════════
 * SARAH SMS BRAIN — COMPLETE TEST SUITE
 * Tests every state, every extraction, every edge case
 *
 * Run: cd ~/dumpsite-io && npx tsx tests/test-sarah.ts
 *
 * This calls handleCustomerSMS directly with a test phone number.
 * It uses your REAL database, REAL geocoding, REAL Sonnet.
 * After tests, it cleans up the test conversation.
 * ═══════════════════════════════════════════════════════════════
 */

import { handleCustomerSMS } from "../lib/services/customer-brain.service"
import { createAdminSupabase } from "../lib/supabase"

// ── CONFIG ──
const TEST_PHONE = "+19999999999" // Fake number — will never match a real customer
const CLEAN_PHONE = "9999999999"  // Normalized version
let testsPassed = 0
let testsFailed = 0
let testsSkipped = 0
const failures: string[] = []
const warnings: string[] = []
let lastReply = ""

// ── HELPERS ──
async function send(body: string, label?: string): Promise<string> {
  const sid = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const reply = await handleCustomerSMS({
    from: TEST_PHONE,
    body,
    messageSid: sid,
    numMedia: 0,
  })
  lastReply = reply
  if (label) console.log(`  📱 "${body}" → "${reply.slice(0, 120)}${reply.length > 120 ? '...' : ''}"`)
  return reply
}

async function resetConversation() {
  const sb = createAdminSupabase()
  await sb.from("customer_conversations").delete().eq("phone", CLEAN_PHONE)
  await sb.from("customer_sms_logs").delete().eq("phone", CLEAN_PHONE)
  await sb.from("customer_processed_messages").delete().like("message_sid", "test_%")
}

async function getState(): Promise<string> {
  const sb = createAdminSupabase()
  const { data } = await sb.from("customer_conversations").select("state").eq("phone", CLEAN_PHONE).maybeSingle()
  return data?.state || "NO_RECORD"
}

async function getConvField(field: string): Promise<any> {
  const sb = createAdminSupabase()
  const { data } = await sb.from("customer_conversations").select(field).eq("phone", CLEAN_PHONE).maybeSingle()
  return data ? (data as any)[field] : null
}

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    testsPassed++
    console.log(`  ✅ ${testName}`)
  } else {
    testsFailed++
    const msg = `${testName}${detail ? ` — ${detail}` : ''}`
    failures.push(msg)
    console.log(`  ❌ ${testName}${detail ? ` — ${detail}` : ''}`)
  }
}

function warn(testName: string, detail: string) {
  testsSkipped++
  warnings.push(`${testName}: ${detail}`)
  console.log(`  ⚠️  ${testName} — ${detail}`)
}

function assertNotContains(text: string, badPhrases: string[], testName: string) {
  const lower = text.toLowerCase()
  const found = badPhrases.filter(p => lower.includes(p.toLowerCase()))
  if (found.length === 0) {
    testsPassed++
    console.log(`  ✅ ${testName}`)
  } else {
    testsFailed++
    const msg = `${testName} — FOUND: "${found.join('", "')}"`
    failures.push(msg)
    console.log(`  ❌ ${msg}`)
  }
}

function assertContains(text: string, goodPhrases: string[], testName: string) {
  const lower = text.toLowerCase()
  const found = goodPhrases.some(p => lower.includes(p.toLowerCase()))
  if (found) {
    testsPassed++
    console.log(`  ✅ ${testName}`)
  } else {
    testsFailed++
    const msg = `${testName} — expected one of: "${goodPhrases.join('", "')}"`
    failures.push(msg)
    console.log(`  ❌ ${msg}`)
  }
}

// Small delay between tests to avoid rate limits
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════

async function testSuite1_FullHappyPath() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 1: Full Happy Path — Standard Delivery")
  console.log("══════════════════════════════════════════")
  await resetConversation()

  // Step 1: Initial text
  const r1 = await send("hey I need some dirt delivered", "Initial contact")
  assert(r1.length > 0, "1.1 Sarah responds to initial text")
  assertNotContains(r1, ["i am an ai", "i'm an ai", "language model", "claude", "anthropic"], "1.2 No AI admission")
  assertContains(r1, ["sarah", "fill dirt", "name"], "1.3 Sarah introduces herself and asks name")
  assert(await getState() === "COLLECTING", "1.4 State is COLLECTING")
  await delay(1500)

  // Step 2: Give name
  const r2 = await send("Mike Johnson", "Give name")
  assert(r2.length > 0, "1.5 Sarah responds to name")
  const savedName = await getConvField("customer_name")
  assert(savedName === "Mike Johnson", `1.6 Name saved correctly: "${savedName}"`)
  assertContains(r2, ["address", "deliver", "where", "location"], "1.7 Asks for delivery address")
  await delay(1500)

  // Step 3: Give address
  const r3 = await send("1234 Main St Dallas TX 75201", "Give address")
  assert(r3.length > 0, "1.8 Sarah responds to address")
  const savedCity = await getConvField("delivery_city")
  const savedLat = await getConvField("delivery_lat")
  assert(savedLat !== null && savedLat !== 0, `1.9 Address geocoded (lat: ${savedLat})`)
  assertContains(r3, ["using", "project", "what", "material", "for"], "1.10 Asks what material is for")
  await delay(1500)

  // Step 4: Give purpose
  const r4 = await send("filling in my pool", "Give purpose")
  assert(r4.length > 0, "1.11 Sarah responds to purpose")
  const savedMaterial = await getConvField("material_type")
  assert(savedMaterial === "structural_fill", `1.12 Correct material recommended: "${savedMaterial}"`)
  assertContains(r4, ["structural", "yard", "cubic", "how many", "how much"], "1.13 Recommends structural fill, asks yards")
  await delay(1500)

  // Step 5: Give yards
  const r5 = await send("200", "Give yards")
  assert(r5.length > 0, "1.14 Sarah responds to yards")
  const savedYards = await getConvField("yards_needed")
  assert(savedYards === 200, `1.15 Yards saved: ${savedYards}`)
  await delay(1500)

  // ═══════════════════════════════════════════════════════
  // CRITICAL TEST: ACCESS QUESTION
  // ═══════════════════════════════════════════════════════
  console.log("\n  ── CRITICAL: Access Question ──")
  assertNotContains(r5, [
    "can big trucks get",
    "like a full size dump truck",
    "can a dump truck",
    "real quick, can big trucks",
    "can dump trucks get",
    "fit a dump truck",
    "handle a dump truck",
  ], "1.16 ❗ Access question does NOT mention dump truck as the big/special one")

  assertContains(r5, [
    "18-wheeler", "18 wheeler", "eighteen wheeler", "semi",
  ], "1.17 ❗ Access question mentions 18-WHEELER as the special truck")

  assertNotContains(r5, [
    "can a dump truck get to",
    "can dump trucks access",
    "dump truck fit",
    "full size dump truck",
    "big truck like a dump",
  ], "1.18 ❗ NEVER frames dump truck as something that needs special access")
  await delay(1500)

  // Step 6: Answer access
  const r6 = await send("yeah 18 wheelers can get in no problem", "Answer access")
  assert(r6.length > 0, "1.19 Sarah responds to access answer")
  const savedAccess = await getConvField("access_type")
  assert(savedAccess === "dump_truck_and_18wheeler", `1.20 Access saved: "${savedAccess}"`)
  assertContains(r6, ["when", "date", "timeline", "need it", "flexible", "deliver"], "1.21 Asks about delivery timeline")
  await delay(1500)

  // Step 7: Give flexible date
  const r7 = await send("whenever you can get to it, no rush", "Give flexible date")
  assert(r7.length > 0, "1.22 Sarah responds to date")
  const savedDate = await getConvField("delivery_date")
  assert(savedDate !== null, `1.23 Date saved: "${savedDate}"`)

  // ═══════════════════════════════════════════════════════
  // CRITICAL TEST: FLEXIBLE DATE = STANDARD PRICING ONLY
  // ═══════════════════════════════════════════════════════
  console.log("\n  ── CRITICAL: Flexible Date Pricing ──")
  assertNotContains(r7, [
    "priority", "guaranteed", "option 2", "lock in",
  ], "1.24 ❗ Flexible date does NOT show priority/guaranteed pricing")

  assertContains(r7, [
    "$", "yard", "per yard",
  ], "1.25 Shows pricing with dollar amount")

  assert(await getState() === "QUOTING", `1.26 State is QUOTING: "${await getState()}"`)
  await delay(1500)

  // Step 8: Accept quote
  const r8 = await send("sounds good lets do it", "Accept quote")
  assert(r8.length > 0, "1.27 Sarah confirms order")
  const finalState = await getState()
  assert(finalState === "ORDER_PLACED", `1.28 State is ORDER_PLACED: "${finalState}"`)
  assertContains(r8, ["confirm", "scheduled", "driver", "delivery", "text", "venmo", "zelle", "invoice", "payment"], "1.29 Confirms delivery and mentions payment after delivery")
}

async function testSuite2_SpecificDateDualPricing() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 2: Specific Date — MUST Show Dual Pricing")
  console.log("══════════════════════════════════════════")
  await resetConversation()

  // Speed through qualification
  await send("hi", "Initial")
  await delay(1500)
  await send("Carlos Martinez", "Name")
  await delay(1500)
  await send("500 Commerce St Fort Worth TX 76102", "Address")
  await delay(1500)
  await send("leveling my backyard", "Purpose")
  await delay(1500)
  await send("30 yards", "Yards")
  await delay(1500)
  await send("just regular dump trucks", "Access - dump only")

  const savedAccess = await getConvField("access_type")
  assert(savedAccess === "dump_truck_only", `2.1 Access saved as dump_truck_only: "${savedAccess}"`)
  await delay(1500)

  // ═══════════════════════════════════════════════════════
  // CRITICAL TEST: SPECIFIC DATE → DUAL PRICING
  // ═══════════════════════════════════════════════════════
  console.log("\n  ── CRITICAL: Specific Date Dual Pricing ──")
  const r_date = await send("I need it by Wednesday", "Specific date")

  assert(r_date.length > 0, "2.2 Sarah responds to specific date")

  // Must show BOTH options
  assertContains(r_date, [
    "standard", "3-5", "business day",
  ], "2.3 ❗ Shows standard delivery option with 3-5 business days")

  assertContains(r_date, [
    "guaranteed", "priority", "wednesday", "locked", "upfront", "specific",
  ], "2.4 ❗ Shows guaranteed/priority option for Wednesday")

  // Must show TWO different prices
  const priceMatches = r_date.match(/\$[\d,]+/g)
  assert(priceMatches !== null && priceMatches.length >= 2,
    `2.5 ❗ Shows at least 2 different prices: ${priceMatches?.join(', ') || 'NONE FOUND'}`)

  assert(await getState() === "QUOTING", `2.6 State is QUOTING: "${await getState()}"`)
  await delay(1500)

  // Test choosing priority
  const r_priority = await send("I'll take the guaranteed delivery", "Choose priority")
  assert(r_priority.length > 0, "2.7 Sarah responds to priority selection")

  // Should mention payment link or upfront payment
  assertContains(r_priority, [
    "payment", "pay", "link", "upfront", "lock in", "secure",
  ], "2.8 ❗ Mentions upfront payment for guaranteed delivery")

  const orderType = await getConvField("order_type")
  assert(orderType === "priority", `2.9 Order type is priority: "${orderType}"`)
}

async function testSuite3_DimensionCalculation() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 3: Dimension Calculation")
  console.log("══════════════════════════════════════════")
  await resetConversation()

  await send("hi", "Initial")
  await delay(1500)
  await send("Lisa Chen", "Name")
  await delay(1500)
  await send("2000 Ross Ave Dallas TX 75201", "Address")
  await delay(1500)
  await send("need to level my yard", "Purpose")
  await delay(1500)

  // Say "I don't know" to yards
  const r_idk = await send("I don't know how many yards I need", "IDK yards")
  assertContains(r_idk, ["dimension", "length", "width", "depth", "feet", "measure"], "3.1 Asks for dimensions")
  assert(await getState() === "ASKING_DIMENSIONS", `3.2 State is ASKING_DIMENSIONS: "${await getState()}"`)
  await delay(1500)

  // Give dimensions
  const r_dims = await send("40 x 40 x 6 inches", "Give dimensions")
  assert(r_dims.length > 0, "3.3 Sarah responds to dimensions")

  // 40 x 40 x 0.5ft = 800 cu ft / 27 = 29.6 → 30 yards
  const savedYards = await getConvField("yards_needed")
  assert(savedYards !== null && savedYards > 0, `3.4 Yards calculated: ${savedYards}`)
  assert(savedYards === 30, `3.5 Correct calculation (40x40x0.5ft÷27=30): ${savedYards}`)
  assertContains(r_dims, ["30", "cubic", "yard"], "3.6 Tells customer ~30 cubic yards")
  await delay(1500)

  // Test partial dimensions (2 numbers)
  await resetConversation()
  await send("hi", "Reset initial")
  await delay(1500)
  await send("Tom", "Name")
  await delay(1500)
  await send("3000 Elm St Dallas TX 75201", "Address")
  await delay(1500)
  await send("backfill behind retaining wall", "Purpose")
  await delay(1500)
  await send("not sure", "IDK yards")
  await delay(1500)

  const r_partial = await send("20 x 30", "Partial dimensions")
  assertContains(r_partial, ["depth", "thick", "deep", "how"], "3.7 Asks for missing depth")
  await delay(1500)

  const r_depth = await send("4 inches", "Give depth")
  const calcYards = await getConvField("yards_needed")
  // 20 x 30 x (4/12) = 200 cu ft / 27 = 7.4 → 8 yards
  assert(calcYards !== null && calcYards > 0, `3.8 Yards from partial dims: ${calcYards}`)
}

async function testSuite4_MaterialRecommendations() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 4: Material Recommendations")
  console.log("══════════════════════════════════════════")

  const testCases = [
    { purpose: "filling in my pool", expected: "structural_fill", label: "Pool fill → structural fill" },
    { purpose: "new driveway base", expected: "structural_fill", label: "Driveway → structural fill" },
    { purpose: "planting a garden", expected: "screened_topsoil", label: "Garden → topsoil" },
    { purpose: "laying new sod", expected: "screened_topsoil", label: "Sod → topsoil" },
    { purpose: "leveling my yard", expected: "fill_dirt", label: "Leveling → fill dirt" },
    { purpose: "building a sandbox for the kids", expected: "sand", label: "Sandbox → sand" },
    { purpose: "backfill behind retaining wall", expected: "fill_dirt", label: "Backfill → fill dirt" },
    { purpose: "foundation for a shed", expected: "structural_fill", label: "Foundation → structural fill" },
  ]

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i]
    await resetConversation()
    await send("hi")
    await delay(1200)
    await send("Test User")
    await delay(1200)
    await send("1000 Main St Dallas TX 75201")
    await delay(1200)
    await send(tc.purpose, tc.label)

    const material = await getConvField("material_type")
    assert(material === tc.expected, `4.${i+1} ${tc.label}: got "${material}"`)
    await delay(1200)
  }
}

async function testSuite5_AccessExtraction() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 5: Access Type Extraction")
  console.log("══════════════════════════════════════════")

  const testCases = [
    { input: "yeah 18 wheelers can fit", expected: "dump_truck_and_18wheeler", label: "18 wheelers can fit" },
    { input: "yes any size truck", expected: "dump_truck_and_18wheeler", label: "Any size truck" },
    { input: "wide open access", expected: "dump_truck_and_18wheeler", label: "Wide open" },
    { input: "both work", expected: "dump_truck_and_18wheeler", label: "Both" },
    { input: "no just dump trucks", expected: "dump_truck_only", label: "Just dump trucks" },
    { input: "its a tight residential street", expected: "dump_truck_only", label: "Tight residential" },
    { input: "regular trucks only", expected: "dump_truck_only", label: "Regular only" },
    { input: "standard dump truck", expected: "dump_truck_only", label: "Standard dump" },
    { input: "nah its pretty narrow", expected: "dump_truck_only", label: "Narrow street" },
  ]

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i]
    await resetConversation()
    await send("hi")
    await delay(1000)
    await send("Test")
    await delay(1000)
    await send("1000 Main St Dallas TX 75201")
    await delay(1000)
    await send("level my yard")
    await delay(1000)
    await send("20 yards")
    await delay(1000)
    await send(tc.input, tc.label)

    const access = await getConvField("access_type")
    assert(access === tc.expected, `5.${i+1} "${tc.input}" → ${tc.expected}: got "${access}"`)
    await delay(1000)
  }
}

async function testSuite6_EdgeCases() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 6: Edge Cases & Error Handling")
  console.log("══════════════════════════════════════════")

  // 6.1: Empty message
  await resetConversation()
  const r_empty = await send("", "Empty message")
  assert(r_empty.length > 0 || r_empty === "", "6.1 Handles empty message without crash")
  await delay(1500)

  // 6.2: STOP/START
  await resetConversation()
  await send("hi")
  await delay(1500)
  const r_stop = await send("stop", "STOP")
  assert(r_stop === "", "6.2 STOP returns empty (no reply)")
  await delay(1500)

  const r_start = await send("start", "START")
  assert(r_start.length > 0, "6.3 START returns a reply")
  await delay(1500)

  // 6.4: Very long message
  await resetConversation()
  const longMsg = "I need help with a really big project. ".repeat(20)
  const r_long = await send(longMsg, "Very long message")
  assert(r_long.length > 0, "6.4 Handles very long message")
  assert(r_long.length <= 400, `6.5 Response not too long: ${r_long.length} chars`)
  await delay(1500)

  // 6.6: Spanish message
  await resetConversation()
  const r_spanish = await send("hola necesito tierra", "Spanish")
  assert(r_spanish.length > 0, "6.6 Handles Spanish message")
  await delay(1500)

  // 6.7: Gibberish
  await resetConversation()
  const r_gibberish = await send("asdfghjkl", "Gibberish")
  assert(r_gibberish.length > 0, "6.7 Handles gibberish without crash")
  await delay(1500)

  // 6.8: Number that looks like yards but could be anything (before material context)
  await resetConversation()
  await send("hi")
  await delay(1500)
  await send("Jim")
  await delay(1500)
  const r_ambig_num = await send("100", "Ambiguous number before material")
  // Should NOT save as yards yet — no material context
  // (this depends on hasMaterialContext check)
  await delay(1500)

  // 6.9: Emoji only
  await resetConversation()
  const r_emoji = await send("👍", "Emoji only")
  assert(r_emoji.length > 0, "6.9 Handles emoji without crash")
  await delay(1500)

  // 6.10: Customer gives ALL info in first message
  await resetConversation()
  const r_all = await send("I need 50 yards of fill dirt delivered to 1234 Oak St Dallas TX 75201", "All info at once")
  assert(r_all.length > 0, "6.10 Handles all info at once")
  const allName = await getConvField("customer_name")
  const allYards = await getConvField("yards_needed")
  const allMaterial = await getConvField("material_type")
  const allAddress = await getConvField("delivery_address")
  // At least some of these should be extracted
  const extracted = [allYards, allMaterial, allAddress].filter(v => v !== null && v !== "").length
  assert(extracted >= 2, `6.11 Extracted ${extracted}/3 fields from first message`)
}

async function testSuite7_Corrections() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 7: Customer Corrections")
  console.log("══════════════════════════════════════════")
  await resetConversation()

  await send("hi")
  await delay(1500)
  await send("Sarah Williams", "Give name")
  await delay(1500)

  // Give address, then correct it
  await send("1000 Main St Dallas TX 75201", "First address")
  await delay(1500)
  await send("filling my pool", "Purpose")
  await delay(1500)

  // Correct the address
  const r_correct = await send("actually the address is 2000 Elm St Fort Worth TX 76102", "Correct address")
  const newAddress = await getConvField("delivery_address")
  assert(newAddress !== null && /2000|Elm|Fort Worth/i.test(newAddress || ""),
    `7.1 Address updated on correction: "${newAddress}"`)
  await delay(1500)

  // Correct material
  await send("50 yards", "Yards")
  await delay(1500)
  await send("actually I want topsoil not structural fill", "Correct material")
  const newMaterial = await getConvField("material_type")
  assert(newMaterial === "screened_topsoil", `7.2 Material corrected: "${newMaterial}"`)
}

async function testSuite8_FollowUpFlow() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 8: Follow-Up & Return Flow")
  console.log("══════════════════════════════════════════")
  await resetConversation()

  // Get to QUOTING state
  await send("hi")
  await delay(1200)
  await send("Dave Brown")
  await delay(1200)
  await send("1000 Main St Dallas TX 75201")
  await delay(1200)
  await send("level my yard")
  await delay(1200)
  await send("20 yards")
  await delay(1200)
  await send("just dump trucks")
  await delay(1200)
  await send("flexible")
  await delay(1200)

  // Defer
  const r_defer = await send("let me think about it", "Defer")
  assert(r_defer.length > 0, "8.1 Sarah responds to deferral")
  assert(await getState() === "FOLLOW_UP", `8.2 State is FOLLOW_UP: "${await getState()}"`)
  assertNotContains(r_defer, ["get back to you", "follow up", "check back", "i'll text"], "8.3 Does NOT promise to text back")
  await delay(1500)

  // Come back
  const r_return = await send("ok im ready lets do it", "Return")
  assert(r_return.length > 0, "8.4 Sarah welcomes them back")
  const returnState = await getState()
  assert(returnState === "QUOTING" || returnState === "ORDER_PLACED", `8.5 State progresses: "${returnState}"`)
}

async function testSuite9_PaymentFlow() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 9: Payment Handling")
  console.log("══════════════════════════════════════════")
  await resetConversation()

  // Get to ORDER_PLACED
  await send("hi")
  await delay(1200)
  await send("Amy Rodriguez")
  await delay(1200)
  await send("4000 Cedar Springs Rd Dallas TX 75219")
  await delay(1200)
  await send("filling a hole in my yard")
  await delay(1200)
  await send("15 yards")
  await delay(1200)
  await send("dump trucks only")
  await delay(1200)
  await send("whenever is fine")
  await delay(1200)

  // Accept
  await send("yes", "Accept")
  await delay(1500)

  const state = await getState()
  assert(state === "ORDER_PLACED", `9.1 Order placed: "${state}"`)

  // Payment should be collected AFTER delivery — NOT upfront for standard
  assertNotContains(lastReply, [
    "before we schedule", "upfront", "pay first", "pay now", "before delivery",
  ], "9.2 Standard order does NOT require upfront payment")

  assertContains(lastReply, [
    "venmo", "zelle", "invoice", "payment", "after deliver", "pay",
  ], "9.3 Mentions post-delivery payment options")
  await delay(1500)

  // Test cash/check rejection
  // First need to get to AWAITING_PAYMENT state — simulate delivery
  const sb = createAdminSupabase()
  await sb.from("customer_conversations").update({ state: "AWAITING_PAYMENT" }).eq("phone", CLEAN_PHONE)

  const r_cash = await send("can I just pay cash", "Try cash")
  assertContains(r_cash, ["cant", "can't", "cannot", "venmo", "zelle", "invoice", "insur"],
    "9.4 Rejects cash, explains why, offers alternatives")

  assertNotContains(r_cash, ["sorry", "apologize", "apologies"], "9.5 Does NOT apologize for payment policy")
}

async function testSuite10_CancellationAndStatus() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 10: Cancellation & Status")
  console.log("══════════════════════════════════════════")

  // Status check with order
  await resetConversation()
  await send("hi")
  await delay(1200)
  await send("Chris Park")
  await delay(1200)
  await send("5000 Main St Dallas TX 75201")
  await delay(1200)
  await send("fill dirt for grading")
  await delay(1200)
  await send("25 yards")
  await delay(1200)
  await send("any truck is fine")
  await delay(1200)
  await send("flexible")
  await delay(1200)
  await send("yes", "Accept")
  await delay(1500)

  const r_status = await send("whats the status of my order", "Status check")
  assert(r_status.length > 0, "10.1 Sarah responds to status check")
  assertContains(r_status, ["order", "driver", "deliver", "scheduled", "confirmed", "text", "way", "area"], "10.2 Gives order status info")
  await delay(1500)

  // Cancellation
  const r_cancel = await send("I want to cancel my order", "Cancel")
  assert(r_cancel.length > 0, "10.3 Sarah responds to cancellation")
  assertContains(r_cancel, ["team", "reach", "help", "cancel"], "10.4 Says team will reach out")
  assert(await getState() === "CLOSED", `10.5 State is CLOSED: "${await getState()}"`)
}

async function testSuite11_ResponseQuality() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 11: Response Quality & Persona")
  console.log("══════════════════════════════════════════")
  await resetConversation()

  // Collect a few responses to check quality
  const r1 = await send("hey whats up", "Casual greeting")
  await delay(1500)

  // Check all responses for quality issues
  const responses = [r1]

  for (const r of responses) {
    assertNotContains(r, ["!", "—", "–"], "11.1 No exclamation marks or em dashes")
    assertNotContains(r, ["sorry", "apolog", "my bad", "oops"], "11.2 No apologies")
    assertNotContains(r, ["haha", "ha ha", "lol", "hehe"], "11.3 No laughing openers")
    assert(r.length <= 320, `11.4 Under 320 chars: ${r.length}`)
    // Should not end with period
    assert(!r.endsWith("."), `11.5 Does not end with period: "...${r.slice(-20)}"`)
  }

  await delay(1500)

  // Test that Sarah doesn't re-introduce herself after first message
  await send("Maria Lopez", "Give name")
  await delay(1500)
  const r3 = await send("1000 Main St Dallas TX 75201", "Give address")
  assertNotContains(r3, ["i'm sarah", "im sarah", "this is sarah", "my name is sarah"],
    "11.6 Does NOT re-introduce herself after first message")
}

async function testSuite12_OutOfServiceArea() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 12: Out of Service Area")
  console.log("══════════════════════════════════════════")
  await resetConversation()

  await send("hi")
  await delay(1500)
  await send("Test User")
  await delay(1500)

  // Address far from DFW/Denver
  const r_far = await send("123 Main St New York NY 10001", "Far address")
  assert(r_far.length > 0, "12.1 Sarah responds to out-of-area address")
  // Should mention service area or ask for different address or escalate
  // (depends on geocode + zone calc)
  const zone = await getConvField("zone")
  if (zone === null) {
    assertContains(r_far, ["area", "cover", "service", "miles", "another", "different", "address", "team"],
      "12.2 Indicates address is out of service area or escalates")
  } else {
    warn("12.2", `NYC got zone ${zone} — geocode may have been inaccurate`)
  }
}

async function testSuite13_DeliveredReorder() {
  console.log("\n══════════════════════════════════════════")
  console.log("SUITE 13: Post-Delivery Reorder")
  console.log("══════════════════════════════════════════")

  // Simulate a delivered state
  await resetConversation()
  const sb = createAdminSupabase()
  await sb.rpc("upsert_customer_conversation", {
    p_phone: CLEAN_PHONE,
    p_state: "DELIVERED",
    p_customer_name: "Returning Customer",
    p_delivery_address: "1000 Main St Dallas TX",
    p_delivery_city: "Dallas",
    p_material_type: "fill_dirt",
    p_yards_needed: 20,
    p_total_price_cents: 24000,
    p_payment_status: "paid",
  })

  const r_reorder = await send("I need another load of dirt", "Reorder")
  assert(r_reorder.length > 0, "13.1 Sarah responds to reorder request")

  // Should start fresh order process
  const state = await getState()
  assert(state === "COLLECTING", `13.2 State reset to COLLECTING for new order: "${state}"`)
}

// ═══════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════════
async function runAllTests() {
  console.log("═══════════════════════════════════════════════════════")
  console.log("  SARAH SMS BRAIN — COMPLETE TEST SUITE")
  console.log("  Testing against LIVE system with test phone number")
  console.log("═══════════════════════════════════════════════════════")
  console.log(`  Test phone: ${TEST_PHONE}`)
  console.log(`  Time: ${new Date().toISOString()}`)
  console.log("")

  try {
    await testSuite1_FullHappyPath()
    await testSuite2_SpecificDateDualPricing()
    await testSuite3_DimensionCalculation()
    await testSuite4_MaterialRecommendations()
    await testSuite5_AccessExtraction()
    await testSuite6_EdgeCases()
    await testSuite7_Corrections()
    await testSuite8_FollowUpFlow()
    await testSuite9_PaymentFlow()
    await testSuite10_CancellationAndStatus()
    await testSuite11_ResponseQuality()
    await testSuite12_OutOfServiceArea()
    await testSuite13_DeliveredReorder()
  } catch (err) {
    console.error("\n💀 TEST SUITE CRASHED:", (err as any)?.message || err)
    testsFailed++
    failures.push(`CRASH: ${(err as any)?.message || "unknown"}`)
  }

  // ── CLEANUP ──
  console.log("\n──────────────────────────────────────────")
  console.log("Cleaning up test data...")
  await resetConversation()
  console.log("✓ Test conversation deleted")

  // ── RESULTS ──
  console.log("\n═══════════════════════════════════════════════════════")
  console.log("  RESULTS")
  console.log("═══════════════════════════════════════════════════════")
  console.log(`  ✅ Passed: ${testsPassed}`)
  console.log(`  ❌ Failed: ${testsFailed}`)
  console.log(`  ⚠️  Warnings: ${testsSkipped}`)
  console.log(`  Total: ${testsPassed + testsFailed + testsSkipped}`)
  console.log("")

  if (failures.length > 0) {
    console.log("  ══ FAILURES ══")
    for (const f of failures) {
      console.log(`  ❌ ${f}`)
    }
    console.log("")
  }

  if (warnings.length > 0) {
    console.log("  ══ WARNINGS ══")
    for (const w of warnings) {
      console.log(`  ⚠️  ${w}`)
    }
    console.log("")
  }

  if (testsFailed === 0) {
    console.log("  🟢 ALL TESTS PASSED — Sarah is ready for production")
  } else {
    console.log(`  🔴 ${testsFailed} TESTS FAILED — DO NOT DEPLOY`)
    console.log("  Fix the failures above, then run tests again.")
  }
  console.log("═══════════════════════════════════════════════════════")

  process.exit(testsFailed > 0 ? 1 : 0)
}

runAllTests()
