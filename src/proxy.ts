import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/auth', '/api/auth', '/']
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
