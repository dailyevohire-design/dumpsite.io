import { NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import twilio from "twilio"

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const sb = createAdminSupabase()
  const fifteenMin = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data: stale } = await sb.from("conversations")
    .select("phone, active_order_id, updated_at")
    .eq("state", "ACTIVE").lt("updated_at", fifteenMin)
  if (!stale?.length) return NextResponse.json({ checked: 0 })

  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
  const from = process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER
  let notified = 0
  for (const d of stale) {
    try {
      await client.messages.create({ body: "you on the way", from: from!, to: `+1${d.phone}` })
      await sb.from("sms_logs").insert({ phone: d.phone, body: "you on the way", direction: "outbound", message_sid: `otw_${Date.now()}` })
      notified++
    } catch {}
  }
  return NextResponse.json({ checked: stale.length, notified })
}
