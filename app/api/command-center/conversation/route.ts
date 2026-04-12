import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import { requireAdmin } from "@/lib/admin-auth"

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const phone = req.nextUrl.searchParams.get("phone")
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 })

  const sb = createAdminSupabase()

  const [smsResult, convResult] = await Promise.allSettled([
    sb.from("customer_sms_logs")
      .select("id, phone, body, direction, created_at")
      .eq("phone", phone)
      .order("created_at", { ascending: true })
      .limit(200),
    sb.from("customer_conversations")
      .select("*")
      .eq("phone", phone)
      .single()
  ])

  const sms = smsResult.status === "fulfilled" ? smsResult.value.data : []
  const conv = convResult.status === "fulfilled" ? convResult.value.data : null

  return NextResponse.json({ sms, conv })
}
