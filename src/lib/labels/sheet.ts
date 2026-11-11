/**
 * A4 sheets of pre-cut labels: the layout (how many across and down, their size and
 * the margins, in mm) and how a list of labels fills the pages. The sheet is printed
 * at 100 % with no browser margins, so mm on screen are mm on paper.
 */

export type SheetLayout = {
  cols: number
  rows: number
  /** Label size, mm. */
  width: number
  height: number
  /** Page margins to the first label, mm. */
  top: number
  left: number
  /** Gaps between labels, mm. */
  gapX: number
  gapY: number
}

export const A4 = { width: 210, height: 297 }

export const SHEET_PRESETS: { id: string; name: string; layout: SheetLayout }[] = [
  { id: '3x8', name: '24 на лист (3 × 8, 70 × 37 мм)', layout: { cols: 3, rows: 8, width: 70, height: 37, top: 0.5, left: 0, gapX: 0, gapY: 0 } },
  { id: '3x7', name: '21 на лист (3 × 7, 70 × 42,4 мм)', layout: { cols: 3, rows: 7, width: 70, height: 42.4, top: 0, left: 0, gapX: 0, gapY: 0 } },
  { id: '2x7', name: '14 на лист (2 × 7, 99,1 × 38,1 мм)', layout: { cols: 2, rows: 7, width: 99.1, height: 38.1, top: 15.1, left: 4.7, gapX: 2.5, gapY: 0 } },
  { id: '4x10', name: '40 на лист (4 × 10, 48,5 × 25,4 мм)', layout: { cols: 4, rows: 10, width: 48.5, height: 25.4, top: 21.5, left: 8, gapX: 0, gapY: 0 } },
  { id: '5x13', name: '65 на лист (5 × 13, 38,1 × 21,2 мм)', layout: { cols: 5, rows: 13, width: 38.1, height: 21.2, top: 10.7, left: 4.7, gapX: 2.5, gapY: 0 } },
]

export const DEFAULT_LAYOUT: SheetLayout = SHEET_PRESETS[0].layout

export function perSheet(l: SheetLayout): number {
  return Math.max(1, Math.floor(l.cols) * Math.floor(l.rows))
}

/** What is wrong with a layout (it must fit on A4), or null. */
export function layoutError(l: SheetLayout): string | null {
  const nums = [l.cols, l.rows, l.width, l.height, l.top, l.left, l.gapX, l.gapY]
  if (nums.some(n => !Number.isFinite(n) || n < 0)) return 'Числата трябва да са 0 или повече'
  if (!Number.isInteger(l.cols) || !Number.isInteger(l.rows) || l.cols < 1 || l.rows < 1) return 'Колоните и редовете са цели числа от 1 нагоре'
  if (l.width < 15 || l.height < 10) return 'Етикетът е по-малък от 15 × 10 мм'
  const w = l.left + l.cols * l.width + (l.cols - 1) * l.gapX
  const h = l.top + l.rows * l.height + (l.rows - 1) * l.gapY
  if (w > A4.width + 0.01) return `Етикетите излизат извън листа: ${round(w)} мм на ширина, а A4 е ${A4.width} мм`
  if (h > A4.height + 0.01) return `Етикетите излизат извън листа: ${round(h)} мм на височина, а A4 е ${A4.height} мм`
  return null
}

function round(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',')
}

/**
 * The labels laid out on pages: each page is a list of cells, null for a cell left
 * empty. `start` (1-based) skips the cells already used on the first sheet.
 */
export function paginate<T>(labels: T[], layout: SheetLayout, start = 1): (T | null)[][] {
  const n = perSheet(layout)
  const skip = Math.min(Math.max(1, Math.floor(start)), n) - 1
  const cells: (T | null)[] = [...Array<null>(skip).fill(null), ...labels]
  const pages: (T | null)[][] = []
  for (let i = 0; i < cells.length; i += n) {
    const page = cells.slice(i, i + n)
    while (page.length < n) page.push(null)
    pages.push(page)
  }
  return pages
}

/** Product text for a small label: HTML tags and entities out, spaces folded. */
export function plainText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<(br|\/p|\/li|\/div)\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
