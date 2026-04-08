import { NextRequest, NextResponse } from "next/server"
import { invalidateAgentCache } from "@/lib/services/customer-brain.service"

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || ""

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || ""
  if (!ADMIN_TOKEN || auth !== `Bearer ${ADMIN_TOKEN}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  invalidateAgentCache()
  return NextResponse.json({ success: true })
}
