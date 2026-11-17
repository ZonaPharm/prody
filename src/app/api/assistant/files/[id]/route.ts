import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assistantAccess } from '@/lib/assistant/access'
import { ownAction } from '@/lib/assistant/store'
import { FILE_FORMATS, buildDocx, buildPdf, buildWorkbook, fileName, type FileFormat, type FilePayload } from '@/lib/assistant/files'

export const dynamic = 'force-dynamic'

const TYPES: Record<FileFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
}

/** A file the assistant made, as Excel, Word or PDF (?format=), for the person it was made for. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await assistantAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Няма такъв файл.' }, { status: 404 })
  const action = await ownAction(createAdminClient(), access.user.id, id)
  if (!action || (action.kind !== 'excel' && action.kind !== 'document')) return NextResponse.json({ error: 'Няма такъв файл.' }, { status: 404 })
  const file = action.payload as FilePayload
  const asked = new URL(req.url).searchParams.get('format')
  const format: FileFormat = (FILE_FORMATS as readonly string[]).includes(asked ?? '')
    ? (asked as FileFormat)
    : file.format ?? (action.kind === 'excel' ? 'xlsx' : 'pdf')
  const body = format === 'xlsx' ? await buildWorkbook(file) : format === 'docx' ? await buildDocx(file) : await buildPdf(file)
  const name = fileName(file.title, format)
  // A PDF opens in the browser (it can be saved or shared from there); the others download.
  const disposition = format === 'pdf' ? 'inline' : 'attachment'
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': TYPES[format],
      'Content-Disposition': `${disposition}; filename="prody.${format}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}
