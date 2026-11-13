/**
 * The files the assistant makes (make_file in actions.ts): an Excel workbook,
 * one sheet per table. The document kind is a print page (src/app/print/assistant).
 */
import ExcelJS from 'exceljs'

export type FileTable = { columns: { key: string; title: string }[]; rows: Record<string, unknown>[]; source: string }
export type FileSection = { heading: string | null; text: string | null; table: FileTable | null }
export type FilePayload = { title: string; intro: string | null; sections: FileSection[] }

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
