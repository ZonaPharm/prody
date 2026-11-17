import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { assistantAccess } from '@/lib/assistant/access'
import { UploadError, createUpload, sweepUploads } from '@/lib/assistant/uploads'

export const dynamic = 'force-dynamic'

const Body = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.string().max(200).default(''),
  size: z.number().int(),
})

/**
 * A one-time link for one bigger attachment (over about 4 MB). The browser
 * uploads the file to it and then sends the question with the returned path.
 */
export async function POST(request: NextRequest) {
  const access = await assistantAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Грешна заявка' }, { status: 400 })
  const storage = createAdminClient().storage as any
  try {
    const link = await createUpload(storage, access.user.id, parsed.data.name, parsed.data.type, parsed.data.size)
    // This person's leftovers (a page closed after an upload) go now.
    await sweepUploads(storage, { folder: access.user.id })
    return NextResponse.json(link)
  } catch (err) {
    if (err instanceof UploadError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('assistant upload link failed:', err)
    return NextResponse.json({ error: 'Файлът не може да се качи сега. Опитайте пак.' }, { status: 500 })
  }
}
