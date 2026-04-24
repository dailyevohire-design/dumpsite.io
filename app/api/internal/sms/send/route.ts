import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { z } from "zod"
import { createAdminSupabase } from "@/lib/supabase"
import { sendSMSWithAgent } from "@/lib/services/customer-brain.service"

// Internal service-to-service endpoint. Called by the rep-portal manual-order
// flow (filldirtnearme) to send a confirmation SMS through Sarah's Twilio
// infrastructure, scoped by agent so reply routing continues to work.
// Never exposed to end users. Bearer auth only.

const BodySchema = z.object({
  to_e164: z.string().regex(/^\+1\d{10}$/, "to_e164 must be E.164 +1XXXXXXXXXX"),
  body: z.string().min(1).max(1600),
  agent_id: z.string().uuid(),
  purpose: z.enum(["manual_order_confirmation", "manual_order_resend"]),
})

function authorize(req: NextRequest): boolean {
  const token = process.env.INTERNAL_SERVICE_TOKEN
  if (!token) return false
  const header = req.headers.get("authorization")
  if (!header || !header.startsWith("Bearer ")) return false
  const provided = header.slice(7)
  const a = Buffer.from(provided, "utf8")
  const b = Buffer.from(token, "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  try {
    if (!authorize(req)) {
      return NextResponse.json({ sent: false, error: "unauthorized" }, { status: 401 })
    }

    const raw = await req.json().catch(() => ({}))
    const parsed = BodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { sent: false, error: "invalid_body", detail: parsed.error.flatten() },
        { status: 400 },
      )
    }
    const { to_e164, body, agent_id, purpose } = parsed.data

    // Server-side agent resolution — never trust a client-supplied fromNumber.
    const sb = createAdminSupabase()
    const { data: agent } = await sb
      .from("sales_agents")
      .select("id, twilio_number")
      .eq("id", agent_id)
      .eq("active", true)
      .maybeSingle()
    if (!agent) {
      return NextResponse.json({ sent: false, error: "invalid_agent" }, { status: 400 })
    }

    // Opt-out check — single source of truth, scoped by (phone_10, agent_id).
    // Mirrors customer-brain.service.ts exactly: if conv.opted_out=true, no send.
    const phone10 = to_e164.slice(2) // strip leading "+1"
    const { data: conv } = await sb
      .from("customer_conversations")
      .select("opted_out")
      .eq("phone", phone10)
      .eq("agent_id", agent_id)
      .maybeSingle()
    if (conv && (conv as any).opted_out === true) {
      return NextResponse.json({ sent: false, error: "opted_out" }, { status: 200 })
    }

    const sid = `${purpose}_${Date.now()}`
    const fromNumber = `+1${(agent as any).twilio_number}`
    const result = await sendSMSWithAgent(to_e164, body, sid, fromNumber, (agent as any).id)
    if (result.sent) {
      return NextResponse.json({ sent: true, message_sid: result.message_sid }, { status: 200 })
    }
    return NextResponse.json({ sent: false, error: result.error }, { status: 200 })
  } catch (e) {
    console.error("[/api/internal/sms/send] internal_error:", (e as any)?.message)
    return NextResponse.json({ sent: false, error: "internal_error" }, { status: 500 })
  }
}

export function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 })
}
export function PUT() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 })
}
export function DELETE() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 })
}
export function PATCH() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 })
}
