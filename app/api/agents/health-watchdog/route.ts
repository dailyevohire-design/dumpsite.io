import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"

// ─────────────────────────────────────────────────────────────────
// SYSTEM HEALTH WATCHDOG — runs every 15 minutes
// Monitors Jesse (driver), Sarah (customer), and Dispatch bridge
// for stuck conversations, data integrity issues, and fulfillment gaps.
// Sends single consolidated SMS alert to admin if issues found.
// ─────────────────────────────────────────────────────────────────

const ADMIN_PHONE = (process.env.ADMIN_PHONE || "5126161820").replace(/\D/g, "")
const FROM = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""

async function sendAlertSMS(body: string) {
  if (process.env.PAUSE_ADMIN_SMS === "true") {
    console.log(`[WATCHDOG SMS PAUSED] ${body.slice(0, 80)}`)
    return
  }

  const rawSid = process.env.TWILIO_ACCOUNT_SID || ""
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN

  let accountSid: string, authKey: string, authSecret: string

  if (rawSid.startsWith("SK")) {
    accountSid = process.env.TWILIO_ACCOUNT_SID_REAL || ""
    authKey = rawSid
    authSecret = apiSecret || ""
  } else if (apiKey && apiSecret) {
    accountSid = rawSid
    authKey = apiKey
    authSecret = apiSecret
  } else if (authToken) {
    accountSid = rawSid
    authKey = rawSid
    authSecret = authToken
  } else {
    console.error("[watchdog] No Twilio auth configured")
    return
  }

  try {
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${authKey}:${authSecret}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: `+1${ADMIN_PHONE}`, From: FROM, Body: body }).toString(),
      }
    )
    const data = await resp.json()
    if (data.error_code) console.error("[watchdog] Twilio error:", data.message)
  } catch (e: any) {
    console.error("[watchdog] SMS send failed:", e.message)
  }
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return new Response("CRON_SECRET not configured", { status: 500 })
  }
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  const sb = createAdminSupabase()
  const now = new Date()
  const timeLabel = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Chicago" })

  // Timestamps
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
  const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString()
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString()
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()

  // ═══ JESSE-SIDE CHECKS (conversations table) ═══

  // 1. Stuck driver conversations — active states, no update for 2+ hours
  const terminalStates = ["CLOSED", "DISCOVERY", "COMPLETED"]
  const { data: stuckDrivers } = await sb.from("conversations")
    .select("phone, state, updated_at")
    .not("state", "in", `(${terminalStates.join(",")})`)
    .lt("updated_at", twoHoursAgo)
    .limit(50)

  // Filter out opted-out drivers via driver_profiles
  let stuckDriverCount = 0
  const stuckDriverPhones: string[] = []
  if (stuckDrivers?.length) {
    const phones = stuckDrivers.map(d => d.phone)
    const { data: profiles } = await sb.from("driver_profiles")
      .select("phone, sms_opted_out")
      .in("phone", phones)
    const optedOut = new Set((profiles || []).filter(p => p.sms_opted_out).map(p => p.phone))
    for (const d of stuckDrivers) {
      if (!optedOut.has(d.phone)) {
        stuckDriverCount++
        if (stuckDriverPhones.length < 3) stuckDriverPhones.push(d.phone.slice(-4))
      }
    }
  }

  // 2. Address leak risk — photo_public_url set but state is NOT past approval
  //    If a driver has a photo stored but isn't in an approved/active state,
  //    the address could have been sent prematurely
  const { data: addrLeaks } = await sb.from("conversations")
    .select("phone, state, photo_public_url")
    .not("photo_public_url", "is", null)
    .not("state", "in", "(ACTIVE,OTW_PENDING,CLOSED,DISCOVERY,COMPLETED)")
    .in("state", ["PHOTO_PENDING", "GETTING_NAME", "ASKING_TRUCK"])
    .limit(20)
  const addrLeakCount = addrLeaks?.length || 0

  // 3. Silent OTW drivers — OTW_PENDING with no update for 30+ min
  const { data: silentOtw } = await sb.from("conversations")
    .select("phone, updated_at")
    .eq("state", "OTW_PENDING")
    .lt("updated_at", thirtyMinAgo)
    .limit(50)
  const silentOtwCount = silentOtw?.length || 0

  // 4. Payment black holes — PAYMENT_METHOD_PENDING or PAYMENT_ACCOUNT_PENDING for 1+ hour
  const { data: paymentStuck } = await sb.from("conversations")
    .select("phone, state, updated_at")
    .in("state", ["PAYMENT_METHOD_PENDING", "PAYMENT_ACCOUNT_PENDING"])
    .lt("updated_at", oneHourAgo)
    .limit(50)
  const paymentStuckCount = paymentStuck?.length || 0

  // ═══ SARAH-SIDE CHECKS (customer_conversations table) ═══

  // 5. Stuck customer conversations — not in terminal state, no update 15+ min
  const customerTerminal = ["CLOSED", "DELIVERED", "ORDER_PLACED", "OUT_OF_AREA"]
  const { data: stuckCustomers } = await sb.from("customer_conversations")
    .select("phone, state, updated_at")
    .not("state", "in", `(${customerTerminal.join(",")})`)
    .eq("opted_out", false)
    .lt("updated_at", fifteenMinAgo)
    .limit(50)
  const stuckCustomerCount = stuckCustomers?.length || 0

  // 6. Quotes sent but no follow-up — QUOTING or FOLLOW_UP state, no update 1+ hour
  //    Means follow-up cron may have failed
  const { data: missedFollowups } = await sb.from("customer_conversations")
    .select("phone, state, updated_at")
    .in("state", ["QUOTING", "FOLLOW_UP"])
    .eq("opted_out", false)
    .lt("updated_at", oneHourAgo)
    .limit(50)
  const missedFollowupCount = missedFollowups?.length || 0

  // 7. Paid but no dispatch order — payment_status = 'paid' but no dispatch_order_id
  //    Money collected, no fulfillment — CRITICAL
  const { data: paidNoOrder } = await sb.from("customer_conversations")
    .select("phone, customer_name, payment_status, dispatch_order_id")
    .eq("payment_status", "paid")
    .eq("opted_out", false)
    .or("dispatch_order_id.is.null,dispatch_order_id.eq.")
    .limit(50)
  const paidNoOrderCount = paidNoOrder?.length || 0

  // ═══ DISPATCH BRIDGE CHECKS (dispatch_orders table) ═══

  // 8. Orphaned orders — dispatching status, no driver claimed, 60+ min, business hours only
  const hour = now.getHours() // server time — close enough to CT for cron
  const isBusinessHours = hour >= 7 && hour < 18
  let orphanedCount = 0
  if (isBusinessHours) {
    const { data: orphaned } = await sb.from("dispatch_orders")
      .select("id, status, drivers_notified, created_at")
      .eq("status", "dispatching")
      .lt("created_at", oneHourAgo)
      .limit(50)

    // An order is orphaned if it's been dispatching but no driver has an active_order_id pointing to it
    if (orphaned?.length) {
      const orderIds = orphaned.map(o => o.id)
      const { data: claimed } = await sb.from("conversations")
        .select("active_order_id")
        .in("active_order_id", orderIds)
      const claimedSet = new Set((claimed || []).map(c => c.active_order_id))
      orphanedCount = orphaned.filter(o => !claimedSet.has(o.id)).length
    }
  }

  // 9. Accepted but ghost driver — driver has active_order_id, state=ACTIVE, no update 30+ min
  const { data: ghostDrivers } = await sb.from("conversations")
    .select("phone, active_order_id, updated_at")
    .eq("state", "ACTIVE")
    .not("active_order_id", "is", null)
    .lt("updated_at", thirtyMinAgo)
    .limit(50)
  const ghostDriverCount = ghostDrivers?.length || 0

  // 10. Delivered but not closed — PAYMENT_METHOD_PENDING/PAYMENT_ACCOUNT_PENDING for 6+ hours
  //     (or completed loads with no payment resolution)
  const { data: unclosed } = await sb.from("conversations")
    .select("phone, state, updated_at")
    .in("state", ["PAYMENT_METHOD_PENDING", "PAYMENT_ACCOUNT_PENDING"])
    .lt("updated_at", sixHoursAgo)
    .limit(50)
  const unclosedCount = unclosed?.length || 0

  // ═══ AGGREGATE + DECIDE ON ALERT ═══

  const jesseIssues = {
    stuck_drivers: stuckDriverCount,
    stuck_driver_phones: stuckDriverPhones,
    addr_leak: addrLeakCount,
    silent_otw: silentOtwCount,
    payment_stuck: paymentStuckCount,
  }
  const sarahIssues = {
    stuck_customers: stuckCustomerCount,
    missed_followups: missedFollowupCount,
    paid_no_order: paidNoOrderCount,
  }
  const dispatchIssues = {
    orphaned_orders: orphanedCount,
    ghost_drivers: ghostDriverCount,
    unclosed_deliveries: unclosedCount,
  }

  const totalIssues =
    stuckDriverCount + addrLeakCount + silentOtwCount + paymentStuckCount +
    stuckCustomerCount + missedFollowupCount + paidNoOrderCount +
    orphanedCount + ghostDriverCount + unclosedCount

  const hasCritical = addrLeakCount > 0 || paidNoOrderCount > 0
  const shouldAlert = hasCritical || totalIssues >= 2

  if (shouldAlert) {
    const phoneList = stuckDriverPhones.length ? ` ...${stuckDriverPhones.join(",")}` : ""
    const msg = [
      `\u{1F6A8} DUMPSITE ALERT [${timeLabel}]`,
      `JESSE SIDE:`,
      `- Stuck drivers: ${stuckDriverCount}${phoneList}`,
      `- ADDR LEAK: ${addrLeakCount}${addrLeakCount > 0 ? " \u26D4 CRITICAL" : ""}`,
      `- Silent OTW: ${silentOtwCount}`,
      `- Payment stuck: ${paymentStuckCount}`,
      `SARAH SIDE:`,
      `- Stuck customers: ${stuckCustomerCount}`,
      `- Missed follow-ups: ${missedFollowupCount}`,
      `- Paid/no order: ${paidNoOrderCount}${paidNoOrderCount > 0 ? " \u26D4 CRITICAL" : ""}`,
      `DISPATCH:`,
      `- Orphaned orders: ${orphanedCount}`,
      `- Ghost drivers: ${ghostDriverCount}`,
      `- Unclosed deliveries: ${unclosedCount}`,
    ].join("\n")

    await sendAlertSMS(msg)
  } else {
    console.log(`[watchdog] Clean run — ${totalIssues} issue(s), no alert sent`)
  }

  // ═══ LOG TO agent_health_logs ═══
  try {
    await sb.from("agent_health_logs").insert({
      checked_at: now.toISOString(),
      jesse_issues: jesseIssues,
      sarah_issues: sarahIssues,
      dispatch_issues: dispatchIssues,
      total_issue_count: totalIssues,
      alert_sent: shouldAlert,
    })
  } catch (e: any) {
    console.error("[watchdog] Failed to log run:", e.message)
  }

  return NextResponse.json({
    success: true,
    total_issues: totalIssues,
    alert_sent: shouldAlert,
    jesse: jesseIssues,
    sarah: sarahIssues,
    dispatch: dispatchIssues,
  })
}
