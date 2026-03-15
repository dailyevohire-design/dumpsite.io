import { NextRequest, NextResponse } from 'next/server'
import { adminApproveLoad, adminRejectLoad } from '@/lib/services/load.service'

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; action: string }> }
) {
  const { id: loadId, action } = await context.params

  if (!loadId) {
    return NextResponse.json({ error: 'Load ID required' }, { status: 400 })
  }

  if (action === 'approve') {
    const result = await adminApproveLoad(loadId, 'admin')
    return NextResponse.json(result, { status: result.success ? 200 : 409 })
  }

  if (action === 'reject') {
    let body: any
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    if (!body.reason || body.reason.trim().length < 5) {
      return NextResponse.json({ error: 'Please provide a rejection reason' }, { status: 400 })
    }
    const result = await adminRejectLoad(loadId, 'admin', body.reason)
    return NextResponse.json(result, { status: result.success ? 200 : 409 })
  }

  return NextResponse.json({ error: 'Invalid action. Use approve or reject.' }, { status: 400 })
}
