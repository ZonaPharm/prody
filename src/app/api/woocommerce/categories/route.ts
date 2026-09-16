import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { isWooConfigured } from '@/lib/woocommerce'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isWooConfigured()) {
    return NextResponse.json({ error: 'WooCommerce не е настроен на този сървър' }, { status: 400 })
  }

  const base = process.env.WOOCOMMERCE_URL!.replace(/\/$/, '')
  const auth = 'Basic ' + Buffer.from(
    `${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`,
  ).toString('base64')

  const res = await fetch(
    `${base}/wp-json/wc/v3/products/categories?per_page=100&orderby=name&order=asc&_fields=id,name`,
    { headers: { Authorization: auth }, signal: AbortSignal.timeout(20000) },
  )

  if (!res.ok) {
    return NextResponse.json({ error: `WooCommerce отказа (${res.status})` }, { status: 502 })
  }

  return NextResponse.json({ categories: await res.json() })
}
