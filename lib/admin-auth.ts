import { NextResponse } from 'next/server'
import { createServerSupabase } from './supabase.server'

/**
 * Validates the request is from an authenticated admin/superadmin user.
 * Returns the user on success, or a NextResponse error on failure.
 */
export async function requireAdmin(): Promise<
  { user: any; error?: never } | { user?: never; error: NextResponse }
> {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const role = user.user_metadata?.role
  if (role !== 'admin' && role !== 'superadmin') {
    return { error: NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 }) }
  }

  return { user }
}
