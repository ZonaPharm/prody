import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { buildWorkbook, fileName, sheetName } from './files'
import { transcriptItems } from './store'

describe('files', () => {
  it('sheet names are short, clean and unique', () => {
    const taken = new Set<string>()
    expect(sheetName('Продажби: октомври/ноември 2026 по обекти', taken)).toBe('Продажби  октомври ноември 2026')
    expect(sheetName('Лист', taken)).toBe('Лист')
    expect(sheetName('лист', taken)).toBe('лист 2')
  })
  it('file names keep letters and digits', () => {
    expect(fileName('Продажби "октомври" 2026', 'xlsx')).toBe('Продажби октомври 2026.xlsx')
  })
  it('one sheet per table, with the chosen headers', async () => {
    const buf = await buildWorkbook({ title: 'Продажби', intro: null, sections: [
      { heading: 'По обекти', text: null, table: { columns: [{ key: 'key', title: 'Обект' }, { key: 'revenue', title: 'Оборот' }], rows: [{ key: 'Ботев', revenue: 120.5 }], source: 'x' } },
    ] })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any)
    const ws = wb.getWorksheet('По обекти')!
    expect(ws.getRow(1).values).toEqual([undefined, 'Обект', 'Оборот'])
    expect(ws.getRow(2).values).toEqual([undefined, 'Ботев', 120.5])
  })
})

describe('transcriptItems', () => {
  it('puts each card after the answer to its question', () => {
    const rows = [
      { seq: 1, role: 'user', display: 'В1', created_at: 'a' },
      { seq: 4, role: 'assistant', display: 'О1', created_at: 'b' },
      { seq: 5, role: 'user', display: 'В2', created_at: 'c' },
      { seq: 8, role: 'assistant', display: 'О2', created_at: 'd' },
    ]
    const cards = [{ id: 'k', kind: 'excel', title: 'Ф', status: 'done', payload: {}, result: null, question_seq: 5 }]
    expect(transcriptItems(rows, cards).map(i => (i.type === 'card' ? 'card' : i.text))).toEqual(['В1', 'О1', 'В2', 'О2', 'card'])
  })
})
