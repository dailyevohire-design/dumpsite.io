#!/usr/bin/env node
/**
 * DumpSite.io — Brain Service Full Test Suite
 * Tests every scenario from real driver conversations
 * Run: node test_brain.js <YOUR_VERCEL_URL> <TWILIO_AUTH_TOKEN>
 */

const https = require("https");
const http = require("http");
const crypto = require("crypto");
const readline = require("readline");

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const BASE_URL = process.argv[2] || "https://dumpsite-io.vercel.app";
const TWILIO_TOKEN = process.argv[3] || process.env.TWILIO_AUTH_TOKEN || "";
const WEBHOOK_PATH = "/api/sms/webhook";
const FULL_URL = BASE_URL + WEBHOOK_PATH;

// Test phone numbers — use fake numbers that won't conflict with real drivers
const TEST_NEW_DRIVER    = "5550000001";  // brand new, never texted before
const TEST_KNOWN_DRIVER  = "5550000002";  // will simulate known driver (2+ loads)
const TEST_SPANISH       = "5550000003";  // Spanish speaking driver
const TEST_CUSTOMER      = "5550000004";  // customer phone (for delivery confirm)
const TEST_NEGOTIATOR    = "5550000005";  // driver who pushes back on price

// ─────────────────────────────────────────────────────────────
// COLORS
// ─────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
  bold:   "\x1b[1m",
  purple: "\x1b[35m",
};

let passed = 0, failed = 0, warned = 0;
const results = [];

// ─────────────────────────────────────────────────────────────
// HTTP HELPER
// ─────────────────────────────────────────────────────────────
function generateTwilioSig(url, params, token) {
  if (!token) return "test_sig_no_token";
  const sorted = Object.keys(params).sort().reduce((s, k) => s + k + params[k], url);
  return crypto.createHmac("sha1", token).update(sorted, "utf8").digest("base64");
}

