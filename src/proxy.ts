import { NextResponse, type NextRequest } from 'next/server'

// '/api/cron' is here because a scheduled request carries no session cookie and
// never will: Vercel's cron caller is not a logged-in user. Without this the
// proxy redirects it to /login before the route can check its own secret, so
// the job never runs — which is how the nightly backup stayed dead even after
// its authentication was fixed. These routes are not unprotected: each verifies
// CRON_SECRET itself and refuses without it.
const PUBLIC_PATHS = ['/login', '/auth', '/api/auth', '/api/cron', '/']
const AUTH_COOKIE_PREFIX = 'sb-'

function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(c => c.name.startsWith(AUTH_COOKIE_PREFIX))
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some(p =>
    p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(p + '/')
  )

  const authenticated = hasAuthCookie(request)

  if (!authenticated && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (authenticated && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next({ request })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
