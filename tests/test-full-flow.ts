// End-to-end customer flow test harness.
// Runs synthetic customer conversations against the REAL brain code
// (via the /api/sms/customer-webhook Twilio endpoint) and verifies each
// scenario reaches the expected state. Uses +15555550xxx test range so
// no real SMS is sent. Run: bun tests/test-full-flow.ts
import "dotenv/config"

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const WEBHOOK = `${BASE}/api/sms/customer-webhook`

interface Scenario {
  name: string
  phone: string
  messages: string[]
  expect: {
    finalState?: string
    delivery_address?: string
    yards_needed?: number
    material_type?: string
    customer_name?: string
    has_total_price?: boolean
    wants_priority?: boolean
  }
}

const SCENARIOS: Scenario[] = [
  {
    name: "English, happy path, Dallas zone A",
    phone: "+15555550101",
    messages: [
      "hey, need some fill dirt",
      "My name is Mark",
      "1234 Main St, Dallas TX",
      "20 yards for leveling my backyard",
      "standard dump truck",
      "flexible on date",
      "yes let's schedule it",
    ],
    expect: {
      finalState: "ORDER_PLACED",
      customer_name: "Mark",
      yards_needed: 20,
      material_type: "fill_dirt",
      has_total_price: true,
    },
  },
  {
    name: "Texas rural FM road (the Johnny Hall pattern)",
    phone: "+15555550102",
    messages: [
      "I need 50 yards of fill dirt",
      "Johnny Hall",
      "8149 FM 121 Van Alstyne TX",
      "filling a low spot for a shop",
      "18 wheeler can get in",
      "next week is fine",
      "yes schedule it",
    ],
    expect: {
      finalState: "ORDER_PLACED",
      customer_name: "Johnny",
      delivery_address: "8149 FM 121",
      yards_needed: 50,
      has_total_price: true,
    },
  },
  {
    name: "Dario pattern — customer gives address early, never loses it",
    phone: "+15555550103",
    messages: [
      "Hi, looking for clean dirt for my backyard",
      "My name is Dario Garcia",
      "5949 Riverbend Pl Fort Worth 76112",
      "leveling with a slight grade",
      "about 10 yards",
      "standard dump truck",
      "flexible",
      "yes",
    ],
    expect: {
      finalState: "ORDER_PLACED",
      customer_name: "Dario",
      delivery_address: "5949 Riverbend",
      yards_needed: 10,
      has_total_price: true,
    },
  },
  {
    name: "Spanish happy path",
    phone: "+15555550104",
    messages: [
      "necesito tierra para rellenar",
      "me llamo Carlos",
      "1500 Oak Street Dallas TX",
      "20 yardas",
      "para nivelar el terreno",
      "camion estandar",
      "flexible",
      "si",
    ],
    expect: {
      finalState: "ORDER_PLACED",
      customer_name: "Carlos",
      yards_needed: 20,
    },
  },
  {
    name: "Wants it sooner (priority intent)",
    phone: "+15555550105",
    messages: [
      "need dirt asap",
      "Tom",
      "500 Lake View Dr Plano TX",
      "15 yards",
      "filling a hole",
      "dump truck",
      "tomorrow",
    ],
    expect: {
      wants_priority: true,
    },
  },
  {
    name: "Out of area (100mi+)",
    phone: "+15555550106",
    messages: [
      "need fill dirt",
      "Jane",
      "5000 Main St, Austin TX 78701",
      "20 yards",
    ],
    expect: {
      finalState: "OUT_OF_AREA",
    },
  },
  {
    name: "Dimensions only — brain should calculate yards",
    phone: "+15555550107",
    messages: [
      "i need some dirt",
      "Bob",
      "2500 Elm St Fort Worth TX",
      "20 by 30 feet, 2 feet deep",
      "structural fill for shop pad",
      "dump truck",
      "flexible",
      "yes",
    ],
    expect: {
      customer_name: "Bob",
      finalState: "ORDER_PLACED",
    },
  },
]

async function sendMessage(phone: string, body: string): Promise<{ status: number; text: string }> {
  const formData = new URLSearchParams()
  formData.append("From", phone)
  formData.append("To", "+14692470556")
  formData.append("Body", body)
  formData.append("MessageSid", `TEST${Date.now()}${Math.random().toString(36).slice(2, 8)}`)
  formData.append("NumMedia", "0")

  // 45s timeout per message — dev server + extractor call + Sarah response
  // can take 4-8s normally, 20s+ on first compile
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    const resp = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
      signal: controller.signal,
    })
    const text = await resp.text()
    return { status: resp.status, text }
  } finally {
    clearTimeout(timer)
  }
}

