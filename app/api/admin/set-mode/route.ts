// Earth Command v4 — flip AI_ACTIVE ↔ HUMAN_ACTIVE on a conversation.
// POST { phone, convType: 'driver'|'customer', mode: 'AI_ACTIVE'|'HUMAN_ACTIVE' }

import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabase } from "@/lib/supabase"
import { requireAdmin } from "@/lib/admin-auth"

type ModeBody = {
  phone?: string
  convType?: "driver" | "customer"
  mode?: "AI_ACTIVE" | "HUMAN_ACTIVE"
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  let body: ModeBody
  try {
    body = (await req.json()) as ModeBody
  } catch {
    return NextResponse.json({ success: false, error: "invalid JSON" }, { status: 400 })
  }

  const { phone, convType, mode } = body
  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ success: false, error: "phone required" }, { status: 400 })
  }
  if (convType !== "driver" && convType !== "customer") {
    return NextResponse.json({ success: false, error: "convType must be 'driver' or 'customer'" }, { status: 400 })
  }
  if (mode !== "AI_ACTIVE" && mode !== "HUMAN_ACTIVE") {
    return NextResponse.json({ success: false, error: "mode must be 'AI_ACTIVE' or 'HUMAN_ACTIVE'" }, { status: 400 })
  }

  try {
    const sb = createAdminSupabase()
    const table = convType === "driver" ? "conversations" : "customer_conversations"
    const { error } = await sb
      .from(table)
      .update({ mode, updated_at: new Date().toISOString() })
      .eq("phone", phone)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "unknown error"
    console.error("[admin/set-mode] fatal:", errMsg)
    return NextResponse.json({ success: false, error: errMsg }, { status: 500 })
  }
}
