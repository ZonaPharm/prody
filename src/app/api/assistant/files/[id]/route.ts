import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assistantAccess } from '@/lib/assistant/access'
import { ownAction } from '@/lib/assistant/store'
import { buildWorkbook, fileName, type FilePayload } from '@/lib/assistant/files'

export const dynamic = 'force-dynamic'

/** The Excel file the assistant made, for the person it was made for. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await assistantAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Няма такъв файл.' }, { status: 404 })
  const action = await ownAction(createAdminClient(), access.user.id, id)
  if (!action || action.kind !== 'excel') return NextResponse.json({ error: 'Няма такъв файл.' }, { status: 404 })
  const file = action.payload as FilePayload
  const body = await buildWorkbook(file)
  const name = fileName(file.title, 'xlsx')
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="prody.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}
