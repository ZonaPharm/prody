import { fetchAll } from '@/lib/fetch-all'
import { SALES_DAYS, type LowInput, type StoreQty } from './low-stock'

/**
 * Reads what low-stock.ts needs. Runs with the service key (createAdminClient)
 * after the page or route has checked the person: Офис has no right to read
 * sales, and only the per-store totals leave this function (the screen strips
 * even those for Офис, see withoutSales).
 */
export async function getLowStockInput(admin: any, now: Date = new Date()): Promise<LowInput> {
  const since = new Date(now.getTime() - SALES_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [stores, products, batches, sales, lines, requests] = await Promise.all([
    fetchAll<any>(() => admin.from('stores').select('id, name, is_warehouse').eq('is_active', true).order('id')),
    fetchAll<any>(() => admin.from('products').select('id, name, sku, min_quantity').eq('status', 'active').order('id')),
    fetchAll<any>(() => admin.from('stock_batches').select('id, store_id, product_id, quantity_remaining').order('id')),
    fetchAll<any>(() => admin
      .from('sales')
      .select('id, store_id, product_id, quantity')
      .gte('created_at', since)
      .or('voided.is.null,voided.eq.false')
      .order('id')),
    fetchAll<any>(() => admin
      .from('shipment_lines')
      .select('id, product_id, qty, shipment:shipments!shipment_lines_shipment_id_fkey!inner(store_id, status)')
      .in('shipment.status', ['packing', 'packed'])
      .order('id')),
    fetchAll<any>(() => admin
      .from('stock_requests')
      .select('id, store_id, product_id, requested_qty, shipped_qty, status')
      .in('status', ['pending', 'accepted', 'in_transit'])
      .order('id')),
  ])

  // The same "free" that add_office_stock checks; before migration
  // 20261112_deliveries_office_stock the function does not exist and the screen
  // falls back to Офис stock less what is already packed (low-stock.ts).
  let officeFree: Record<string, number> | undefined
  const { data: free, error: freeError } = await admin.rpc('office_free_stock', { p_product_ids: null })
  if (!freeError && Array.isArray(free)) {
    officeFree = Object.fromEntries(free.map((f: any) => [f.product_id, Number(f.free) || 0]))
  }

  const shipmentOf = (l: any) => (Array.isArray(l.shipment) ? l.shipment[0] : l.shipment)

  return {
    stores: stores.map((s: any) => ({ id: s.id, name: s.name, is_warehouse: !!s.is_warehouse })),
    products: products.map((p: any) => ({ id: p.id, name: p.name, sku: p.sku ?? null, min_quantity: p.min_quantity ?? null })),
    stock: batches.map((b: any): StoreQty => ({ store_id: b.store_id, product_id: b.product_id, qty: Number(b.quantity_remaining) || 0 })),
    sold: sales
      .filter((s: any) => s.store_id && s.product_id)
      .map((s: any): StoreQty => ({ store_id: s.store_id, product_id: s.product_id, qty: Number(s.quantity) || 0 })),
    onTrip: lines
      .filter((l: any) => l.product_id && shipmentOf(l)?.store_id)
      .map((l: any): StoreQty => ({ store_id: shipmentOf(l).store_id, product_id: l.product_id, qty: Number(l.qty) || 0 })),
    requested: requests
      .filter((r: any) => r.store_id && r.product_id)
      .map((r: any): StoreQty => ({
        store_id: r.store_id,
        product_id: r.product_id,
        qty: Number(r.status === 'in_transit' && r.shipped_qty !== null ? r.shipped_qty : r.requested_qty) || 0,
      })),
    officeFree,
  }
}
