/**
 * Product barcodes.
 *
 * Every product has an internal code the database gives it (products.internal_barcode,
 * migration 20261112_product_internal_barcode): "200" + a 9-digit number + the EAN-13
 * check digit. 200–299 is the GS1 range for in-store numbers, so it cannot be a real
 * factory EAN. The factory barcode, when someone scans it in, is products.barcode.
 *
 * A label prints the factory barcode when there is one, the internal code otherwise;
 * the till finds a product by either.
 */

export interface ProductCodes {
  barcode?: string | null
  internal_barcode?: string | null
  sku?: string | null
}

/** EAN-13 check digit of 12 digits (weights 1,3,1,3… from the left). */
export function ean13CheckDigit(code12: string): string {
  if (!/^\d{12}$/.test(code12)) throw new Error(`EAN-13 needs 12 digits, got "${code12}"`)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(code12[i]) * (i % 2 === 0 ? 1 : 3)
  return String((10 - (sum % 10)) % 10)
}

/** A 13-digit code with the right check digit. */
export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code[12]
}

/** One of our own internal codes (200…, valid EAN-13). */
export function isInternalBarcode(code: string): boolean {
  return code.startsWith('200') && isValidEan13(code)
}

/** What a scanner or a person typed, as stored: spaces around dropped. */
export function normalizeCode(text: string | null | undefined): string {
  return (text ?? '').trim()
}

/** The code printed on the product's label: factory barcode, else the internal code, else SKU. */
export function labelCode(p: ProductCodes): string {
  return normalizeCode(p.barcode) || normalizeCode(p.internal_barcode) || normalizeCode(p.sku)
}

/** Does this product answer to this scanned or typed code? Exact match only. */
export function matchesCode(p: ProductCodes, text: string): boolean {
  const code = normalizeCode(text)
  if (!code) return false
  return normalizeCode(p.barcode) === code || normalizeCode(p.internal_barcode) === code
}

/** Text that looks like a scan rather than a name: digits only, 6 or more. */
export function looksLikeCode(text: string): boolean {
  return /^\d{6,}$/.test(normalizeCode(text))
}

/**
 * A factory barcode typed into the product form: what is wrong with it, or null when
 * it can be saved. Empty is fine (no factory barcode). The database still refuses a
 * code that another product already has.
 */
export function factoryBarcodeProblem(text: string): string | null {
  const code = normalizeCode(text)
  if (!code) return null
  if (/\s/.test(code)) return 'Баркодът не може да съдържа интервали.'
  if (code.length > 48) return 'Баркодът е твърде дълъг.'
  if (!/^[\x21-\x7e]+$/.test(code)) return 'Баркодът може да съдържа само цифри и латински букви.'
  if (isInternalBarcode(code)) return 'Това е вътрешен код (започва с 200). Тук се въвежда само фабричният баркод от опаковката.'
  if (/^\d{13}$/.test(code) && !isValidEan13(code)) return 'Последната цифра не съвпада (контролна цифра). Сканирайте отново.'
  return null
}
