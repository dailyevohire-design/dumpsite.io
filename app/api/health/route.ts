import { NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'ADDRESS_ENCRYPTION_KEY',
  'NEXT_PUBLIC_APP_URL',
]

export async function GET() {
  const timestamp = new Date().toISOString()
  const version = process.env.VERCEL_GIT_COMMIT_SHA || 'local'

  // Check env vars — never expose values
  const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v])
  const envVars = missingVars.length === 0
    ? 'all present'
    : `missing: ${missingVars.join(', ')}`

  // Check database connection
  let database: 'connected' | 'error' = 'error'
  try {
    const admin = createAdminSupabase()
    const { error } = await admin.from('cities').select('id').limit(1)
    if (!error) database = 'connected'
  } catch {}

  const status = database === 'error'
    ? 'down'
    : missingVars.length > 0
      ? 'degraded'
      : 'ok'

  const statusCode = status === 'down' ? 503 : 200

  return NextResponse.json(
    { status, timestamp, database, envVars, version },
    { status: statusCode, headers: { 'Cache-Control': 'no-store' } }
  )
}
