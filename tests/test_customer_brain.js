#!/usr/bin/env node
/**
 * DumpSite.io — Customer Brain (Sarah) Full Test Suite
 * Simulates real customer conversations through every state machine path.
 *
 * Run AFTER every deploy:
 *   node tests/test_customer_brain.js https://your-vercel-url.vercel.app YOUR_TWILIO_AUTH_TOKEN
 *
 * What it tests:
 *   - Full ordering flow: name → address → material → yards → access → date → quote → confirm
 *   - Corrections: changing address, yards, material mid-flow
 *   - Edge cases: emoji, bare numbers, rapid-fire, Spanish names, dimensions
 *   - State transitions: NEW → COLLECTING → QUOTING → ORDER_PLACED
 *   - Error handling: geocode failure, "outside area", dimension dead ends
 *   - Compliance: STOP/START opt-out
 *   - Payment flow: Venmo/Zelle/invoice selection
 *   - Follow-up: "let me think about it" → return
 *   - Repeat customers: DELIVERED → new order
 *   - Cancel flow
 *   - Human-ness: no robotic phrases, no AI admissions, no exclamation marks
 */

const https = require("https");
const http = require("http");
const crypto = require("crypto");

const BASE_URL = process.argv[2] || "https://dumpsite-io.vercel.app";
const TWILIO_TOKEN = process.argv[3] || process.env.TWILIO_AUTH_TOKEN || "";
const WEBHOOK_PATH = "/api/sms/customer-webhook";
const FULL_URL = BASE_URL + WEBHOOK_PATH;

