/**
 * Minimal WooCommerce REST API v3 client.
 *
 * Only what pushing a product needs: create, update, and a way to ask whether
 * the shop is configured at all. Credentials come from the environment and are
 * never logged — an error from here carries WooCommerce's own message, not the
 * request that produced it.
 */

const BASE = process.env.WOOCOMMERCE_URL
const KEY = process.env.WOOCOMMERCE_CONSUMER_KEY
const SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET

export type WooProductInput = {
  name: string
  description?: string
  short_description?: string
  regular_price?: string
  sku?: string
  meta_data?: { key: string; value: string }[]
  categories?: { id: number }[]
  images?: { id: number }[]
}

// Deliberately absent: stock_quantity and manage_stock. This shop runs every
// product with manage_stock false, and sending a quantity made a pushed
// product advertise stock it does not track. Prody remains the stock system.

export type WooProduct = {
  id: number
  name: string
  permalink: string
}

/** An Error carrying WooCommerce's HTTP status and error code, so callers can branch on them. */
export type WooError = Error & { status?: number; code?: string }

/** The shop's answer when the product id in an update no longer exists. */
export const WOO_INVALID_ID = 'woocommerce_rest_product_invalid_id'

export function isWooConfigured(): boolean {
  return Boolean(BASE && KEY && SECRET)
}

function authHeader(): string {
  // WooCommerce accepts basic auth over HTTPS; the key pair is the credential.
  return 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64')
}

async function request(path: string, method: 'POST' | 'PUT', body: unknown): Promise<WooProduct> {
  if (!isWooConfigured()) {
    throw new Error('WooCommerce не е настроен (липсват WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY или WOOCOMMERCE_CONSUMER_SECRET)')
  }

  const res = await fetch(`${BASE!.replace(/\/$/, '')}/wp-json/wc/v3${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })

  const text = await res.text()

  if (!res.ok) {
    // Surface WooCommerce's own message rather than a generic failure: the
    // difference between a bad credential and a rejected field matters to
    // whoever is looking at the screen.
    let detail = text.slice(0, 300)
    let code: string | undefined
    try {
      const parsed = JSON.parse(text)
      if (parsed?.message) detail = parsed.message
      if (typeof parsed?.code === 'string') code = parsed.code
    } catch { /* keep the raw text */ }
    // Status and code travel as fields, not only inside the message: a caller
    // needs to tell "the shop record is gone" from every other refusal, and
    // parsing that back out of Bulgarian prose would be brittle. The code
    // matters more than the status here — updating a deleted product answers
    // 400 with woocommerce_rest_product_invalid_id, not the 404 that fetching
    // the same id gives. Verified against the live shop.
    const error = new Error(`WooCommerce отказа (${res.status}): ${detail}`) as WooError
    error.status = res.status
    error.code = code
    throw error
  }

  return JSON.parse(text) as WooProduct
}

export async function createProduct(input: WooProductInput): Promise<WooProduct> {
  return request('/products', 'POST', input)
}

export async function updateProduct(id: number, input: WooProductInput): Promise<WooProduct> {
  return request(`/products/${id}`, 'PUT', input)
}

/** Whether the shop product already carries at least one image. */
export async function productHasImage(id: number): Promise<boolean> {
  if (!isWooConfigured()) return false

  const res = await fetch(
    `${BASE!.replace(/\/$/, '')}/wp-json/wc/v3/products/${id}?_fields=images`,
    { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(20000) },
  )

  if (!res.ok) throw new Error(`WooCommerce отказа (${res.status})`)

  const body = await res.json() as { images?: unknown[] }
  return Array.isArray(body.images) && body.images.length > 0
}
