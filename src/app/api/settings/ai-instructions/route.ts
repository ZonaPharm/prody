import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('users')
    .select('ai_description_instructions')
    .eq('id', user.id)
    .returns<{ ai_description_instructions: string | null }[]>()
    .single()

  return NextResponse.json({ instructions: data?.ai_description_instructions || '' })
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { instructions } = await request.json()

  const { error } = await supabase
    .from('users')
    // @ts-expect-error — supabase-js type inference limitation with @supabase/ssr
    .update({ ai_description_instructions: instructions })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
