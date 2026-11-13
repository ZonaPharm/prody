import { describe, expect, it } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import ExcelJS from 'exceljs'
import { buildDocx, buildPdf, buildWorkbook, cellText, columnWidths, fileName, wrapText, type FilePayload } from './files'

const file: FilePayload = {
  title: 'Продажби по обекти',
  intro: 'Ноември 2026.\nСамо платени продажби.',
  format: 'pdf',
  sections: [
    { heading: 'По обекти', text: null, table: {
      columns: [{ key: 'store', title: 'Обект' }, { key: 'revenue', title: 'Оборот €' }],
      rows: [{ store: 'Ботев', revenue: 1234.5 }, { store: 'Офис 😀', revenue: 10 }],
      source: 'Prody, справка sales_summary',
    } },
    { heading: 'Бележка', text: 'Дълъг текст '.repeat(200), table: null },
  ],
}

describe('cellText', () => {
  it('reads numbers the Bulgarian way', () => {
    expect(cellText(1234.5)).toMatch(/^1\s?234,5$/)
    expect(cellText(true)).toBe('да')
    expect(cellText(null)).toBe('')
  })
})

describe('wrapText / columnWidths', () => {
  const measure = (t: string) => t.length
  it('wraps at words and breaks a word longer than the line', () => {
    expect(wrapText('аа бб вв', 5, 1, measure)).toEqual(['аа бб', 'вв'])
    expect(wrapText('абвгдежз', 3, 1, measure)).toEqual(['абв', 'где', 'жз'])
    expect(wrapText('ред1\nред2', 50, 1, measure)).toEqual(['ред1', 'ред2'])
  })
  it('column widths fill the page', () => {
    const w = columnWidths(['А', 'Дълго име'], [['x', 'y']], 500)
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(500)
    expect(w[1]).toBeGreaterThan(w[0])
  })
})

describe('the three formats', () => {
  it('PDF holds the Cyrillic text and the table, with page numbers', async () => {
    const buf = await buildPdf(file, new Date('2026-11-13T10:00:00Z'))
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text, totalPages } = await extractText(pdf, { mergePages: true })
    expect(totalPages).toBe(1)
    for (const s of ['Продажби по обекти', 'Ботев', 'Оборот', '13.11.2026', 'стр. 1 от']) expect(text).toContain(s)
  })
  it('PDF with many columns and many rows', async () => {
    const columns = Array.from({ length: 9 }, (_, i) => ({ key: `c${i}`, title: `Колона ${i}` }))
    const rows = Array.from({ length: 300 }, (_, j) => Object.fromEntries(columns.map((c, i) => [c.key, i === 0 ? `Продукт с много дълго име номер ${j}` : j * i])))
    const buf = await buildPdf({ title: 'Голяма', intro: null, sections: [{ heading: null, text: null, table: { columns, rows, source: 'тест' } }] })
    const { totalPages } = await extractText(await getDocumentProxy(new Uint8Array(buf)))
    expect(totalPages).toBeGreaterThan(3)
  })
  it('Word is a .docx (zip) with the text in it', async () => {
    const buf = await buildDocx(file)
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    const { unzipSync, strFromU8 } = await import('fflate')
    const xml = strFromU8(unzipSync(new Uint8Array(buf))['word/document.xml'])
    for (const s of ['Продажби по обекти', 'Ботев', 'Оборот €']) expect(xml).toContain(s)
  })
  it('Excel has the table', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await buildWorkbook(file)) as any)
    expect(wb.worksheets[0].getRow(2).getCell(1).value).toBe('Ботев')
  })
  it('file names keep Cyrillic', () => {
    expect(fileName('Продажби: ноември/2026', 'docx')).toBe('Продажби ноември 2026.docx')
  })
})