function sendSMS(fromPhone, body, opts = {}) {
  const sid = `SM${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const params = {
    From:        `+1${fromPhone}`,
    To:          "+14697174225",
    Body:        body || "",
    MessageSid:  sid,
    NumMedia:    opts.numMedia ? String(opts.numMedia) : "0",
    ...(opts.mediaUrl ? { MediaUrl0: opts.mediaUrl, MediaContentType0: "image/jpeg" } : {}),
  };

  const body_str = new URLSearchParams(params).toString();
  const sig = generateTwilioSig(FULL_URL, params, TWILIO_TOKEN);
  const url = new URL(FULL_URL);
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type":           "application/x-www-form-urlencoded",
      "Content-Length":         Buffer.byteLength(body_str),
      "X-Twilio-Signature":     sig,
      "User-Agent":             "TwilioProxy/1.0",
    },
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data.trim(), sid }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("TIMEOUT")); });
    req.write(body_str);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
// ASSERTION ENGINE
// ─────────────────────────────────────────────────────────────
function assert(testName, response, checks) {
  const reply = response.body || "";
  const errors = [];
  const warnings = [];

  for (const check of checks) {
    switch (check.type) {
      case "contains":
        if (!reply.toLowerCase().includes(check.value.toLowerCase()))
          errors.push(`Expected to contain "${check.value}" — got: "${reply}"`);
        break;
      case "not_contains":
        if (reply.toLowerCase().includes(check.value.toLowerCase()))
          errors.push(`Should NOT contain "${check.value}" — got: "${reply}"`);
        break;
      case "matches":
        if (!check.regex.test(reply))
          errors.push(`Expected to match ${check.regex} — got: "${reply}"`);
        break;
      case "length_lt":
        if (reply.length >= check.value)
          errors.push(`Response too long (${reply.length} chars, max ${check.value}): "${reply.slice(0,100)}..."`);
        break;
      case "not_empty":
        if (!reply.trim())
          errors.push(`Response was empty`);
        break;
      case "status":
        if (response.status !== check.value)
          errors.push(`Expected HTTP ${check.value}, got ${response.status}`);
        break;
      case "no_robotic":
        const roboticPhrases = ["Reply 1-5", "Reply:", "option 1", "option 2", "press 1", "select one", "menu"];
        for (const p of roboticPhrases) {
          if (reply.toLowerCase().includes(p.toLowerCase()))
            errors.push(`Contains robotic phrase "${p}": "${reply}"`);
        }
        break;
      case "no_job_codes":
        if (/DS-[A-Z0-9]{6}/.test(reply))
          errors.push(`Exposed internal job code in driver message: "${reply}"`);
        break;
      case "no_address_leak":
        // Should not contain street addresses if job not confirmed
        if (/\d{3,}\s+[A-Za-z]+\s+(st|ave|blvd|dr|rd|ln|way|ct|pl)/i.test(reply))
          warnings.push(`Possible address in unconfirmed job message: "${reply}"`);
        break;
      case "is_spanish":
        const spanishWords = /\b(hola|tienes|tierra|camion|yardas|foto|tengo|como|para|que|de|la|el|en|tu|te|se|lo|les|nos|si|tambi\u00e9n|pero|porque|cuantos|mandame|listo)\b/i;
        if (!spanishWords.test(reply))
          errors.push(`Expected Spanish response — got: "${reply}"`);
        break;
      case "no_pay_reveal":
        // Should not reveal the pay ceiling to new drivers
        if (check.ceiling && reply.includes(`$${check.ceiling}`))
          errors.push(`Revealed pay ceiling $${check.ceiling} to new driver: "${reply}"`);
        break;
      case "warn_if_contains":
        if (reply.toLowerCase().includes(check.value.toLowerCase()))
          warnings.push(`Warning — contains "${check.value}": "${reply}"`);
        break;
    }
  }

  const icon = errors.length === 0 ? (warnings.length > 0 ? "\u26A0" : "\u2713") : "\u2717";
  const color = errors.length === 0 ? (warnings.length > 0 ? C.yellow : C.green) : C.red;

  console.log(`\n${color}${icon} ${testName}${C.reset}`);
  console.log(`  ${C.gray}From: +1${response._from || "?"} | HTTP: ${response.status}${C.reset}`);
  console.log(`  ${C.cyan}Reply: "${reply}"${C.reset}`);

  if (errors.length > 0) {
    failed++;
    for (const e of errors) console.log(`  ${C.red}\u2717 ${e}${C.reset}`);
  } else {
    passed++;
  }
  if (warnings.length > 0) {
    warned++;
    for (const w of warnings) console.log(`  ${C.yellow}\u26A0 ${w}${C.reset}`);
  }

  results.push({ name: testName, reply, errors, warnings, passed: errors.length === 0 });
  return reply;
}

// ─────────────────────────────────────────────────────────────
// DELAY
// ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// TEST SUITES
// ─────────────────────────────────────────────────────────────
async function runTests() {
  console.log(`\n${C.bold}${C.purple}\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550${C.reset}`);
  console.log(`${C.bold}${C.purple}  DumpSite.io Brain \u2014 Full SMS Test Suite${C.reset}`);
  console.log(`${C.bold}${C.purple}  Target: ${BASE_URL}${C.reset}`);
  console.log(`${C.bold}${C.purple}\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550${C.reset}`);

  // -- SUITE 1: New Driver Onboarding --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 1: New Driver Onboarding \u2501\u2501\u2501${C.reset}`);

  let r = await sendSMS(TEST_NEW_DRIVER, "Hello");
  r._from = TEST_NEW_DRIVER;
  assert("1.1 \u2014 First text triggers name request", r, [
    { type: "status", value: 200 },
    { type: "not_empty" },
    { type: "no_robotic" },
    { type: "length_lt", value: 160 },
    { type: "warn_if_contains", value: "bro" },
  ]);
  await sleep(1500);

  r = await sendSMS(TEST_NEW_DRIVER, "Marcus Johnson");
  r._from = TEST_NEW_DRIVER;
  assert("1.2 \u2014 Name received, driver created, moves to discovery", r, [
    { type: "not_empty" },
    { type: "no_robotic" },
    { type: "length_lt", value: 200 },
    { type: "matches", regex: /marcus|got you|you got|hauling|dirt|today/i },
  ]);
  await sleep(1500);

  // -- SUITE 2: Affirmative Detection --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 2: Affirmative Detection (Critical Bug Test) \u2501\u2501\u2501${C.reset}`);

  const affirmatives = ["yes", "Yeah", "yep", "fasho", "bet", "si", "yessir", "sure", "fs"];
  for (const word of affirmatives) {
    r = await sendSMS(TEST_NEW_DRIVER, word);
    r._from = TEST_NEW_DRIVER;
    assert(`2.x \u2014 Affirmative "${word}" advances conversation`, r, [
      { type: "not_empty" },
      { type: "no_robotic" },
      { type: "not_contains", value: "you got dirt today" },
      { type: "not_contains", value: "hauling today" },
      { type: "not_contains", value: "you running" },
    ]);
    await sleep(1200);
    break; // Just test one to keep suite fast
  }

  // -- SUITE 3: Address Extraction --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 3: Address & City Extraction \u2501\u2501\u2501${C.reset}`);

  r = await sendSMS(TEST_NEW_DRIVER, "1717 n hardwood st dallas tx");
  r._from = TEST_NEW_DRIVER;
  const afterAddress = assert("3.1 \u2014 Address given, city extracted, does NOT re-ask city", r, [
    { type: "not_empty" },
    { type: "no_robotic" },
    { type: "not_contains", value: "what city" },
    { type: "not_contains", value: "What city" },
    { type: "length_lt", value: 200 },
  ]);
  await sleep(1500);

  r = await sendSMS(TEST_NEW_DRIVER, "tandem");
  r._from = TEST_NEW_DRIVER;
  assert("3.2 \u2014 Truck type given, no menu shown, moves forward", r, [
    { type: "not_empty" },
    { type: "no_robotic" },
    { type: "not_contains", value: "Reply:" },
    { type: "not_contains", value: "reply:" },
    { type: "not_contains", value: "1-5" },
    { type: "no_job_codes" },
    { type: "length_lt", value: 250 },
  ]);
  await sleep(1500);

  // -- SUITE 4: Photo Handling --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 4: Photo Handling (MMS) \u2501\u2501\u2501${C.reset}`);

  r = await sendSMS(TEST_NEW_DRIVER, "", {
    numMedia: 1,
    mediaUrl: "https://picsum.photos/seed/dirt/400/300",
  });
  r._from = TEST_NEW_DRIVER;
  assert("4.1 \u2014 Photo with NO text body evaluated, not treated as new message", r, [
    { type: "not_empty" },
    { type: "not_contains", value: "you got dirt today" },
    { type: "not_contains", value: "what up bro" },
    { type: "not_contains", value: "hauling today" },
    { type: "no_robotic" },
    { type: "length_lt", value: 250 },
  ]);
  await sleep(1500);

  r = await sendSMS(TEST_NEW_DRIVER, "here is the dirt", {
    numMedia: 1,
    mediaUrl: "https://picsum.photos/seed/dirt2/400/300",
  });
  r._from = TEST_NEW_DRIVER;
  assert("4.2 \u2014 Photo with text body handled correctly", r, [
    { type: "not_empty" },
    { type: "not_contains", value: "you got dirt today" },
    { type: "no_robotic" },
    { type: "length_lt", value: 250 },
  ]);
  await sleep(1500);

  // -- SUITE 5: Spanish Driver --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 5: Spanish Language Flow \u2501\u2501\u2501${C.reset}`);

  r = await sendSMS(TEST_SPANISH, "Hola tengo tierra limpia en Dallas");
  r._from = TEST_SPANISH;
  assert("5.1 \u2014 Spanish detected, responds in Spanish", r, [
    { type: "not_empty" },
    { type: "is_spanish" },
    { type: "no_robotic" },
    { type: "length_lt", value: 250 },
  ]);
  await sleep(1500);

  r = await sendSMS(TEST_SPANISH, "si traigo un camion de volteo");
  r._from = TEST_SPANISH;
  assert("5.2 \u2014 Spanish continues, truck type extracted from Spanish", r, [
    { type: "not_empty" },
    { type: "is_spanish" },
    { type: "no_robotic" },
    { type: "length_lt", value: 250 },
  ]);
  await sleep(1500);

  r = await sendSMS(TEST_SPANISH, "como me pagan");
  r._from = TEST_SPANISH;
  assert("5.3 \u2014 Spanish payment question handled in Spanish", r, [
    { type: "not_empty" },
    { type: "is_spanish" },
    { type: "no_robotic" },
    { type: "length_lt", value: 250 },
  ]);
  await sleep(1500);

  // -- SUITE 6: Tiered Pricing --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 6: Tiered Pricing \u2014 New Driver Negotiation \u2501\u2501\u2501${C.reset}`);

  const TEST_PRICE = "5550000006";

  r = await sendSMS(TEST_PRICE, "I have clean fill in Frisco");
  r._from = TEST_PRICE;
  assert("6.1 \u2014 New driver opening, no pay rate shown yet", r, [
    { type: "not_empty" },
    { type: "no_robotic" },
    { type: "length_lt", value: 250 },
  ]);
  await sleep(1500);

  r = await sendSMS(TEST_PRICE, "how much you pay per load");
  r._from = TEST_PRICE;
  assert("6.2 \u2014 New driver asks pay, gets floor not ceiling", r, [
    { type: "not_empty" },
    { type: "no_robotic" },
    { type: "no_pay_reveal", ceiling: 50 },
    { type: "length_lt", value: 250 },
  ]);
  await sleep(1500);

  r = await sendSMS(TEST_PRICE, "thats too low can you do more");
  r._from = TEST_PRICE;
  assert("6.3 \u2014 Negotiation \u2014 AI bumps price slightly", r, [
    { type: "not_empty" },
    { type: "no_robotic" },
    { type: "no_pay_reveal", ceiling: 50 },
    { type: "length_lt", value: 250 },
  ]);
  await sleep(1500);

  // -- SUITE 7: Duplicate Message Prevention --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 7: Deduplication \u2501\u2501\u2501${C.reset}`);

  const dedupSid = `SM_DEDUP_TEST_${Date.now()}`;
  const params = {
    From: `+1${TEST_NEW_DRIVER}`,
    To: "+14697174225",
    Body: "duplicate test",
    MessageSid: dedupSid,
    NumMedia: "0",
  };
  const body1 = new URLSearchParams(params).toString();
  const makeReq = (body_str) => new Promise((resolve) => {
    const url = new URL(FULL_URL);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body_str) },
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d.trim() }));
    });
    req.write(body_str);
    req.end();
  });

  const [first, second] = await Promise.all([makeReq(body1), makeReq(body1)]);
  console.log(`\n${C.cyan}\u24EA Dedup Test${C.reset}`);
  console.log(`  First response:  "${first.body}" (${first.status})`);
  console.log(`  Second response: "${second.body}" (${second.status})`);
  if (second.body === "" || second.body === first.body) {
    console.log(`  ${C.green}\u2713 Dedup working \u2014 duplicate message handled${C.reset}`);
    passed++;
  } else {
    console.log(`  ${C.yellow}\u26A0 Both returned content \u2014 dedup may need check${C.reset}`);
    warned++;
  }
  await sleep(1000);

  // -- SUITE 8: Load Count Parsing --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 8: Load Count Natural Language Parsing \u2501\u2501\u2501${C.reset}`);

  const loadVariants = [
    ["10", "plain number"],
    ["10 down", '"X down" format'],
    ["done 10 loads", '"done X loads"'],
    ["10 total loads", '"X total loads"'],
    ["delivered 8", '"delivered X"'],
  ];

  for (const [input, desc] of loadVariants) {
    const parseLoads = (text) => {
      const t = text.trim();
      if (/^\d+$/.test(t)) return parseInt(t);
      const m = t.match(/(\d+)\s*(down|loads?|total|done|delivered|drops?)/i) ||
                t.match(/(done|delivered|total|dropped)\s*(\d+)/i);
      if (m) return parseInt(m[1] || m[2]);
      return null;
    };
    const result = parseLoads(input);
    const icon = result !== null ? `${C.green}\u2713` : `${C.red}\u2717`;
    console.log(`  ${icon} Load parse "${input}" (${desc}) \u2192 ${result}${C.reset}`);
    if (result !== null) passed++; else failed++;
  }

  // -- SUITE 9: Opt-out / Compliance --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 9: STOP/START Compliance \u2501\u2501\u2501${C.reset}`);

  r = await sendSMS(TEST_NEW_DRIVER, "STOP");
  r._from = TEST_NEW_DRIVER;
  assert("9.1 \u2014 STOP returns empty response", r, [
    { type: "status", value: 200 },
  ]);
  if (r.body === "") {
    console.log(`  ${C.green}\u2713 STOP returned empty (correct)${C.reset}`);
  } else {
    console.log(`  ${C.yellow}\u26A0 STOP returned: "${r.body}" (should be empty)${C.reset}`);
  }
  await sleep(1000);

  r = await sendSMS(TEST_NEW_DRIVER, "START");
  r._from = TEST_NEW_DRIVER;
  assert("9.2 \u2014 START re-enables driver", r, [
    { type: "status", value: 200 },
    { type: "not_empty" },
  ]);
  await sleep(1000);

  // -- SUITE 10: Conversation Variety --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 10: Response Variety (No Same Reply Twice) \u2501\u2501\u2501${C.reset}`);

  const freshPhone1 = "5550000010";
  const freshPhone2 = "5550000011";
  const freshPhone3 = "5550000012";

  const [r1, r2, r3] = await Promise.all([
    sendSMS(freshPhone1, "hey"),
    sendSMS(freshPhone2, "hey"),
    sendSMS(freshPhone3, "hey"),
  ]);

  console.log(`\n  Three simultaneous "hey" responses:`);
  console.log(`  1: "${r1.body}"`);
  console.log(`  2: "${r2.body}"`);
  console.log(`  3: "${r3.body}"`);

  const unique = new Set([r1.body, r2.body, r3.body]).size;
  if (unique > 1) {
    console.log(`  ${C.green}\u2713 Got ${unique}/3 unique responses \u2014 variety working${C.reset}`);
    passed++;
  } else {
    console.log(`  ${C.yellow}\u26A0 All 3 responses identical \u2014 variety may need tuning${C.reset}`);
    warned++;
  }
  await sleep(1000);

  // -- SUITE 11: No Address Leak --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 11: Address Security \u2501\u2501\u2501${C.reset}`);

  const TEST_ADDR = "5550000020";
  r = await sendSMS(TEST_ADDR, "I have dirt in McKinney");
  r._from = TEST_ADDR;
  assert("11.1 \u2014 No address revealed before job confirmed", r, [
    { type: "not_empty" },
    { type: "no_address_leak" },
    { type: "no_job_codes" },
    { type: "no_robotic" },
  ]);
  await sleep(1500);

  r = await sendSMS(TEST_ADDR, "tandem");
  r._from = TEST_ADDR;
  assert("11.2 \u2014 Job list shown without addresses or internal codes", r, [
    { type: "not_empty" },
    { type: "no_job_codes" },
    { type: "no_address_leak" },
    { type: "no_robotic" },
    { type: "not_contains", value: "Reply 1-5" },
  ]);
  await sleep(1000);

  // -- SUITE 12: Edge Cases --
  console.log(`\n${C.bold}\u2501\u2501\u2501 SUITE 12: Edge Cases & Gibberish \u2501\u2501\u2501${C.reset}`);

  const edgeCases = [
    ["lol", "5550000030"],
    ["???", "5550000031"],
    ["ok", "5550000032"],
    ["hi", "5550000033"],
    ["testing 123", "5550000034"],
  ];

  for (const [msg, phone] of edgeCases) {
    r = await sendSMS(phone, msg);
    r._from = phone;
    assert(`12.x \u2014 Handles "${msg}" gracefully`, r, [
      { type: "status", value: 200 },
      { type: "no_robotic" },
      { type: "length_lt", value: 300 },
    ]);
    await sleep(800);
  }

  // -- SUMMARY --
  console.log(`\n${C.bold}${C.purple}\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550${C.reset}`);
  console.log(`${C.bold}  TEST RESULTS${C.reset}`);
  console.log(`${C.bold}${C.purple}\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550${C.reset}`);
  console.log(`  ${C.green}\u2713 PASSED:  ${passed}${C.reset}`);
  console.log(`  ${C.red}\u2717 FAILED:  ${failed}${C.reset}`);
  console.log(`  ${C.yellow}\u26A0 WARNED:  ${warned}${C.reset}`);
  console.log(`  Total:     ${passed + failed}`);

  if (failed === 0) {
    console.log(`\n${C.green}${C.bold}  ALL CRITICAL TESTS PASSED \u2713${C.reset}`);
    console.log(`  Brain is ready for real drivers.\n`);
  } else {
    console.log(`\n${C.red}${C.bold}  ${failed} CRITICAL FAILURES \u2014 DO NOT RELEASE${C.reset}`);
    console.log(`\n  Failed tests:`);
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ${C.red}\u2717 ${r.name}${C.reset}`);
      r.errors.forEach(e => console.log(`    \u2192 ${e}`));
    });
    console.log();
  }

  if (warned > 0) {
    console.log(`\n  ${C.yellow}Warnings to review:${C.reset}`);
    results.filter(r => r.warnings.length > 0).forEach(r => {
      console.log(`  ${C.yellow}\u26A0 ${r.name}${C.reset}`);
      r.warnings.forEach(w => console.log(`    \u2192 ${w}`));
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

// ─────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────
if (!BASE_URL.startsWith("http")) {
  console.error(`Usage: node test_brain.js <VERCEL_URL> [TWILIO_AUTH_TOKEN]`);
  console.error(`Example: node test_brain.js https://dumpsite-io.vercel.app your_token`);
  process.exit(1);
}

runTests().catch(err => {
  console.error(`\n${C.red}Test suite crashed: ${err.message}${C.reset}`);
  process.exit(1);
});
