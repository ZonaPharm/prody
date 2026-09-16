import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createProduct, updateProduct, isWooConfigured, type WooProductInput } from '@/lib/woocommerce'
import { logAction } from '@/lib/audit'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isWooConfigured()) {
    return NextResponse.json(
      { error: 'WooCommerce не е настроен на този сървър' },
      { status: 400 },
    )
  }

  const { id } = await params
  const admin = createAdminClient()

  const { data: product } = await (admin.from('products') as any)
    .select('id, name, sku, price, wp_title, wp_description, wp_short_description, wp_ingredients, wp_usage, wp_warnings, wp_usage_tab_title, wp_category_ids, wp_product_id')
    .eq('id', id)
    .single()

  if (!product) return NextResponse.json({ error: 'Продуктът не съществува' }, { status: 404 })

  // Shop and catalogue names are meant to differ, so there is no fallback to
  // product.name here: an empty wp_title means nobody decided what the shop
  // should call it, and publishing the internal name would hide that.
  const title = (product.wp_title || '').trim()
  if (!title) {
    return NextResponse.json(
      { error: 'Липсва заглавие за сайта — попълнете го в таб „За уебсайта"' },
      { status: 400 },
    )
  }

  // Stock is deliberately not sent: every product on this shop runs with
  // manage_stock false, and pushing a quantity made a test product advertise
  // "1 налични". Prody remains the stock system; the shop does not track it.

  const ingredients = product.wp_ingredients?.trim() || ''
  const usage = product.wp_usage?.trim() || ''
  const warnings = product.wp_warnings?.trim() || ''

  // Warnings join the usage tab because the theme offers only two per-product
  // tabs; its "Противопоказания" tab is global text, identical for every
  // product. A blank line between them matches how the shop's own products
  // are written by hand.
  const usageTab = [usage, warnings].filter(Boolean).join('\n\n')

  const meta: { key: string; value: string }[] = []
  if (ingredients) {
    meta.push({ key: '_woodmart_product_custom_tab_title', value: 'Състав' })
    meta.push({ key: '_woodmart_product_custom_tab_content', value: ingredients })
    meta.push({ key: '_woodmart_product_custom_tab_content_type', value: 'text' })
  }
  if (usageTab) {
    meta.push({
      key: '_woodmart_product_custom_tab_title_2',
      value: product.wp_usage_tab_title?.trim() || 'Указания за употреба',
    })
    meta.push({ key: '_woodmart_product_custom_tab_content_2', value: usageTab })
    meta.push({ key: '_woodmart_product_custom_tab_content_type_2', value: 'text' })
  }

  const categoryIds: number[] = Array.isArray(product.wp_category_ids)
    ? product.wp_category_ids.filter((n: unknown) => typeof n === 'number')
    : []

  const payload: WooProductInput = {
    name: title,
    description: product.wp_description?.trim() || '',
    short_description: product.wp_short_description?.trim() || '',
    ...(product.price != null ? { regular_price: String(product.price) } : {}),
    ...(product.sku ? { sku: product.sku } : {}),
    ...(categoryIds.length > 0 ? { categories: categoryIds.map(id => ({ id })) } : {}),
    ...(meta.length > 0 ? { meta_data: meta } : {}),
  }

  try {
    const existingId: number | null = product.wp_product_id ?? null
    const result = existingId
      ? await updateProduct(existingId, payload)
      : await createProduct(payload)

    // Only recorded after WooCommerce confirms. A failed push leaves
    // wp_synced_at untouched, so the catalogue never claims a product is on
    // the shop when it is not.
    const { error: updErr } = await (admin.from('products') as any)
      .update({ wp_product_id: result.id, wp_synced_at: new Date().toISOString() })
      .eq('id', id)

    if (updErr) {
      return NextResponse.json(
        { error: `Продуктът е качен (id ${result.id}), но записът в Prody не мина: ${updErr.message}` },
        { status: 500 },
      )
    }

    await logAction({
      action: existingId ? 'wp_update' : 'wp_create',
      userId: user.id,
      entityType: 'product',
      entityId: id,
      details: `${title} → WooCommerce #${result.id}`,
    }, admin)

    return NextResponse.json({
      success: true,
      wp_product_id: result.id,
      permalink: result.permalink,
      created: !existingId,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Качването не мина' }, { status: 500 })
  }
}
