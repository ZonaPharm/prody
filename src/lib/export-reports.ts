import * as XLSX from 'xlsx'
import { sofiaDate } from '@/lib/date-utils'

function autoFilterAndFormat(ws: XLSX.WorkSheet, cols: number) {
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 999, c: cols - 1 } }) }
}

function setColWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!cols'] = widths.map(w => ({ wch: w }))
}

function formatSheet(wb: XLSX.WorkBook, sheetName: string, headers: string[], rows: any[][], colWidths: number[]) {
  const data = [headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(data)
  setColWidths(ws, colWidths)
  autoFilterAndFormat(ws, headers.length)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return ws
}

function toBuffer(wb: XLSX.WorkBook): Buffer {
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

export interface ExportRequest {
  type: 'store' | 'product' | 'detail'
  from: string
  to: string
  store_id?: string | null
}

export async function buildExportWorkbook(
  req: ExportRequest,
  fetchSales: (query: { from: string; to: string; store_id?: string | null }) => Promise<any[]>
): Promise<Buffer> {
  const sales = await fetchSales(req)
  const wb = XLSX.utils.book_new()

  if (req.type === 'store') {
    const map: Record<string, { store: string; count: number; revenue: number; cash: number; card: number }> = {}
    sales.forEach((s: any) => {
      const store = s.store_name || '—'
      if (!map[store]) map[store] = { store, count: 0, revenue: 0, cash: 0, card: 0 }
      map[store].count++
      const rev = s.quantity * Number(s.sale_price)
      map[store].revenue += rev
      if (s.payment_method === 'card') map[store].card += rev
      else map[store].cash += rev
    })
    const rows = Object.values(map).sort((a, b) => b.revenue - a.revenue).map(r => [
      r.store, r.count, Math.round(r.revenue * 100) / 100,
      Math.round(r.cash * 100) / 100, Math.round(r.card * 100) / 100,
    ])
    formatSheet(wb, 'По обекти', ['Обект', 'Брой продажби', 'Оборот (€)', 'Кеш (€)', 'Карта (€)'], rows, [20, 14, 14, 14, 14])
  } else if (req.type === 'product') {
    const map: Record<string, { name: string; qty: number; revenue: number }> = {}
    sales.forEach((s: any) => {
      const name = s.product_name || '—'
      if (!map[name]) map[name] = { name, qty: 0, revenue: 0 }
      map[name].qty += s.quantity
      map[name].revenue += s.quantity * Number(s.sale_price)
    })
    const rows = Object.values(map).sort((a, b) => b.qty - a.qty).map(r => {
      const avgPrice = r.qty > 0 ? Math.round((r.revenue / r.qty) * 100) / 100 : 0
      return [r.name, r.qty, avgPrice, Math.round(r.revenue * 100) / 100]
    })
    formatSheet(wb, 'По продукти', ['Продукт', 'Продадени бр.', 'Ед. цена (€)', 'Оборот (€)'], rows, [40, 14, 14, 14])
  } else {
    const rows = sales.map((s: any) => [
      sofiaDate(s.sale_date),
      s.store_name || '—',
      s.product_name || '—',
      s.category_name || '—',
      s.quantity,
      Number(s.sale_price).toFixed(2),
      (s.quantity * Number(s.sale_price)).toFixed(2),
      s.payment_method === 'card' ? 'Карта' : 'Кеш',
      s.seller_name || '—',
    ])
    formatSheet(wb, 'Пълен детайл', ['Дата', 'Обект', 'Продукт', 'Категория', 'К-во', 'Цена (€)', 'Сума (€)', 'Плащане', 'Продавач'], rows, [12, 18, 30, 18, 8, 10, 10, 10, 18])
  }

  return toBuffer(wb)
}
