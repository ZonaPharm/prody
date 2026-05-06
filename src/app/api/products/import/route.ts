import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { products, category_id } = body as {
    products: { name: string; price: number; description: string; image_url: string }[]
    category_id?: string
  }

  if (!products || !Array.isArray(products) || products.length === 0) {
    return NextResponse.json({ error: 'Невалидни данни' }, { status: 400 })
  }

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const p of products) {
    try {
      // Check if product with same name already exists
      const { data: existing } = await (supabase.from('products') as any)
        .select('id')
        .ilike('name', p.name.trim())
        .maybeSingle()

      if (existing) {
        skipped++
        continue
      }

      // Insert product
      const { data: newProduct, error: insertErr } = await (supabase.from('products') as any)
        .insert({
          name: p.name.trim(),
          price: p.price,
          description: p.description?.trim() || null,
          status: 'active',
          quantity_on_hand: 100,
          category_id: category_id || null,
        })
        .select('id')
        .single()

      if (insertErr) {
        errors.push(`${p.name}: ${insertErr.message}`)
        continue
      }

      // Insert image if URL provided
      if (p.image_url?.trim()) {
        await (supabase.from('product_images') as any).insert({
          product_id: newProduct.id,
          url: p.image_url.trim(),
          is_primary: true,
          sort_order: 0,
        })
      }

      imported++
    } catch (e: any) {
      errors.push(`${p.name}: ${e?.message || 'Unknown error'}`)
    }
  }

  return NextResponse.json({ imported, skipped, errors })
}
