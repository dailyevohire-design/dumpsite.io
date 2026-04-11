// Test harness for the Claude extractor — runs against real conversations
// Run with: bun tests/test-extractor.ts
import { createClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import "dotenv/config"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const anthropic = new Anthropic()

// Copy of the production prompt — keep in sync with customer-brain.service.ts
const SYS = `You are a structured-data extractor for a dirt delivery dispatcher. You read the full conversation between SARAH (the dispatcher) and the CUSTOMER and output a JSON object describing what is currently known about the customer's order.

CRITICAL RULES:
1. NEVER fabricate data. If a field was not stated, return null.
2. ALWAYS scan the ENTIRE conversation history. If the customer gave their address 10 messages ago, delivery_address MUST contain it.
3. delivery_address: ONLY the street address — strip "Nice to meet you", "Hi", trailing dots/ellipses, "Thanks", sign-offs. Texas FM/CR/RR/SH roads are valid. Combine pieces given across multiple messages into one full address.
4. customer_name: ONLY the actual name. Strip "Saint Augustine grass", "Name : ", city suffixes like ". Valley View TX". If no real name, null.
5. yards_needed: explicit number OR calculated from dimensions (L*W*D/27). Never from "10 loads" alone.
6. material_type: EXACTLY one of fill_dirt | topsoil | screened_topsoil | structural_fill | select_fill | sand | gravel. With underscores. Never a space. Never an array.
7. wants_priority: true for sooner/earlier/rush/asap/today/tomorrow/urgente/lo necesito hoy/para mañana.
8. date_is_flexible: true ONLY for explicit "flexible"/"whenever"/"no rush".
9. date_is_specific: true ONLY for real day/date like "Friday"/"tomorrow"/"12/15".
10. customer_frustrated: true for "I already told you"/"are you AI"/"disregard".
11. language: "es" for Spanish, "en" otherwise.
12. Output ONLY a valid JSON object with no prose or markdown fences.`

async function extract(transcript: string) {
  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    system: SYS,
    messages: [{ role: "user", content: `Conversation:\n${transcript}\n\nExtract the structured state as JSON.` }],
  })
  const text = (resp.content[0] as any).text || ""
  const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim()
  return JSON.parse(json)
}

async function testOne(label: string, phone: string, expectations: Record<string, any>) {
  const { data: sms } = await sb.from("customer_sms_logs").select("direction, body").eq("phone", phone).order("created_at", { ascending: true })
  if (!sms || sms.length === 0) { console.log(`${label}: NO SMS`); return false }
  const transcript = sms.map((s: any) => `${s.direction === "inbound" ? "CUSTOMER" : "SARAH"}: ${s.body || ""}`).join("\n")
  const result = await extract(transcript)

  let passed = true
  const diffs: string[] = []
  for (const [key, expected] of Object.entries(expectations)) {
    const actual = result[key]
    let ok = false
    if (typeof expected === "string" && typeof actual === "string") {
      ok = actual.toLowerCase().includes(expected.toLowerCase())
    } else {
      ok = actual === expected
    }
    if (!ok) { passed = false; diffs.push(`${key}: expected=${JSON.stringify(expected)} got=${JSON.stringify(actual)}`) }
  }
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`)
  if (!passed) diffs.forEach(d => console.log(`  - ${d}`))
  console.log(`  summary: name="${result.customer_name}" addr="${result.delivery_address}" yards=${result.yards_needed} mat=${result.material_type} lang=${result.language}`)
  return passed
}

async function main() {
  console.log("=== EXTRACTOR TEST SUITE ===\n")
  const results: boolean[] = []

  results.push(await testOne("Dario (lost customer — address bug)", "8172431471", {
    customer_name: "Dario",
    delivery_address: "5949 Riverbend",
    customer_frustrated: true,
    language: "en",
  }))

  results.push(await testOne("Johnny Hall (FM 121 address)", "9038196854", {
    customer_name: "Johnny",
    delivery_address: "8149 FM 121",
    yards_needed: 200,
    wants_priority: true,
  }))

  results.push(await testOne("Viswa (dim calc 200yd)", "4693882345", {
    customer_name: "Viswa",
    delivery_address: "752 Jc Maples",
    yards_needed: 200,
    wants_priority: true,
  }))

  results.push(await testOne("Vishal (fort worth)", "8184247394", {
    customer_name: "Vishal",
    delivery_address: "9804",
    material_type: "fill_dirt",
  }))

  results.push(await testOne("Luis (Spanish — full flow)", "9453107347", {
    customer_name: "Luis",
    delivery_address: "13312 Bidgelow",
    yards_needed: 10,
    language: "es",
  }))

  const cjPhone = (await sb.from("customer_conversations").select("phone").ilike("customer_name", "%cj%").limit(1)).data?.[0]?.phone
  if (cjPhone) {
    results.push(await testOne("CJ (greeting prefix bug)", cjPhone, {
      delivery_address: "3607 Carpenter",
    }))
  }

  const robertPhone = (await sb.from("customer_conversations").select("phone").ilike("customer_name", "%saint augustine%").limit(1)).data?.[0]?.phone
  if (robertPhone) {
    results.push(await testOne("Robert (broken name = lawn type)", robertPhone, {
      customer_name: "Robert",
      delivery_address: "1629 deer creek",
    }))
  }

  const passed = results.filter(r => r).length
  console.log(`\n=== ${passed}/${results.length} passed ===`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
