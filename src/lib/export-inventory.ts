import ExcelJS from 'exceljs'

export type InventoryStore = { id: string; name: string }

export type InventoryRow = {
  id: string
  name: string
  min_quantity: number
  /** quantity_remaining summed per store id */
  perStore: Record<string, number>
  /** sum of perStore; the per-store batches are the authoritative stock */
  batchTotal: number
  imageUrl: string | null
}

/** Fetched separately so a slow or missing image never blocks the export. */
export type ImageFetcher = (url: string) => Promise<{ buffer: Buffer; extension: 'png' | 'jpeg' | 'gif' } | null>

const HEADER_FILL = 'FF1E293B'
const LOW_FILL = 'FFFEE2E2'
const THUMB_PX = 56

export async function buildInventoryWorkbook(
  rows: InventoryRow[],
  stores: InventoryStore[],
  fetchImage: ImageFetcher | null,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const ws = wb.addWorksheet('Наличности', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
  })

  const columns: Partial<ExcelJS.Column>[] = [
    { header: 'Продукт', key: 'name', width: 46 },
    { header: 'Снимка', key: 'image', width: 10 },
    ...stores.map(s => ({ header: s.name, key: 'store_' + s.id, width: 12 })),
    { header: 'Общо', key: 'total', width: 12 },
    { header: 'Минимум', key: 'min', width: 11 },
    { header: 'Под минимум', key: 'below', width: 13 },
  ]
  ws.columns = columns

  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  header.height = 30

  // Images are fetched up front with a bounded pool: sequential downloads of a
  // few hundred thumbnails take minutes, and unbounded ones exhaust sockets.
  const thumbs = new Map<string, { buffer: Buffer; extension: 'png' | 'jpeg' | 'gif' }>()
  if (fetchImage) {
    const targets = rows.filter(r => r.imageUrl)
    const CONCURRENCY = 12
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
        for (let i = cursor++; i < targets.length; i = cursor++) {
          const row = targets[i]
          const img = await fetchImage(row.imageUrl as string)
          if (img) thumbs.set(row.id, img)
        }
      }),
    )
  }

  for (const r of rows) {
    const values: Record<string, string | number> = {
      name: r.name,
      image: '',
      total: r.batchTotal,
      min: r.min_quantity,
      below: r.batchTotal < r.min_quantity ? 'ДА' : '',
    }
    for (const s of stores) values['store_' + s.id] = r.perStore[s.id] ?? 0

    const row = ws.addRow(values)
    row.height = THUMB_PX * 0.78
    row.alignment = { vertical: 'middle' }
    ws.getCell(row.number, 1).alignment = { vertical: 'middle', wrapText: true }

    if (values.below === 'ДА') {
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LOW_FILL } }
      })
    }

    const thumb = thumbs.get(r.id)
    if (thumb) {
      const id = wb.addImage({ buffer: thumb.buffer as any, extension: thumb.extension })
      ws.addImage(id, {
        tl: { col: 1.15, row: row.number - 0.85 } as any,
        ext: { width: THUMB_PX, height: THUMB_PX },
      })
    }
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: columns.length } }

  for (let c = 3; c <= columns.length; c++) {
    ws.getColumn(c).alignment = { vertical: 'middle', horizontal: 'center' }
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
