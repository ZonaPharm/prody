import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assistantAccess } from '@/lib/assistant/access'
import { checkCap } from '@/lib/assistant/pricing'
import { monthSpend, monthlyCap } from '@/lib/assistant/store'
import {
  MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, STT_MODEL, isAudio, sttCostUsd, transcribe, transcribeErrorText, transcriptionConfigured,
} from '@/lib/assistant/transcribe'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The microphone button's recording, turned into text (ElevenLabs Scribe).
 * Only for people who may use the assistant; the text comes back to the box
 * to be checked, nothing is asked or saved here except the cost record.
 */
export async function POST(request: NextRequest) {
  const access = await assistantAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!transcriptionConfigured()) return NextResponse.json({ error: 'Разпознаването на говор не е настроено (липсва ELEVENLABS_API_KEY).' }, { status: 503 })

  const db = createAdminClient()
  const [spend, cap] = await Promise.all([monthSpend(db), monthlyCap(db)])
  const capState = checkCap(spend.total, cap)
  if (!capState.ok) return NextResponse.json({ error: capState.message }, { status: 429 })

  const form = await request.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: 'Няма запис.' }, { status: 400 })
  if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: `Записът е твърде дълъг. Говорете до ${MAX_AUDIO_SECONDS / 60} минути.` }, { status: 413 })
  const type = (audio.type || '').toLowerCase()
  if (!isAudio(type)) return NextResponse.json({ error: 'Това не е звуков запис.' }, { status: 415 })

  try {
    const { text, seconds } = await transcribe(audio, type)
    const { error } = await (db.from('ai_usage') as any).insert({
      user_id: access.user.id,
      conversation_id: null,
      model: STT_MODEL,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: sttCostUsd(seconds ?? MAX_AUDIO_SECONDS),
    })
    if (error) console.error('ai_usage insert failed:', JSON.stringify(error))
    if (!text) return NextResponse.json({ error: 'Не чух думи в записа. Говорете по-близо до телефона.' }, { status: 422 })
    return NextResponse.json({ text })
  } catch (err) {
    console.error('transcribe failed:', err)
    return NextResponse.json({ error: transcribeErrorText(err) }, { status: 502 })
  }
}
