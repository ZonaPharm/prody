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
  stock_quantity?: number
  manage_stock?: boolean
  meta_data?: { key: string; value: string }[]
  categories?: { id: number }[]
}

export type WooProduct = {
  id: number
  name: string
  permalink: string
}

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
    try {
      const parsed = JSON.parse(text)
      if (parsed?.message) detail = parsed.message
    } catch { /* keep the raw text */ }
    throw new Error(`WooCommerce отказа (${res.status}): ${detail}`)
  }

  return JSON.parse(text) as WooProduct
}

export async function createProduct(input: WooProductInput): Promise<WooProduct> {
  return request('/products', 'POST', input)
}

export async function updateProduct(id: number, input: WooProductInput): Promise<WooProduct> {
  return request(`/products/${id}`, 'PUT', input)
}
