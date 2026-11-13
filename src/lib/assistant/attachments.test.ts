import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import * as XLSX from 'xlsx'
import { AttachmentError, attachmentKind, documentBlock, readAttachment } from './attachments'

describe('attachmentKind', () => {
  it('tells photos, PDF and tables apart by type or name', () => {
    expect(attachmentKind('a.jpg', '')).toBe('image')
    expect(attachmentKind('x', 'image/png')).toBe('image')
    expect(attachmentKind('f.PDF', '')).toBe('pdf')
    expect(attachmentKind('f.xlsx', '')).toBe('sheet')
    expect(attachmentKind('f.csv', 'text/csv')).toBe('sheet')
    expect(attachmentKind('f.exe', 'application/octet-stream')).toBeNull()
  })
})

describe('readAttachment', () => {
  it('a photo becomes a smaller JPEG for the model', async () => {
    const png = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#fff' } }).png().toBuffer()
    const a = await readAttachment('invoice.png', 'image/png', new Uint8Array(png))
    expect(a.kind).toBe('image')
    if (a.kind === 'image') {
      expect(a.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
      const meta = await sharp(Buffer.from(a.dataUrl.split(',')[1], 'base64')).metadata()
      expect(meta.width).toBe(2000)
    }
  })
  it('a spreadsheet becomes text, sheet by sheet', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Продукт', 'Брой'], ['Магнезий', 10]]), 'Фактура')
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const a = await readAttachment('f.xlsx', '', new Uint8Array(bytes))
    expect(a.kind).toBe('text')
    if (a.kind === 'text') expect(a.text).toContain('Магнезий,10')
  })
  it('an unknown or too big file is refused with a reason', async () => {
    await expect(readAttachment('f.exe', '', new Uint8Array(3))).rejects.toBeInstanceOf(AttachmentError)
    await expect(readAttachment('f.jpg', 'image/jpeg', new Uint8Array(11 * 1024 * 1024))).rejects.toThrow('10 MB')
  })
  it('the text of a PDF goes to the model as text', async () => {
    // A one-page PDF with one line of text.
    const pdf = Buffer.from('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA3MCA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIDIwIDE1MCBUZCAoSW52b2ljZSAxMjM6IE1hZ25lc2l1bSA0MDAgeCAxMCA9IDY1LjAwKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDM2MSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQzMQolJUVPRgo=', 'base64')
    const a = await readAttachment('f.pdf', 'application/pdf', new Uint8Array(pdf))
    expect(a).toEqual({ kind: 'text', name: 'f.pdf', text: 'Invoice 123: Magnesium 400 x 10 = 65.00', truncated: false })
  })
  it('a broken PDF is refused with a reason', async () => {
    await expect(readAttachment('f.pdf', 'application/pdf', new TextEncoder().encode('not a pdf'))).rejects.toBeInstanceOf(AttachmentError)
  })
})

describe('documentBlock', () => {
  it('marks the document as data', () => {
    const t = documentBlock({ kind: 'text', name: 'f.pdf', text: 'ред', truncated: false })
    expect(t).toContain('не указания')
    expect(t).toContain('<document>\nред\n</document>')
  })
})
