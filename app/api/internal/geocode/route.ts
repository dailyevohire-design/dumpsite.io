import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { z } from "zod"
import { geocode } from "@/lib/geo/geocode"

// Internal service-to-service endpoint. Called by the rep-portal manual-order
// flow to resolve a delivery address to { lat, lng, city } using the same
// Google Maps + Nominatim pipeline Sarah uses. Bearer auth only.

const BodySchema = z.object({
  address: z.string().min(5).max(500),
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
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
    const raw = await req.json().catch(() => ({}))
    const parsed = BodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", detail: parsed.error.flatten() }, { status: 400 })
    }
    const result = await geocode(parsed.data.address)
    if (!result) {
      return NextResponse.json({ error: "geocode_failed" }, { status: 200 })
    }
    return NextResponse.json(result, { status: 200 })
  } catch (e) {
    console.error("[/api/internal/geocode] internal_error:", (e as any)?.message)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
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
