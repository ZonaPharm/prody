import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getImageSrc } from '@/lib/images'
import { labelCode } from '@/lib/barcodes'
import { formatMoney } from '@/lib/deliveries/format'
import { sofiaDateTime } from '@/lib/date-utils'
import { Barcode } from '@/components/labels/barcode'
import { PrintButton } from '@/components/deliveries/print-button'
import { Hint, Note } from '@/components/ui/text'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Карта на касата' }

type CardProduct = {
  id: string
  name: string
  price: number | null
  barcode: string | null
  internal_barcode: string | null
  images: { url: string; is_primary: boolean; sort_order: number }[] | null
}

/**
 * "Карта на касата": the small products that have no room for a label, each with its
 * picture, name, price and barcode, on A4 to keep (laminated) by the till. The seller
 * scans the product's barcode from the card. Products are on it when "Малък продукт"
 * is ticked in the product. Outside the admin layout, so only the sheet prints.
 */
export default async function BarcodeCardPage() {
  await requireAdmin()
  const supabase = await createServerSupabaseClient()
  const { data, error } = await (supabase as any)
    .from('products')
    .select('id, name, price, barcode, internal_barcode, images:product_images(url, is_primary, sort_order)')
    .eq('small_item', true)
    .eq('status', 'active')
    .order('name')
    .limit(1000)

  // Before migration 20261112_product_internal_barcode the columns are missing.
  if (error) {
    console.error('barcode-card read failed:', JSON.stringify(error))
    return (
      <Message tone="danger">
        Картата още не може да се отвори: базата няма полетата за баркод. Нужно е да се пусне
        миграцията 20261112_product_internal_barcode.sql.
      </Message>
    )
  }
  const products = (data ?? []) as CardProduct[]
  if (products.length === 0) {
    return (
      <Message>
        Няма продукти, отбелязани като „Малък продукт“. Отворете продукта от{' '}
        <Link href="/catalog" className="text-blue-600 underline">Каталог</Link>, натиснете „Редактирай“ и
        отметнете „Малък продукт, няма място за етикет“.
      </Message>
    )
  }

  const pictureOf = (p: CardProduct) => {
    const imgs = [...(p.images ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
    return imgs[0]?.url ?? null
  }

  return (
    <div className="mx-auto max-w-[210mm] p-6 text-black print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Hint>
          {products.length} {products.length === 1 ? 'продукт' : 'продукта'}. Отпечатайте и сложете до касата: при продажба сканирайте баркода от картата.
        </Hint>
        <PrintButton />
      </div>
      <div className="mb-3 flex items-baseline justify-between border-b-2 border-black pb-1">
        <h1 className="text-xl font-bold">Карта на касата: малки продукти</h1>
        <span className="text-xs">отпечатана {sofiaDateTime(new Date())}</span>
      </div>
      <div className="grid grid-cols-2 gap-[3mm] sm:grid-cols-3">
        {products.map(p => {
          const code = labelCode(p)
          const img = pictureOf(p)
          return (
            <div key={p.id} className="flex break-inside-avoid flex-col items-center rounded border border-slate-400 p-[2mm] text-center">
              <div className="flex h-[20mm] w-full items-center justify-center">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={getImageSrc(img)} alt="" className="max-h-[20mm] max-w-full object-contain" />
                ) : null}
              </div>
              <div className="mt-[1mm] line-clamp-2 min-h-[2.4em] text-[9pt] font-bold leading-tight">{p.name}</div>
              <div className="text-[9pt]">{formatMoney(p.price)}</div>
              <div className="mt-[1mm]">
                {code ? <Barcode code={code} height={11} maxWidth={52} textPt={7} /> : <span className="text-[8pt]">без баркод</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Message({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'danger' }) {
  return (
    <div className="mx-auto max-w-xl p-6">
      <Note tone={tone}>{children}</Note>
    </div>
  )
}
