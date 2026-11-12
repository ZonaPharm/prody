import { matchesCode, normalizeCode, type ProductCodes } from './index'

export type ScanResult<P> =
  | { kind: 'add'; product: P }
  | { kind: 'out'; product: P }
  | { kind: 'none'; code: string }

/**
 * What a scanned code means at the till: a product in stock here (add it to the
 * cart), one that has run out in this store (say so), or nothing with that code.
 */
export function findByScan<P extends ProductCodes>(code: string, inStock: P[], outOfStock: P[] = []): ScanResult<P> {
  const c = normalizeCode(code)
  const here = inStock.find(p => matchesCode(p, c))
  if (here) return { kind: 'add', product: here }
  const gone = outOfStock.find(p => matchesCode(p, c))
  if (gone) return { kind: 'out', product: gone }
  return { kind: 'none', code: c }
}

/**
 * A barcode scanner is a keyboard that types very fast and presses Enter. This
 * collects keys typed while no field has the focus and hands back the code on
 * Enter when it came in at scanner speed, so a scan works even when nobody
 * clicked into the search box first. A person typing slowly is ignored.
 */
export class ScanBuffer {
  private chars = ''
  private last = 0

  constructor(
    /** Longest pause between two keys of one scan, ms. */
    private readonly maxGapMs = 60,
    /** Shortest code worth looking up. */
    private readonly minLength = 6,
  ) {}

  /** Feed one key; returns the scanned code on Enter, else null. */
  key(key: string, now: number): string | null {
    if (key === 'Enter') {
      const code = this.chars
      this.chars = ''
      return code.length >= this.minLength ? code : null
    }
    if (key.length !== 1) return null // Shift and the like
    if (this.chars && now - this.last > this.maxGapMs) this.chars = ''
    this.chars += key
    this.last = now
    return null
  }

  reset() {
    this.chars = ''
  }
}
