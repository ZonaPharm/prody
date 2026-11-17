/**
 * Code 128 for the printed labels, without a library: the product's barcode (or SKU)
 * as bars any till scanner reads back as the same characters. Code set B for text,
 * code set C (two digits per symbol) for runs of digits, so an EAN of 13 digits stays
 * short enough for a small label.
 */

// Bar/space widths of symbols 0..106 (106 = stop, which has a 7th bar).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const START_C = 105
const CODE_B = 100
const CODE_C = 99
const STOP = 106

export const CODE128_PATTERNS = PATTERNS

/** Can this text become a Code 128 (code set B: printable ASCII)? */
export function code128Encodable(text: string): boolean {
  return text.length > 0 && text.length <= 48 && /^[\x20-\x7e]+$/.test(text)
}

/** The symbol values, start and checksum included, stop excluded. Null when not encodable. */
export function code128Symbols(text: string): number[] | null {
  if (!code128Encodable(text)) return null
  const out: number[] = []
  let set: 'B' | 'C' | null = null
  let i = 0
  // Digits run from i: how many.
  const digitsAt = (k: number) => {
    let n = 0
    while (k + n < text.length && text[k + n] >= '0' && text[k + n] <= '9') n++
    return n
  }
  while (i < text.length) {
    const run = digitsAt(i)
    // Code set C pays off for 4+ digits (or 2+ when the whole rest is digits); keep it even.
    const useC = run >= 4 || (run >= 2 && run === text.length - i)
    if (useC) {
      const pairs = Math.floor(run / 2)
      if (set !== 'C') {
        out.push(set === null ? START_C : CODE_C)
        set = 'C'
      }
      for (let p = 0; p < pairs; p++) {
        out.push(Number(text.slice(i, i + 2)))
        i += 2
      }
      continue
    }
    if (set !== 'B') {
      out.push(set === null ? START_B : CODE_B)
      set = 'B'
    }
    out.push(text.charCodeAt(i) - 32)
    i++
  }
  let sum = out[0]
  for (let k = 1; k < out.length; k++) sum += out[k] * k
  out.push(sum % 103)
  return out
}

/** The bars as widths in modules, alternating bar, space, bar…, quiet zones not included. */
export function code128Widths(text: string): number[] | null {
  const symbols = code128Symbols(text)
  if (!symbols) return null
  const widths: number[] = []
  for (const s of [...symbols, STOP]) for (const ch of PATTERNS[s]) widths.push(Number(ch))
  return widths
}

/** The bars as [x, width] in modules, for an SVG with viewBox "0 0 total h". */
export function code128Bars(text: string): { bars: [number, number][]; total: number } | null {
  const widths = code128Widths(text)
  if (!widths) return null
  const bars: [number, number][] = []
  let x = 0
  widths.forEach((w, k) => {
    if (k % 2 === 0) bars.push([x, w])
    x += w
  })
  return { bars, total: x }
}
