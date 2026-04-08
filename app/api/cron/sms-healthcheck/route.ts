import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import twilio from "twilio"


// ─────────────────────────────────────────────────────────
// SMS SYSTEM HEALTHCHECK — runs every 10-15 minutes
// Verifies the entire customer SMS pipeline is functional:
//   1. Supabase connection (read + write)
//   2. Upsert RPC (the function that broke before)
//   3. Anthropic API reachable
//   4. Twilio credentials valid
//   5. Customer webhook route is deployed and responding
// If ANY check fails, admin gets an immediate SMS alert.
// ─────────────────────────────────────────────────────────

const ADMIN_PHONE = (process.env.ADMIN_PHONE || "7134439223").replace(/\D/g, "")
const ADMIN_PHONE_2 = (process.env.ADMIN_PHONE_2 || "").replace(/\D/g, "")
const HEALTHCHECK_PHONE = "0000000000" // Synthetic phone, never a real customer

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const failures: string[] = []
  const sb = createAdminSupabase()

  // ── CHECK 1: Supabase read ──
  try {
    const { error } = await sb.from("customer_conversations").select("phone").limit(1)
    if (error) failures.push(`DB READ: ${error.message}`)
  } catch (e) {
    failures.push(`DB READ THREW: ${(e as any)?.message}`)
  }

  // ── CHECK 2: Upsert RPC (the exact function that broke) ──
  try {
    const { error } = await sb.rpc("upsert_customer_conversation", {
      p_phone: HEALTHCHECK_PHONE, p_state: "CLOSED",
      p_customer_name: "HEALTHCHECK",
    })
    if (error) failures.push(`UPSERT RPC: ${error.message}`)
    else {
      // Verify the write actually persisted
      const { data, error: readErr } = await sb
        .from("customer_conversations")
        .select("state, customer_name")
        .eq("phone", HEALTHCHECK_PHONE)
        .maybeSingle()
      if (readErr) failures.push(`UPSERT VERIFY READ: ${readErr.message}`)
      else if (!data) failures.push("UPSERT VERIFY: Row not found after insert")
      else if (data.state !== "CLOSED" || data.customer_name !== "HEALTHCHECK") {
        failures.push(`UPSERT VERIFY: Wrong data — state=${data.state}, name=${data.customer_name}`)
      }
      // Clean up
      await sb.from("customer_conversations").delete().eq("phone", HEALTHCHECK_PHONE)
    }
  } catch (e) {
    failures.push(`UPSERT RPC THREW: ${(e as any)?.message}`)
  }

  // ── CHECK 3: Dedup RPC ──
  try {
    const testSid = `healthcheck_${Date.now()}`
    const { data, error } = await sb.rpc("check_customer_message", { p_sid: testSid })
    if (error) failures.push(`DEDUP RPC: ${error.message}`)
    else if (data !== true) failures.push(`DEDUP RPC: Expected true, got ${data}`)
    // Clean up
    await sb.from("customer_processed_messages").delete().eq("message_sid", testSid)
  } catch (e) {
    failures.push(`DEDUP RPC THREW: ${(e as any)?.message}`)
  }

  // ── CHECK 4: Anthropic API key present and reachable ──
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      failures.push("ANTHROPIC: API key missing")
    } else {
      // Light check — just verify the key is accepted (small prompt)
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 5,
          messages: [{ role: "user", content: "Reply with just OK" }],
        }),
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "")
        failures.push(`ANTHROPIC: ${resp.status} ${errText.slice(0, 100)}`)
      }
    }
  } catch (e) {
    failures.push(`ANTHROPIC THREW: ${(e as any)?.message}`)
  }

  // ── CHECK 5: Twilio credentials valid ──
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    const customerNum = process.env.CUSTOMER_TWILIO_NUMBER
    if (!sid || !token) {
      failures.push("TWILIO: Missing SID or AUTH_TOKEN")
    } else if (!customerNum) {
      failures.push("TWILIO: CUSTOMER_TWILIO_NUMBER not set")
    } else {
      // Verify credentials by fetching account info (no SMS sent)
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: {
          "Authorization": "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        },
      })
      if (!resp.ok) failures.push(`TWILIO: Auth failed ${resp.status}`)
    }
  } catch (e) {
    failures.push(`TWILIO THREW: ${(e as any)?.message}`)
  }

  // ── CHECK 6: Customer webhook route is deployed ──
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://dumpsite.io"
    const resp = await fetch(`${appUrl}/api/sms/customer-webhook`, {
      method: "GET",
    })
    if (!resp.ok) failures.push(`WEBHOOK ROUTE: GET returned ${resp.status}`)
    else {
      const data = await resp.json().catch(() => null)
      if (!data?.status) failures.push("WEBHOOK ROUTE: Unexpected response")
    }
  } catch (e) {
    failures.push(`WEBHOOK ROUTE THREW: ${(e as any)?.message}`)
  }

  // ── CHECK 7: Recover unsent messages (pending_send older than 30 seconds) ──
  let recovered = 0
  try {
    const thirtySecAgo = new Date(Date.now() - 30000).toISOString()
    const { data: pending } = await sb
      .from("customer_sms_logs")
      .select("phone, body, message_sid, created_at")
      .eq("direction", "pending_send")
      .lt("created_at", thirtySecAgo)
      .limit(10)
    if (pending && pending.length > 0) {
      const customerFrom = process.env.CUSTOMER_TWILIO_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
      const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
      for (const msg of pending) {
        try {
          const toE164 = `+1${msg.phone}`
          await client.messages.create({ body: msg.body, from: customerFrom, to: toE164 })
          // Mark as recovered — delete the pending marker
          await sb.from("customer_sms_logs").delete().eq("message_sid", msg.message_sid)
          // Log the actual send
          await sb.from("customer_sms_logs").insert({
            phone: msg.phone, body: msg.body, direction: "outbound",
            message_sid: `recovered_${msg.message_sid}`,
          })
          recovered++
          console.log(`[HEALTHCHECK] Recovered unsent message to ${msg.phone}`)
        } catch (sendErr) {
          console.error(`[HEALTHCHECK] Recovery send FAILED for ${msg.phone}:`, sendErr)
          failures.push(`RECOVERY SEND FAILED: ${msg.phone}`)
        }
      }
    }
  } catch (e) {
    failures.push(`RECOVERY CHECK THREW: ${(e as any)?.message}`)
  }

  // ── REPORT ──
  if (failures.length > 0) {
    const msg = `SMS SYSTEM HEALTHCHECK FAILED:\n${failures.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nCustomer SMS may not be working. Check immediately.`
    console.error("[HEALTHCHECK]", msg)

    // Alert admin via SMS
    try {
      const adminFrom = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
      if (adminFrom && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
        await client.messages.create({ body: msg.slice(0, 1500), from: adminFrom, to: `+1${ADMIN_PHONE}` })
        if (ADMIN_PHONE_2) {
          try { await client.messages.create({ body: msg.slice(0, 1500), from: adminFrom, to: `+1${ADMIN_PHONE_2}` }) } catch {}
        }
      }
    } catch (alertErr) {
      console.error("[HEALTHCHECK] Could not even send admin alert:", alertErr)
    }

    // Also log to DB
    try {
      await sb.from("customer_sms_logs").insert({
        phone: "system", body: msg.slice(0, 500),
        direction: "error", message_sid: `healthcheck_fail_${Date.now()}`,
      })
    } catch {}

    return NextResponse.json({ status: "FAILED", failures }, { status: 500 })
  }

  console.log(`[HEALTHCHECK] All checks passed${recovered > 0 ? `, recovered ${recovered} unsent messages` : ""}`)
  return NextResponse.json({ status: "OK", checks: 7, recovered, timestamp: new Date().toISOString() })
}
