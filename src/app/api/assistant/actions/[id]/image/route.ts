import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assistantAccess } from '@/lib/assistant/access'
import { ownAction } from '@/lib/assistant/store'
import { readPending } from '@/lib/assistant/uploads'

export const dynamic = 'force-dynamic'

/** The photo a product-photo card shows while it waits for "Добави". Only to the person the card is for. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await assistantAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Няма такава снимка.' }, { status: 404 })
  const db = createAdminClient()
  const action = await ownAction(db, access.user.id, id)
  if (!action || action.kind !== 'product_image') return NextResponse.json({ error: 'Няма такава снимка.' }, { status: 404 })
  const bytes = await readPending(db.storage as any, action.payload?.pending_path)
  if (!bytes) return NextResponse.json({ error: 'Снимката вече я няма.' }, { status: 404 })
  return new Response(Buffer.from(bytes), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  })
}
