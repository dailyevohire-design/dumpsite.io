import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { createAdminSupabase } from "@/lib/supabase"
import { createCustomerPaymentCheckout } from "@/lib/services/payment.service"
import twilio from "twilio"

// ─────────────────────────────────────────────────────────
// MANUAL STRIPE PAYMENT LINK RECOVERY
// Used when the automatic Stripe checkout in customer-brain fails and an
// URGENT_STRIPE pending action is flagged. Admin POSTs the phone number,
// we read the priority order details from customer_conversations, generate
// a fresh checkout, and text the customer the link from their original
// agent number so attribution stays intact.
// ─────────────────────────────────────────────────────────

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || ""

function checkBearer(req: NextRequest): boolean {
  if (!ADMIN_TOKEN) return false
  const auth = req.headers.get("authorization") || ""
  const expected = `Bearer ${ADMIN_TOKEN}`
  if (auth.length !== expected.length) return false
  try { return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected)) } catch { return false }
}

export async function POST(req: NextRequest) {
  // Auth: bearer token. This is admin-only — never expose to clients.
  if (!checkBearer(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  let body: { phone?: string; amountCents?: number; description?: string } = {}
  try { body = await req.json() } catch { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }) }
  const phone = (body.phone || "").replace(/\D/g, "").replace(/^1/, "")
  if (!phone || phone.length !== 10) {
    return NextResponse.json({ success: false, error: "Bad phone" }, { status: 400 })
  }

  const sb = createAdminSupabase()
  const { data: conv, error: convErr } = await sb
    .from("customer_conversations")
    .select("*")
    .eq("phone", phone)
    .maybeSingle()
  if (convErr || !conv) {
    return NextResponse.json({ success: false, error: convErr?.message || "No conversation" }, { status: 404 })
  }

  const amountCents = body.amountCents || conv.priority_total_cents || conv.total_price_cents
  if (!amountCents || amountCents <= 0) {
    return NextResponse.json({ success: false, error: "No amount on conversation; pass amountCents" }, { status: 400 })
  }
  const description = body.description
    || `${conv.yards_needed || 10} yards ${conv.material_type || "fill_dirt"}${conv.priority_guaranteed_date ? ` - guaranteed ${conv.priority_guaranteed_date}` : ""}`

  const checkout = await createCustomerPaymentCheckout({
    phone,
    customerName: conv.customer_name || "Customer",
    amountCents,
    description,
    guaranteedDate: conv.priority_guaranteed_date || "",
  })
  if (!checkout.success || !checkout.url) {
    return NextResponse.json({ success: false, error: checkout.error || "Stripe failed" }, { status: 502 })
  }

  // Persist the new session id
  await sb.from("customer_conversations").update({
    state: "AWAITING_PRIORITY_PAYMENT",
    order_type: "priority",
    stripe_session_id: checkout.sessionId,
  }).eq("phone", phone)

  // Text the link from the agent's Twilio number (preserve attribution)
  const fromNumber = conv.source_number
    ? `+1${conv.source_number}`
    : (process.env.CUSTOMER_TWILIO_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || "")
  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
  try {
    const msg = await client.messages.create({
      from: fromNumber,
      to: `+1${phone}`,
      body: `Here's your payment link to lock in ${conv.priority_guaranteed_date || "your delivery"}: ${checkout.url}`,
    })
    await sb.from("customer_sms_logs").insert({
      phone, body: `[manual recovery] Sent payment link ${checkout.url}`,
      direction: "outbound", message_sid: msg.sid || `manual_${Date.now()}`,
    })
    // Mark the URGENT_STRIPE pending action as resolved
    await sb.from("customer_sms_logs")
      .update({ direction: "resolved_action" })
      .eq("phone", phone)
      .eq("direction", "pending_action")
      .like("body", "URGENT_STRIPE%")
    return NextResponse.json({ success: true, sessionId: checkout.sessionId, url: checkout.url })
  } catch (e) {
    return NextResponse.json({ success: false, error: `Twilio: ${(e as any)?.message}`, sessionId: checkout.sessionId, url: checkout.url }, { status: 502 })
  }
}