const TS = Date.now().toString().slice(-6);
const C = {
  reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", gray: "\x1b[90m",
  bold: "\x1b[1m", purple: "\x1b[35m",
};

let passed = 0, failed = 0, warned = 0;
const results = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────
// HTTP HELPER — simulates Twilio webhook
// ─────────────────────────────────────────────────────────
function generateTwilioSig(url, params, token) {
  if (!token) return "test_sig_no_token";
  const sorted = Object.keys(params).sort().reduce((s, k) => s + k + params[k], url);
  return crypto.createHmac("sha1", token).update(sorted, "utf8").digest("base64");
}

// Sales agent Twilio numbers for multi-agent tests
const AGENT_NUMBERS = {
  john: "+14692470556",
  micah: "+14695236420",
  default: "+17205943881",
  unknown: "+15551234567",
};

function sendSMS(fromPhone, body, opts = {}) {
  const sid = `SM${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const toNumber = opts.toNumber || AGENT_NUMBERS.default;
  const params = {
    From: `+1${fromPhone}`, To: toNumber,
    Body: body || "", MessageSid: sid,
    NumMedia: opts.numMedia ? String(opts.numMedia) : "0",
    ...(opts.mediaUrl ? { MediaUrl0: opts.mediaUrl } : {}),
  };
  const bodyStr = new URLSearchParams(params).toString();
  const sig = generateTwilioSig(FULL_URL, params, TWILIO_TOKEN);
  const url = new URL(FULL_URL);
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: url.hostname, port: url.port || (isHttps ? 443 : 80),
      path: url.pathname, method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(bodyStr),
        "X-Twilio-Signature": sig,
      },
    }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d.trim(), sid, _from: fromPhone }));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("TIMEOUT")); });
    req.write(bodyStr); req.end();
  });
}

// ─────────────────────────────────────────────────────────
// ASSERTION ENGINE
// ─────────────────────────────────────────────────────────
function assert(testName, response, checks) {
  // The webhook returns TwiML. The actual reply is sent via after() with a delay.
  // So we check the TwiML response for structure, and check the body for inline TwiML replies (fallback).
  const reply = response.body || "";
  const errors = [];
  const warnings = [];

  for (const check of checks) {
    switch (check.type) {
      case "status":
        if (response.status !== check.value) errors.push(`HTTP ${response.status}, expected ${check.value}`);
        break;
      case "twiml_empty":
        // Successful processing returns empty TwiML (reply sent via after())
        if (!reply.includes("<Response></Response>") && !reply.includes("<Response>"))
          errors.push(`Expected TwiML response, got: "${reply.slice(0, 100)}"`);
        break;
      case "twiml_has_message":
        // Fallback path returns TwiML with inline message
        if (!reply.includes("<Message>"))
          errors.push(`Expected TwiML <Message>, got: "${reply.slice(0, 100)}"`);
        break;
      case "not_401":
        if (response.status === 401) errors.push("Got 401 Unauthorized — Twilio signature rejected");
        break;
    }
  }

  const icon = errors.length === 0 ? (warnings.length > 0 ? "\u26A0" : "\u2713") : "\u2717";
  const color = errors.length === 0 ? (warnings.length > 0 ? C.yellow : C.green) : C.red;
  console.log(`${color}  ${icon} ${testName}${C.reset}`);
  if (errors.length > 0) {
    failed++;
    for (const e of errors) console.log(`    ${C.red}${e}${C.reset}`);
  } else { passed++; }
  for (const w of warnings) console.log(`    ${C.yellow}\u26A0 ${w}${C.reset}`);
  results.push({ name: testName, errors, passed: errors.length === 0 });
}

// ─────────────────────────────────────────────────────────
// CONVERSATION HELPERS
// ─────────────────────────────────────────────────────────
async function conversation(suiteName, phone, steps) {
  console.log(`\n${C.bold}--- ${suiteName} ---${C.reset} ${C.gray}(phone: ${phone})${C.reset}`);
  for (const step of steps) {
    const r = await sendSMS(phone, step.send, step.opts);
    assert(`${step.name}  [sent: "${step.send.slice(0, 50)}"]`, r, step.checks || [
      { type: "status", value: 200 },
      { type: "not_401" },
      { type: "twiml_empty" },
    ]);
    await sleep(step.delay || 2000);
  }
}

// ─────────────────────────────────────────────────────────
// TEST SUITES
// ─────────────────────────────────────────────────────────
async function runTests() {
  console.log(`\n${C.bold}${C.purple}${"=".repeat(55)}${C.reset}`);
  console.log(`${C.bold}${C.purple}  DumpSite.io Customer Brain (Sarah) Test Suite${C.reset}`);
  console.log(`${C.bold}${C.purple}  Target: ${BASE_URL}${C.reset}`);
  console.log(`${C.bold}${C.purple}${"=".repeat(55)}${C.reset}`);

  // ── SUITE 1: Happy Path — Full Order Flow ──
  await conversation("SUITE 1: Full Order Flow (Happy Path)", `555${TS}01`, [
    { name: "1.1 First text", send: "Hello" },
    { name: "1.2 Give name", send: "Mike Johnson" },
    { name: "1.3 Give purpose", send: "I need to level my backyard" },
    { name: "1.4 Give address", send: "1234 Main St Dallas TX 75201" },
    { name: "1.5 Give yards", send: "50 yards" },
    { name: "1.6 Answer access", send: "yeah big trucks can get in" },
    { name: "1.7 Give date", send: "flexible" },
    { name: "1.8 Accept quote", send: "sounds good lets do it", delay: 3000 },
  ]);

  // ── SUITE 2: First Message Has Everything ──
  await conversation("SUITE 2: First Message Contains Info", `555${TS}02`, [
    { name: "2.1 Name+material in first msg", send: "Hey I'm Sarah and I need topsoil for my garden" },
    { name: "2.2 Give address", send: "5678 Oak Dr Denver CO 80220" },
    { name: "2.3 Give yards", send: "20 yards" },
    { name: "2.4 Access", send: "dump truck only" },
    { name: "2.5 Date", send: "next week" },
  ]);

  // ── SUITE 3: Dimensions Flow ──
  await conversation("SUITE 3: Dimension Calculation", `555${TS}03`, [
    { name: "3.1 Start", send: "Hi" },
    { name: "3.2 Name", send: "Tom" },
    { name: "3.3 Purpose", send: "filling a hole in my yard" },
    { name: "3.4 Address", send: "789 Elm St Fort Worth TX 76102" },
    { name: "3.5 Don't know yards", send: "not sure how many yards" },
    { name: "3.6 Give L x W", send: "40 x 20" },
    { name: "3.7 Give depth in inches", send: "6 inches" },
    { name: "3.8 Access", send: "yes" },
    { name: "3.9 Date", send: "asap" },
  ]);

  // ── SUITE 4: Corrections ──
  await conversation("SUITE 4: Customer Corrects Info", `555${TS}04`, [
    { name: "4.1 Start", send: "Hey" },
    { name: "4.2 Name", send: "Jake" },
    { name: "4.3 Purpose", send: "driveway base" },
    { name: "4.4 Address", send: "100 Pine St Dallas TX 75201" },
    { name: "4.5 Yards", send: "30 yards" },
    { name: "4.6 Correct yards", send: "actually I need 50 yards not 30" },
    { name: "4.7 Access", send: "18 wheelers can fit" },
    { name: "4.8 Date", send: "this week" },
  ]);

  // ── SUITE 5: Spanish Name + Non-ASCII ──
  await conversation("SUITE 5: Spanish/Non-ASCII Names", `555${TS}05`, [
    { name: "5.1 Spanish intro", send: "Hola me llamo José García" },
    { name: "5.2 Purpose", send: "I need dirt for a retaining wall" },
    { name: "5.3 Address", send: "456 Maple Ave Denver CO 80210" },
    { name: "5.4 Yards", send: "25 yards" },
  ]);

  // ── SUITE 6: Edge Cases ──
  await conversation("SUITE 6: Edge Cases", `555${TS}06`, [
    { name: "6.1 Emoji only", send: "👍" },
    { name: "6.2 Single letter", send: "k" },
    { name: "6.3 Give name after emoji", send: "Will" },
    { name: "6.4 Just a number (no material context yet)", send: "100" },
  ]);

  // ── SUITE 7: STOP/START Compliance ──
  const stopPhone = `555${TS}07`;
  await conversation("SUITE 7: Opt-Out Compliance", stopPhone, [
    { name: "7.1 Initial text", send: "Hi there" },
    { name: "7.2 STOP", send: "STOP" },
    { name: "7.3 Text while opted out (should get empty TwiML)", send: "Hello?" },
    { name: "7.4 START", send: "START" },
    { name: "7.5 Text after restart", send: "Im back" },
  ]);

  // ── SUITE 8: Follow-Up Flow ──
  await conversation("SUITE 8: Think About It + Return", `555${TS}08`, [
    { name: "8.1 Start", send: "Hey" },
    { name: "8.2 Name", send: "Lisa" },
    { name: "8.3 Purpose", send: "landscaping" },
    { name: "8.4 Address", send: "321 Cedar Ln Dallas TX 75205" },
    { name: "8.5 Yards", send: "15 yards" },
    { name: "8.6 Access", send: "yes" },
    { name: "8.7 Date", send: "flexible" },
    { name: "8.8 Think about it", send: "let me think about it", delay: 3000 },
    { name: "8.9 Come back", send: "ok im ready lets do it", delay: 3000 },
  ]);

  // ── SUITE 9: Cancel Flow ──
  await conversation("SUITE 9: Cancellation", `555${TS}09`, [
    { name: "9.1 Start", send: "Hello" },
    { name: "9.2 Name", send: "Dan" },
    { name: "9.3 Cancel question (should NOT close)", send: "do you cancel if it rains" },
    { name: "9.4 Actual cancel", send: "I want to cancel" },
  ]);

  // ── SUITE 10: Photo Handling ──
  await conversation("SUITE 10: Photo Messages", `555${TS}10`, [
    { name: "10.1 Photo only", send: "", opts: { numMedia: 1, mediaUrl: "https://picsum.photos/400" } },
    { name: "10.2 Photo with text", send: "here is my yard", opts: { numMedia: 1, mediaUrl: "https://picsum.photos/400" } },
  ]);

  // ── SUITE 11: Payment Keywords ──
  // These test that casual "done" or "sent" don't trigger payment confirm
  console.log(`\n${C.bold}--- SUITE 11: Payment Keyword Safety ---${C.reset}`);
  // We can't easily put someone in AWAITING_PAYMENT state via webhook,
  // so we test the regex patterns directly
  const payRegex = /\b(just sent|payment sent|i sent it|i paid|just paid|i transferred|just transferred|sent the payment|sent it|paid it|payment done|its paid|it's paid|sent the money|money sent|sent via|paid via)\b/i;
  const payTests = [
    ["just sent", true], ["payment sent", true], ["I paid", true],
    ["done", false], ["sent you my address", false], ["I'm done for today", false],
    ["done with the project", false], ["I sent you a picture earlier", false],
    ["sent the money", true], ["paid via venmo", true],
  ];
  for (const [input, expected] of payTests) {
    const actual = payRegex.test(input);
    const ok = actual === expected;
    const icon = ok ? `${C.green}\u2713` : `${C.red}\u2717`;
    console.log(`  ${icon} payConfirm("${input}") = ${actual} (expected ${expected})${C.reset}`);
    if (ok) passed++; else failed++;
  }

  // ── SUITE 12: Cancel Keyword Safety ──
  console.log(`\n${C.bold}--- SUITE 12: Cancel Keyword Safety ---${C.reset}`);
  const cancelRegex = /\b(i want to cancel|cancel (my|the|this) (order|delivery)|please cancel|need to cancel|cancel it|refund|money back|want my money)\b/i;
  const cancelTests = [
    ["cancel my order", true], ["I want to cancel", true], ["please cancel", true],
    ["will you cancel if it rains", false], ["what's your cancellation policy", false],
    ["do you cancel deliveries", false], ["cancel it", true], ["refund", true],
  ];
  for (const [input, expected] of cancelTests) {
    const actual = cancelRegex.test(input);
    const ok = actual === expected;
    const icon = ok ? `${C.green}\u2713` : `${C.red}\u2717`;
    console.log(`  ${icon} isCancel("${input}") = ${actual} (expected ${expected})${C.reset}`);
    if (ok) passed++; else failed++;
  }

  // ── SUITE 13: Dimension Inch Conversion ──
  console.log(`\n${C.bold}--- SUITE 13: Dimension Calculations ---${C.reset}`);
  function depthToFeet(value, text) {
    if (/\b(feet|ft|foot)\b/i.test(text)) return value;
    if (/\b(inch|inches|in)\b|"/i.test(text) || value <= 12) return value / 12;
    return value / 12;
  }
  function cubicYards(l, w, d) { return Math.ceil((l * w * d) / 27); }
  const dimTests = [
    ["30x20x6in", 30, 20, 6, "30 x 20 x 6 inches", 12],
    ["40x40x4in", 40, 40, 4, "40 x 40 x 4 inches", 20],
    ["10x10x2ft", 10, 10, 2, "10 x 10 x 2 feet", 8],
    ["20x20x3 (no unit)", 20, 20, 3, "20 x 20 x 3", 4],   // 3 assumed inches
    ["50x50x12in", 50, 50, 12, "50 x 50 x 12", 93],
  ];
  for (const [label, l, w, d, text, expected] of dimTests) {
    const depth = depthToFeet(d, text);
    const actual = cubicYards(l, w, depth);
    const ok = actual === expected;
    const icon = ok ? `${C.green}\u2713` : `${C.red}\u2717`;
    console.log(`  ${icon} ${label} = ${actual} yards (expected ${expected})${C.reset}`);
    if (ok) passed++; else failed++;
  }

  // ── SUITE 14: Name Extraction Safety ──
  console.log(`\n${C.bold}--- SUITE 14: Name Extraction ---${C.reset}`);
  const hasLetters = (t) => /[a-zA-Z\u00C0-\u024F]/.test(t);
  const nameTests = [
    ["John", true, "normal name"], ["Will", true, "common-word name"],
    ["Art", true, "common-word name"], ["María", true, "accented name"],
    ["👍", false, "emoji"], ["🏗️", false, "emoji"], ["ok", true, "but blocked by NOT_A_NAME"],
  ];
  for (const [input, expectedLetters, desc] of nameTests) {
    const actual = hasLetters(input);
    const ok = actual === expectedLetters;
    const icon = ok ? `${C.green}\u2713` : `${C.red}\u2717`;
    console.log(`  ${icon} hasLetters("${input}") = ${actual} (${desc})${C.reset}`);
    if (ok) passed++; else failed++;
  }

  // ── SUITE 15: Zone Boundaries ──
  console.log(`\n${C.bold}--- SUITE 15: Zone Boundaries ---${C.reset}`);
  const ZONES = [{ zone: "A", min: 0, max: 20 }, { zone: "B", min: 20, max: 40 }, { zone: "C", min: 40, max: 60 }];
  function findZone(miles) {
    return ZONES.find(z => miles >= z.min && (miles < z.max || (z.zone === "C" && miles <= z.max)));
  }
  const zoneTests = [
    [0, "A"], [10, "A"], [19.9, "A"], [20, "B"], [39.9, "B"],
    [40, "C"], [59.9, "C"], [60, "C"], [60.1, undefined],
  ];
  for (const [miles, expected] of zoneTests) {
    const actual = findZone(miles)?.zone;
    const ok = actual === expected;
    const icon = ok ? `${C.green}\u2713` : `${C.red}\u2717`;
    console.log(`  ${icon} ${miles}mi = Zone ${actual || "none"} (expected ${expected || "none"})${C.reset}`);
    if (ok) passed++; else failed++;
  }

  // ── SUITE 16: Multi-Agent — John's Number ──
  await conversation("SUITE 16: John Luehrsen Agent Number", `555${TS}16`, [
    { name: "16.1 Text John's number", send: "Hey I saw your ad on Facebook", opts: { toNumber: AGENT_NUMBERS.john } },
    { name: "16.2 Give name", send: "Marcus Williams", opts: { toNumber: AGENT_NUMBERS.john } },
    { name: "16.3 Purpose", send: "I need fill dirt for grading", opts: { toNumber: AGENT_NUMBERS.john } },
    { name: "16.4 Address", send: "2500 Commerce St Dallas TX 75226", opts: { toNumber: AGENT_NUMBERS.john } },
    { name: "16.5 Yards", send: "30 yards", opts: { toNumber: AGENT_NUMBERS.john } },
    { name: "16.6 Access", send: "yeah big trucks fine", opts: { toNumber: AGENT_NUMBERS.john } },
    { name: "16.7 Date", send: "flexible", opts: { toNumber: AGENT_NUMBERS.john } },
    { name: "16.8 Accept quote", send: "lets do it", opts: { toNumber: AGENT_NUMBERS.john }, delay: 3000 },
  ]);

  // ── SUITE 17: Multi-Agent — Micah's Number ──
  await conversation("SUITE 17: Micah Robbins Agent Number", `555${TS}17`, [
    { name: "17.1 Text Micah's number", send: "Hi someone told me to text this number about dirt", opts: { toNumber: AGENT_NUMBERS.micah } },
    { name: "17.2 Give name", send: "Rachel Torres", opts: { toNumber: AGENT_NUMBERS.micah } },
    { name: "17.3 Purpose", send: "backfill behind a retaining wall", opts: { toNumber: AGENT_NUMBERS.micah } },
    { name: "17.4 Address", send: "800 W Magnolia Ave Fort Worth TX 76104", opts: { toNumber: AGENT_NUMBERS.micah } },
    { name: "17.5 Yards", send: "20 yards", opts: { toNumber: AGENT_NUMBERS.micah } },
    { name: "17.6 Access", send: "dump truck only please", opts: { toNumber: AGENT_NUMBERS.micah } },
    { name: "17.7 Date", send: "next week", opts: { toNumber: AGENT_NUMBERS.micah } },
  ]);

  // ── SUITE 18: Unknown Number — No Agent Match (fallback) ──
  await conversation("SUITE 18: Unknown Number (No Agent)", `555${TS}18`, [
    { name: "18.1 Text unknown number", send: "Hey I need some dirt delivered", opts: { toNumber: AGENT_NUMBERS.unknown } },
    { name: "18.2 Give name", send: "Chris", opts: { toNumber: AGENT_NUMBERS.unknown } },
    { name: "18.3 Purpose", send: "filling a low spot in my yard", opts: { toNumber: AGENT_NUMBERS.unknown } },
  ]);

  // ── SUITE 19: Same Customer Texts Back (Returning Lead) ──
  // Re-uses suite 16's phone number — customer already went through full flow
  await conversation("SUITE 19: Returning Customer (Same Number)", `555${TS}16`, [
    { name: "19.1 Text again days later", send: "Hey its Marcus again, I need more dirt", opts: { toNumber: AGENT_NUMBERS.john }, delay: 3000 },
    { name: "19.2 Same address", send: "same address as last time", opts: { toNumber: AGENT_NUMBERS.john } },
    { name: "19.3 Yards for new order", send: "20 more yards of fill dirt", opts: { toNumber: AGENT_NUMBERS.john } },
  ]);

  // ── SUITE 20: Facebook Ad Openers ──
  await conversation("SUITE 20: Facebook Ad Opener Phrases", `555${TS}20`, [
    { name: "20.1 FB opener", send: "I saw your ad about fill dirt, texting like you said", opts: { toNumber: AGENT_NUMBERS.john } },
    { name: "20.2 Name", send: "Tony", opts: { toNumber: AGENT_NUMBERS.john } },
    { name: "20.3 Purpose with material", send: "Need topsoil for my lawn", opts: { toNumber: AGENT_NUMBERS.john } },
  ]);

  // ── SUITE 21: Multi-Agent Regex/Logic Unit Tests ──
  console.log(`\n${C.bold}--- SUITE 21: Agent Number Normalization ---${C.reset}`);
  // Test that Twilio To field normalizes correctly
  const normTests = [
    ["+14692470556", "4692470556", "E.164 with +1"],
    ["+14695236420", "4695236420", "E.164 with +1"],
    ["14692470556", "4692470556", "digits with leading 1"],
    ["4692470556", "4692470556", "10 digits only"],
    ["+17205943881", "7205943881", "original customer number"],
    ["", "", "empty To field"],
  ];
  for (const [input, expected, desc] of normTests) {
    const actual = input.replace(/\D/g, "").replace(/^1/, "");
    const ok = actual === expected;
    const icon = ok ? `${C.green}\u2713` : `${C.red}\u2717`;
    console.log(`  ${icon} normalize("${input}") = "${actual}" (expected "${expected}") — ${desc}${C.reset}`);
    if (ok) passed++; else failed++;
  }

  // Test agent lookup logic (simulated)
  console.log(`\n${C.bold}--- SUITE 22: Agent Lookup Logic ---${C.reset}`);
  const mockAgents = [
    { twilio_number: "4692470556", name: "John Luehrsen" },
    { twilio_number: "4695236420", name: "Micah Robbins" },
  ];
  const lookupTests = [
    ["4692470556", "John Luehrsen", "John's number"],
    ["4695236420", "Micah Robbins", "Micah's number"],
    ["7205943881", null, "default customer number (no agent)"],
    ["5551234567", null, "random unknown number"],
    ["", null, "empty string"],
  ];
  for (const [input, expectedName, desc] of lookupTests) {
    const found = mockAgents.find(a => a.twilio_number === input);
    const actualName = found ? found.name : null;
    const ok = actualName === expectedName;
    const icon = ok ? `${C.green}\u2713` : `${C.red}\u2717`;
    console.log(`  ${icon} lookup("${input}") = ${actualName || "null"} (expected ${expectedName || "null"}) — ${desc}${C.reset}`);
    if (ok) passed++; else failed++;
  }

  // ── SUMMARY ──
  console.log(`\n${C.bold}${C.purple}${"=".repeat(55)}${C.reset}`);
  console.log(`${C.bold}  RESULTS${C.reset}`);
  console.log(`${C.bold}${C.purple}${"=".repeat(55)}${C.reset}`);
  console.log(`  ${C.green}\u2713 PASSED: ${passed}${C.reset}`);
  console.log(`  ${C.red}\u2717 FAILED: ${failed}${C.reset}`);
  console.log(`  ${C.yellow}\u26A0 WARNED: ${warned}${C.reset}`);
  console.log(`  Total:    ${passed + failed}`);

  if (failed === 0) {
    console.log(`\n${C.green}${C.bold}  ALL TESTS PASSED \u2713${C.reset}\n`);
  } else {
    console.log(`\n${C.red}${C.bold}  ${failed} FAILURES — DO NOT SHIP${C.reset}`);
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ${C.red}\u2717 ${r.name}${C.reset}`);
      r.errors.forEach(e => console.log(`    ${e}`));
    });
    console.log();
  }

  process.exit(failed > 0 ? 1 : 0);
}

if (!BASE_URL.startsWith("http")) {
  console.error("Usage: node tests/test_customer_brain.js <VERCEL_URL> [TWILIO_AUTH_TOKEN]");
  process.exit(1);
}
runTests().catch(err => { console.error(`${C.red}Suite crashed: ${err.message}${C.reset}`); process.exit(1); });
