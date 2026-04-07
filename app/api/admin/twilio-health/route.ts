import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin-auth"
import { checkAgentNumberHealth } from "@/lib/services/twilio-number-health"

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const results = await checkAgentNumberHealth()
    const broken = results.filter(r => r.status === "broken")
    return NextResponse.json({
      success: true,
      summary: {
        total: results.length,
        ok: results.filter(r => r.status === "ok").length,
        warn: results.filter(r => r.status === "warn").length,
        broken: broken.length,
      },
      agents: results,
    })
  } catch (e) {
    console.error("[admin/twilio-health] failed:", e)
    return NextResponse.json(
      { success: false, error: (e as any)?.message || "Health check failed" },
      { status: 500 }
    )
  }
}
