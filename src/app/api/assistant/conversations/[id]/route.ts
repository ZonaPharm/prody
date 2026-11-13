import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assistantAccess } from '@/lib/assistant/access'
import { loadTranscript, ownConversation } from '@/lib/assistant/store'

/** The questions and answers of one of the person's own conversations. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await assistantAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Няма такъв разговор.' }, { status: 404 })
  const db = createAdminClient()
  const own = await ownConversation(db, access.user.id, id)
  if (!own) return NextResponse.json({ error: 'Няма такъв разговор.' }, { status: 404 })
  return NextResponse.json({ id: own.id, title: own.title, items: await loadTranscript(db, own.id) })
}
