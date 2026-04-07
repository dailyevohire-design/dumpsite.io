import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { createAdminSupabase } from "@/lib/supabase"

// Mark a pending_action row as resolved. We don't delete the row — flipping
// the direction to "resolved_action" preserves an audit trail of every stuck
// path that ever fired, which is useful for debugging quarry/geocode coverage.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ success: false, error: "missing id" }, { status: 400 })

  const sb = createAdminSupabase()
  const { error } = await sb
    .from("customer_sms_logs")
    .update({ direction: "resolved_action" })
    .eq("id", id)
    .eq("direction", "pending_action")

  if (error) {
    console.error("[pending-actions/resolve] update failed:", error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
