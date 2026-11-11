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
  /** The whole print moved right / down, mm (negative: left / up), for a printer that prints off. */
  offsetX: number
  offsetY: number
}

export const A4 = { width: 210, height: 297 }

/** The Office1 sheets used in the stores (24, 40, 44 and 65 a sheet), labels centred on A4. */
export const SHEET_PRESETS: { id: string; name: string; layout: SheetLayout }[] = [
  { id: '3x8', name: '24 на лист (70 × 37 мм)', layout: { cols: 3, rows: 8, width: 70, height: 37, top: 0.5, left: 0, gapX: 0, gapY: 0, offsetX: 0, offsetY: 0 } },
  { id: '4x10', name: '40 на лист (52,5 × 29,7 мм)', layout: { cols: 4, rows: 10, width: 52.5, height: 29.7, top: 0, left: 0, gapX: 0, gapY: 0, offsetX: 0, offsetY: 0 } },
  { id: '4x11', name: '44 на лист (48,5 × 25,4 мм)', layout: { cols: 4, rows: 11, width: 48.5, height: 25.4, top: 8.8, left: 8, gapX: 0, gapY: 0, offsetX: 0, offsetY: 0 } },
  { id: '5x13', name: '65 на лист (38,1 × 21,2 мм)', layout: { cols: 5, rows: 13, width: 38.1, height: 21.2, top: 10.7, left: 4.75, gapX: 2.5, gapY: 0, offsetX: 0, offsetY: 0 } },
]

export const DEFAULT_LAYOUT: SheetLayout = SHEET_PRESETS[0].layout

export function perSheet(l: SheetLayout): number {
  return Math.max(1, Math.floor(l.cols) * Math.floor(l.rows))
}

/** What is wrong with a layout (it must fit on A4), or null. */
export function layoutError(l: SheetLayout): string | null {
  const nums = [l.cols, l.rows, l.width, l.height, l.top, l.left, l.gapX, l.gapY]
  if (nums.some(n => !Number.isFinite(n) || n < 0)) return 'Числата трябва да са 0 или повече'
  const offsets = [l.offsetX ?? 0, l.offsetY ?? 0]
  if (offsets.some(n => !Number.isFinite(n) || Math.abs(n) > 20)) return 'Отместването е от −20 до 20 мм'
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

/** 1 pt in mm. */
const PT = 25.4 / 72
export const LINE_HEIGHT = 1.15

export type LabelMetrics = {
  /** Inner margin, mm. */
  pad: number
  gap: number
  namePt: number
  descPt: number
  /** How many lines of description fit; the rest is cut. */
  descLines: number
  /** Height of the bars, mm (0 without a barcode). */
  barH: number
  /** Size of the digits under the bars; 0 on small labels, where they are left out. */
  codePt: number
  pricePt: number
}

/**
 * Sizes on a label of width × height mm, scaled from a 70 × 37 mm label, with a
 * floor so the smallest labels stay readable. Two lines are kept for the name; the
 * description gets whatever height is left.
 */
export function labelMetrics(width: number, height: number, hasCode: boolean): LabelMetrics {
  const k = Math.max(0.5, Math.min(1.4, Math.min(width / 70, height / 37)))
  const pad = Math.max(1, 1.8 * k)
  const gap = Math.max(0.6, 0.5 * k)
  const namePt = Math.max(6, 9 * k)
  const descPt = Math.max(5, 6.5 * k)
  const pricePt = Math.max(7, 11 * k)
  const codePt = hasCode && height >= 25 ? Math.max(5, 6 * k) : 0
  const barH = hasCode ? Math.max(4, Math.min(10, 7 * k)) : 0
  const used =
    2 * pad +
    2 * namePt * PT * LINE_HEIGHT +
    (hasCode ? barH + (codePt ? 0.3 + codePt * PT * 1.1 : 0) : 0) +
    gap + pricePt * PT
  const descLines = Math.max(0, Math.floor((height - used - gap) / (descPt * PT * LINE_HEIGHT)))
  return { pad, gap, namePt, descPt, descLines, barH, codePt, pricePt }
}
