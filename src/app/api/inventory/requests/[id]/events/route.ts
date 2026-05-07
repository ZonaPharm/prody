import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Try request_events table first (if migration applied)
  const { data: events } = await (supabase.from('request_events') as any)
    .select('id, status, notes, created_at')
    .eq('request_id', id)
    .order('created_at', { ascending: true })

  if (events && events.length > 0) {
    return NextResponse.json(events)
  }

  // Fallback: derive events from the request itself
  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('status, notes, created_at, updated_at, requested_qty')
    .eq('id', id)
    .single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const derived = [
    {
      status: 'pending',
      notes: 'Заявката е създадена',
      created_at: req.created_at,
    },
  ]

  if (req.status === 'fulfilled' || req.status === 'confirmed' || req.status === 'partial') {
    derived.push({
      status: 'fulfilled',
      notes: 'Заявката е изпълнена',
      created_at: req.updated_at || req.created_at,
    })
  }

  if (req.status === 'confirmed' || req.status === 'partial') {
    derived.push({
      status: req.status,
      notes: req.status === 'partial' ? 'Потвърдено частично получаване' : 'Потвърдено получаване',
      created_at: req.updated_at || req.created_at,
    })
  }

  return NextResponse.json(derived)
}
