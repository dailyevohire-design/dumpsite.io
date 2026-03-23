import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const ADMIN_ROLES = new Set(['admin', 'superadmin'])

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  let response = NextResponse.next({ request })

  // Security headers
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: any) {
          cookiesToSet.forEach(({ name, value, options }: any) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()
  const isApiRoute = pathname.startsWith('/api/')

  const userProtected =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/account') ||
    pathname.startsWith('/map') ||
    pathname.startsWith('/contractor')

  if (userProtected && (!user || error)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const adminProtected =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/admin')

  if (adminProtected) {
    if (!user || error) {
      if (isApiRoute) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return NextResponse.redirect(new URL('/login', request.url))
    }
    const role = user.user_metadata?.role as string | undefined
    if (!role || !ADMIN_ROLES.has(role)) {
      if (isApiRoute) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    // Admin session timeout — 4 hours max
    const FOUR_HOURS = 4 * 60 * 60 * 1000
    const sessionAge = Date.now() - new Date(user.last_sign_in_at || user.created_at).getTime()
    if (sessionAge > FOUR_HOURS) {
      if (isApiRoute) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
      return NextResponse.redirect(new URL('/login?reason=session_expired', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/admin/:path*',
    '/dashboard/:path*',
    '/account/:path*',
    '/map/:path*',
    '/contractor/:path*',
  ],
}
