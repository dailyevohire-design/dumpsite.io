import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { invalidateAgentCache } from "@/lib/services/customer-brain.service"

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || ""

function checkBearer(req: NextRequest): boolean {
  if (!ADMIN_TOKEN) return false
  const auth = req.headers.get("authorization") || ""
  const expected = `Bearer ${ADMIN_TOKEN}`
  if (auth.length !== expected.length) return false
  try { return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected)) } catch { return false }
}

export async function POST(req: NextRequest) {
  if (!checkBearer(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  invalidateAgentCache()
  return NextResponse.json({ success: true })
}
