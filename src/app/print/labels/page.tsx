import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { isUuid } from '@/lib/deliveries/api'
import { formatDeliveryNumber } from '@/lib/deliveries/format'
import { plainText } from '@/lib/labels/sheet'
import { PROFILE_COLUMNS, profileFromRow, type SheetProfile } from '@/lib/labels/profiles'
import { LabelSheets, type PrintLabel } from '@/components/labels/label-sheets'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Етикети' }

const MAX_ITEMS = 300

/**
 * Labels for pre-cut A4 sheets, straight from "Етикетиране": ?items= the delivery
 * lines (comma separated). Each line starts with as many labels as it has units
 * still without one; the count, the sheet and the first free cell are set on the page.
 * Outside the admin layout, so only the sheets print.
 */
export default async function LabelsPrintPage({ searchParams }: { searchParams: Promise<{ items?: string }> }) {
  await requireDeliveriesAdmin()
  const { items } = await searchParams
  const ids = [...new Set((items ?? '').split(',').map(s => s.trim()).filter(isUuid))].slice(0, MAX_ITEMS)
  if (ids.length === 0) notFound()

  const supabase = await createServerSupabaseClient()
  const { data, error } = await (supabase as any)
    .from('delivery_items')
    .select(
      'id, received_qty, labelled_qty, sort_order, ' +
        'delivery:deliveries!delivery_items_delivery_id_fkey(number), ' +
        'product:products(name, description, wp_short_description, price, barcode, sku)',
    )
    .in('id', ids)
  if (error) throw new Error(error.message)
  const order = new Map(ids.map((id, i) => [id, i]))
  const labels: PrintLabel[] = ((data ?? []) as any[])
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map(r => ({
      key: r.id,
      name: r.product?.name ?? '—',
      description: plainText(r.product?.description) || plainText(r.product?.wp_short_description),
      price: r.product?.price == null ? null : Number(r.product.price),
      code: (r.product?.barcode ?? '').trim() || (r.product?.sku ?? '').trim(),
      source: formatDeliveryNumber(r.delivery?.number ?? null),
      count: Math.max(0, (r.received_qty ?? 0) - (r.labelled_qty ?? 0)),
    }))
  if (labels.length === 0) notFound()

  // Saved paper profiles; until migration 20261111_label_sheet_profiles runs the table
  // is missing, and the page works with the built-in sheets only.
  let profiles: SheetProfile[] = []
  let profilesReady = true
  const prof = await (supabase as any).from('label_sheet_profiles').select(PROFILE_COLUMNS).order('name').limit(500)
  if (prof.error) {
    profilesReady = false
    console.error('label_sheet_profiles read failed:', JSON.stringify(prof.error))
  } else {
    profiles = (prof.data ?? []).map(profileFromRow)
  }

  return <LabelSheets labels={labels} initialProfiles={profiles} profilesReady={profilesReady} />
}
