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
    .select('id, name, sku, price, wp_title, wp_description, wp_short_description, wp_ingredients, wp_usage, wp_warnings, wp_product_id')
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

  // Stock comes from the batches, which a physical count confirmed is the
  // accurate side; products.quantity_on_hand drifted above them.
  const { data: batches } = await (admin.from('stock_batches') as any)
    .select('quantity_remaining')
    .eq('product_id', id)
    .gt('quantity_remaining', 0)

  const stock = (batches || []).reduce(
    (sum: number, b: any) => sum + (b.quantity_remaining || 0),
    0,
  )

  const meta: { key: string; value: string }[] = []
  if (product.wp_ingredients?.trim()) meta.push({ key: '_ingredients', value: product.wp_ingredients.trim() })
  if (product.wp_usage?.trim()) meta.push({ key: '_usage', value: product.wp_usage.trim() })
  if (product.wp_warnings?.trim()) meta.push({ key: '_warnings', value: product.wp_warnings.trim() })

  const payload: WooProductInput = {
    name: title,
    description: product.wp_description?.trim() || '',
    short_description: product.wp_short_description?.trim() || '',
    manage_stock: true,
    stock_quantity: stock,
    ...(product.price != null ? { regular_price: String(product.price) } : {}),
    ...(product.sku ? { sku: product.sku } : {}),
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
