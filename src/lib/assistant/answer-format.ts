/**
 * Turns the assistant's plain answer into blocks for the screen: paragraphs and
 * bullet lists, with **bold** spans. Nothing else is interpreted, and nothing is
 * ever rendered as HTML, so text from the data cannot inject markup.
 */
export type Span = { text: string; bold: boolean }
export type Block = { kind: 'p'; lines: Span[][] } | { kind: 'ul'; items: Span[][] }

export function spans(line: string): Span[] {
  const out: Span[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), bold: false })
    out.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false })
  return out
}

const BULLET = /^\s*(?:[-•*]|\d+[.)])\s+/

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = []
  for (const chunk of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').filter(l => l.trim() !== '')
    let para: Span[][] = []
    let list: Span[][] = []
    const flushPara = () => { if (para.length) blocks.push({ kind: 'p', lines: para }); para = [] }
    const flushList = () => { if (list.length) blocks.push({ kind: 'ul', items: list }); list = [] }
    for (const l of lines) {
      if (BULLET.test(l)) { flushPara(); list.push(spans(l.replace(BULLET, ''))) }
      else { flushList(); para.push(spans(l.replace(/^#+\s*/, ''))) }
    }
    flushPara()
    flushList()
  }
  return blocks
}
