import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

export async function POST(request: Request) {
  const user = await requireAuth()
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { role } = await request.json()
  if (!['admin', 'seller'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  const response = NextResponse.json({ ok: true })
  if (role === 'seller') {
    response.cookies.set('prody_view_as', 'seller', { path: '/', httpOnly: true, maxAge: 60 * 60 * 24 })
  } else {
    response.cookies.set('prody_view_as', '', { path: '/', maxAge: 0 })
  }
  return response
}
