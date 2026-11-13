/**
 * The files the assistant makes (make_file in actions.ts). Every file can be
 * downloaded as Excel (one sheet per table), Word or PDF, and opened as a
 * print page (src/app/print/assistant). The format asked for only decides
 * which button comes first.
 */
import ExcelJS from 'exceljs'

export type FileTable = { columns: { key: string; title: string }[]; rows: Record<string, unknown>[]; source: string }
export type FileSection = { heading: string | null; text: string | null; table: FileTable | null }
export type FilePayload = { title: string; intro: string | null; sections: FileSection[]; format?: FileFormat }

export const FILE_FORMATS = ['xlsx', 'docx', 'pdf'] as const
export type FileFormat = (typeof FILE_FORMATS)[number]

/** A sheet name Excel accepts: at most 31 characters, none of []:*?/\ and unique. */
export function sheetName(wanted: string, taken: Set<string>): string {
  const base = (wanted.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Лист').slice(0, 31)
  let name = base
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`
  taken.add(name.toLowerCase())
  return name
}

/** A safe file name: letters, digits, spaces and dashes. */
export function fileName(title: string, ext: string): string {
  const base = title.replace(/[^\p{L}\p{N} _-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'prody'
  return `${base}.${ext}`
}

export async function buildWorkbook(file: FilePayload): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Prody AI асистент'
  const taken = new Set<string>()
  const tables = file.sections.filter(s => s.table)
  if (!tables.length) {
    const ws = wb.addWorksheet(sheetName(file.title, taken))
    ws.addRow([file.title]).font = { bold: true, size: 14 }
    for (const s of [file.intro, ...file.sections.flatMap(x => [x.heading, x.text])]) if (s) ws.addRow([s])
  }
  for (const [i, s] of tables.entries()) {
    const t = s.table!
    const ws = wb.addWorksheet(sheetName(s.heading || (tables.length > 1 ? `${file.title} ${i + 1}` : file.title), taken))
    ws.columns = t.columns.map(c => ({ header: c.title, key: c.key, width: Math.min(60, Math.max(10, c.title.length + 2)) }))
    for (const r of t.rows) ws.addRow(Object.fromEntries(t.columns.map(c => [c.key, r[c.key] ?? null])))
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    // Widen a column to its longest value, within reason.
    ws.columns.forEach(col => {
      let w = col.width ?? 10
      col.eachCell?.({ includeEmpty: false }, c => { w = Math.max(w, Math.min(60, String(c.value ?? '').length + 2)) })
      col.width = w
    })
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** How a value reads in a document: numbers the Bulgarian way, yes/no, empty for nothing. */
export function cellText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return v.toLocaleString('bg-BG', { maximumFractionDigits: 2 })
  if (typeof v === 'boolean') return v ? 'да' : 'не'
  return String(v)
}

/** Many columns read better across the page. */
export function wide(file: FilePayload): boolean {
  return file.sections.some(s => (s.table?.columns.length ?? 0) > 6)
}

/** Today in Sofia as 13.11.2026, for the top of a document. */
export function docDate(at = new Date()): string {
  return new Intl.DateTimeFormat('bg-BG', { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', year: 'numeric' }).format(at).replace(/\s*г\.?$/, '')
}

// ---------- Word ----------

export async function buildDocx(file: FilePayload, at = new Date()): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, PageOrientation, ShadingType, HeadingLevel } = await import('docx')
  const lines = (text: string, opts: { size?: number; color?: string } = {}) =>
    text.split('\n').map(t => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: t, size: opts.size, color: opts.color })] }))
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: file.title, bold: true, size: 36 })] }),
    new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: docDate(at), color: '666666', size: 18 })] }),
  ]
  if (file.intro) children.push(...lines(file.intro))
  for (const s of file.sections) {
    if (s.heading) children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun({ text: s.heading, bold: true })] }))
    if (s.text) children.push(...lines(s.text))
    if (s.table) {
      const t = s.table
      const cellOf = (text: string, o: { bold?: boolean; right?: boolean; head?: boolean } = {}) => new TableCell({
        shading: o.head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EEEEEE' } : undefined,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
        children: [new Paragraph({ alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text, bold: o.bold, size: 18 })] })],
      })
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: t.columns.map(c => cellOf(c.title, { bold: true, head: true })) }),
          ...t.rows.map(r => new TableRow({ children: t.columns.map(c => cellOf(cellText(r[c.key]), { right: typeof r[c.key] === 'number' })) })),
        ],
      }))
      children.push(new Paragraph({ spacing: { before: 60, after: 120 }, children: [new TextRun({ text: `Данни: ${t.source}. ${t.rows.length} реда.`, size: 16, color: '777777' })] }))
    }
  }
  const doc = new Document({
    creator: 'Prody AI асистент',
    title: file.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{
      properties: { page: { size: { orientation: wide(file) ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      children,
    }],
  })
  return Buffer.from(await Packer.toBuffer(doc))
}

// ---------- PDF ----------

/** The fonts ship with the app (Carlito, OFL): the PDF standard fonts have no Cyrillic. */
async function loadFonts(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const dir = join(process.cwd(), 'src/lib/assistant/fonts')
  const [regular, bold] = await Promise.all([readFile(join(dir, 'Carlito-Regular.ttf')), readFile(join(dir, 'Carlito-Bold.ttf'))])
  return { regular, bold }
}

/** Text the font can draw: no emoji or control characters. */
function clean(s: string): string {
  return s.replace(/[^\u0000-￿]/gu, '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').replace(/[︀-️​-‍]/g, '')
}

type Measure = (text: string, size: number) => number

/** Splits text into lines no wider than `width`; a word longer than a line is broken. */
export function wrapText(text: string, width: number, size: number, measure: Measure): string[] {
  const out: string[] = []
  for (const para of clean(text).split('\n')) {
    let line = ''
    for (const word of para.split(/ +/)) {
      const tryLine = line ? `${line} ${word}` : word
      if (measure(tryLine, size) <= width) { line = tryLine; continue }
      if (line) out.push(line)
      line = ''
      let rest = word
      while (measure(rest, size) > width && rest.length > 1) {
        let n = rest.length - 1
        while (n > 1 && measure(rest.slice(0, n), size) > width) n--
        out.push(rest.slice(0, n))
        rest = rest.slice(n)
      }
      line = rest
    }
    out.push(line)
  }
  return out
}

/** Column widths from how long their contents are, filling `total`. */
export function columnWidths(titles: string[], rows: string[][], total: number): number[] {
  const want = titles.map((t, i) => {
    const longest = Math.max(t.length, ...rows.slice(0, 200).map(r => r[i]?.length ?? 0))
    return Math.min(40, Math.max(4, longest))
  })
  const sum = want.reduce((a, b) => a + b, 0)
  return want.map(w => (w / sum) * total)
}

export async function buildPdf(file: FilePayload, at = new Date()): Promise<Buffer> {
  const { PDFDocument, rgb } = await import('pdf-lib')
  const fontkit = (await import('@pdf-lib/fontkit')).default
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  pdf.setTitle(file.title)
  pdf.setCreator('Prody AI асистент')
  const fonts = await loadFonts()
  const regular = await pdf.embedFont(fonts.regular, { subset: false })
  const bold = await pdf.embedFont(fonts.bold, { subset: false })

  const [W, H] = wide(file) ? [841.89, 595.28] : [595.28, 841.89]
  const M = 40
  const usable = W - 2 * M
  const black = rgb(0, 0, 0)
  const grey = rgb(0.45, 0.45, 0.45)
  const line = rgb(0.75, 0.75, 0.75)

  let page = pdf.addPage([W, H])
  let y = H - M
  const newPage = () => { page = pdf.addPage([W, H]); y = H - M }
  const need = (h: number) => { if (y - h < M + 14) newPage() }

  const para = (text: string, o: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = o.size ?? 10.5
    const font = o.font ?? regular
    for (const l of wrapText(text, usable, size, (t, s) => font.widthOfTextAtSize(t, s))) {
      need(size * 1.35)
      page.drawText(l, { x: M, y: y - size, size, font, color: o.color ?? black })
      y -= size * 1.35
    }
    y -= o.gap ?? 4
  }

  // Title and date.
  const date = docDate(at)
  page.drawText(date, { x: W - M - regular.widthOfTextAtSize(date, 9), y: y - 9, size: 9, font: regular, color: grey })
  para(file.title, { size: 17, font: bold, gap: 2 })
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: black })
  y -= 12
  if (file.intro) para(file.intro)

  for (const s of file.sections) {
    if (s.heading) { y -= 6; need(40); para(s.heading, { size: 12.5, font: bold, gap: 2 }) }
    if (s.text) para(s.text)
    if (!s.table) continue
    const t = s.table
    const size = 8.5
    const lh = size * 1.3
    const pad = 3
    const titles = t.columns.map(c => clean(c.title))
    const cells = t.rows.map(r => t.columns.map(c => cellText(r[c.key])))
    const widths = columnWidths(titles, cells, usable)
    const xs = widths.map((_, i) => M + widths.slice(0, i).reduce((a, b) => a + b, 0))
    const drawRow = (vals: string[], o: { head?: boolean; right?: boolean[] } = {}) => {
      const font = o.head ? bold : regular
      const wrapped = vals.map((v, i) => wrapText(v, widths[i] - 2 * pad, size, (tx, sz) => font.widthOfTextAtSize(tx, sz)))
      const h = Math.max(...wrapped.map(w => w.length)) * lh + 2 * pad
      if (y - h < M + 14) { newPage(); if (!o.head) drawRow(titles, { head: true }) }
      if (o.head) page.drawRectangle({ x: M, y: y - h, width: usable, height: h, color: rgb(0.93, 0.93, 0.93) })
      wrapped.forEach((ls, i) => ls.forEach((l, k) => {
        const tw = font.widthOfTextAtSize(l, size)
        const x = o.right?.[i] ? xs[i] + widths[i] - pad - tw : xs[i] + pad
        page.drawText(l, { x, y: y - pad - (k + 1) * lh + 2, size, font, color: black })
      }))
      y -= h
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: o.head ? 0.8 : 0.4, color: o.head ? black : line })
    }
    y -= 4
    need(60)
    drawRow(titles, { head: true })
    t.rows.forEach((r, j) => drawRow(cells[j], { right: t.columns.map(c => typeof r[c.key] === 'number') }))
    y -= 4
    para(`Данни: ${t.source}. ${t.rows.length} реда.`, { size: 8, color: grey, gap: 8 })
  }

  // Page numbers.
  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    const text = `Prody · стр. ${i + 1} от ${pages.length}`
    p.drawText(text, { x: W - M - regular.widthOfTextAtSize(text, 8), y: M / 2, size: 8, font: regular, color: grey })
  })
  return Buffer.from(await pdf.save())
}