async function getConvState(phone: string): Promise<any> {
  const { createClient } = await import("@supabase/supabase-js")
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const phoneDigits = phone.replace(/\D/g, "").replace(/^1/, "")
  const { data } = await sb.from("customer_conversations").select("*").eq("phone", phoneDigits).maybeSingle()
  return data
}

async function clearConv(phone: string): Promise<void> {
  const { createClient } = await import("@supabase/supabase-js")
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const phoneDigits = phone.replace(/\D/g, "").replace(/^1/, "")
  await sb.from("customer_sms_logs").delete().eq("phone", phoneDigits)
  await sb.from("customer_conversations").delete().eq("phone", phoneDigits)
}

async function runScenario(s: Scenario): Promise<{ name: string; passed: boolean; details: string[] }> {
  const details: string[] = []
  try {
    await clearConv(s.phone)
    for (const msg of s.messages) {
      const r = await sendMessage(s.phone, msg)
      if (r.status !== 200) {
        details.push(`send failed: status=${r.status}`)
        return { name: s.name, passed: false, details }
      }
      // Small delay between messages so brain finishes processing
      await new Promise(r => setTimeout(r, 800))
    }
    // Wait a bit for final message processing
    await new Promise(r => setTimeout(r, 1500))
    const conv = await getConvState(s.phone)
    if (!conv) {
      details.push("no conversation found after flow")
      return { name: s.name, passed: false, details }
    }

    let passed = true
    const e = s.expect
    if (e.finalState && conv.state !== e.finalState) {
      passed = false
      details.push(`finalState: expected ${e.finalState}, got ${conv.state}`)
    }
    if (e.customer_name && !(conv.customer_name || "").toLowerCase().includes(e.customer_name.toLowerCase())) {
      passed = false
      details.push(`customer_name: expected ~${e.customer_name}, got ${conv.customer_name}`)
    }
    if (e.delivery_address && !(conv.delivery_address || "").toLowerCase().includes(e.delivery_address.toLowerCase())) {
      passed = false
      details.push(`delivery_address: expected ~${e.delivery_address}, got ${conv.delivery_address}`)
    }
    if (e.yards_needed !== undefined && conv.yards_needed !== e.yards_needed) {
      // Allow rounding
      if (Math.abs((conv.yards_needed || 0) - e.yards_needed) > 2) {
        passed = false
        details.push(`yards_needed: expected ${e.yards_needed}, got ${conv.yards_needed}`)
      }
    }
    if (e.material_type && conv.material_type !== e.material_type) {
      passed = false
      details.push(`material_type: expected ${e.material_type}, got ${conv.material_type}`)
    }
    if (e.has_total_price && !conv.total_price_cents) {
      passed = false
      details.push(`has_total_price: expected a price, got null/0`)
    }
    details.push(`final: state=${conv.state} name=${conv.customer_name} addr=${conv.delivery_address?.slice(0, 40)} yds=${conv.yards_needed} mat=${conv.material_type} price=${conv.total_price_cents ? "$" + (conv.total_price_cents / 100) : "none"}`)
    return { name: s.name, passed, details }
  } catch (e: any) {
    details.push(`threw: ${e.message}`)
    return { name: s.name, passed: false, details }
  }
}

async function main() {
  console.log(`=== FULL CUSTOMER FLOW TEST ===`)
  console.log(`Target: ${WEBHOOK}\n`)

  // Check server is reachable
  try {
    const h = await fetch(`${BASE}/api/health`)
    if (!h.ok) { console.error(`Server not reachable at ${BASE}`); process.exit(1) }
  } catch (e: any) {
    console.error(`Cannot reach ${BASE}: ${e.message}`)
    process.exit(1)
  }

  const results = []
  for (const s of SCENARIOS) {
    console.log(`\nRunning: ${s.name}`)
    const r = await runScenario(s)
    results.push(r)
    console.log(`  ${r.passed ? "PASS" : "FAIL"}`)
    r.details.forEach(d => console.log(`    ${d}`))
  }

  const passed = results.filter(r => r.passed).length
  console.log(`\n=== ${passed}/${results.length} scenarios passed ===`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
