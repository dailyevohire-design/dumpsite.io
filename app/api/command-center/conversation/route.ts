import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import { requireAdmin } from "@/lib/admin-auth"

type Source = "driver" | "customer"

const SOURCE_TABLES: Record<Source, { conv: string; sms: string }> = {
  driver: { conv: "conversations", sms: "sms_logs" },
  customer: { conv: "customer_conversations", sms: "customer_sms_logs" },
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const phone = req.nextUrl.searchParams.get("phone")
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 })

  const sourceParam = req.nextUrl.searchParams.get("source") ?? "customer"
  if (sourceParam !== "driver" && sourceParam !== "customer") {
    return NextResponse.json({ error: "source must be 'driver' or 'customer'" }, { status: 400 })
  }
  const source: Source = sourceParam
  const tables = SOURCE_TABLES[source]

  const sb = createAdminSupabase()

  // Customer side has duplicate rows per phone (multi-agent). Pick canonical row by
  // most-recently-updated. Driver side is unique-per-phone but order+limit(1) is
  // safe for both. Drops .single() which would error on != 1 rows and surface as
  // a swallowed null → React 500 in the page.
  const [smsResult, convResult] = await Promise.allSettled([
    sb.from(tables.sms)
      .select("id, phone, body, direction, created_at")
      .eq("phone", phone)
      .order("created_at", { ascending: true })
      .limit(200),
    sb.from(tables.conv)
      .select("*")
      .eq("phone", phone)
      .order("updated_at", { ascending: false })
      .limit(1),
  ])

  const sms = smsResult.status === "fulfilled" ? (smsResult.value.data || []) : []
  const convList = convResult.status === "fulfilled" ? (convResult.value.data || []) : []
  const conv = convList[0] ?? null

  return NextResponse.json({ sms, conv, source })
}
