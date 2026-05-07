// src/lib/inventory.ts

import { createAdminClient } from '@/lib/supabase/admin'

interface BatchRow {
  id: string
  quantity_remaining: number
  unit_cost: number
}

/** Find oldest batches with remaining stock for a product in a store (FIFO order) */
export async function getFIFOBatches(
  productId: string,
  storeId: string,
  neededQty: number
): Promise<{ batches: BatchRow[]; total: number }> {
  const admin = createAdminClient()
  const { data } = await (admin.from('stock_batches') as any)
    .select('id, quantity_remaining, unit_cost')
    .eq('product_id', productId)
    .eq('store_id', storeId)
    .gt('quantity_remaining', 0)
    .order('created_at', { ascending: true })

  const batches = (data || []) as BatchRow[]
  const total = batches.reduce((sum, b) => sum + b.quantity_remaining, 0)
  return { batches, total }
}

interface DeductResult {
  deductedFrom: { batchId: string; qty: number; unitCost: number }[]
  remainingNeeded: number
}

/** Deduct from batches using FIFO. Returns what was deducted and what's still needed. */
export function calculateFIFODeduction(
  batches: BatchRow[],
  neededQty: number
): DeductResult {
  const deductedFrom: { batchId: string; qty: number; unitCost: number }[] = []
  let remaining = neededQty

  for (const batch of batches) {
    if (remaining <= 0) break
    const take = Math.min(remaining, batch.quantity_remaining)
    deductedFrom.push({ batchId: batch.id, qty: take, unitCost: batch.unit_cost })
    remaining -= take
  }

  return { deductedFrom, remainingNeeded: remaining }
}

interface RestockInput {
  productId: string
  totalQty: number
  unitCost: number
  userId: string
  distribution: { storeId: string; qty: number }[]
  notes?: string
}

/** Create restock: batches per store + movements. Uses admin client to bypass RLS. */
export async function executeRestock(input: RestockInput) {
  const admin = createAdminClient()

  // Separate allocated vs unallocated
  const allocated = input.distribution.filter(d => d.qty > 0)
  const allocatedTotal = allocated.reduce((s, d) => s + d.qty, 0)
  const unallocated = input.totalQty - allocatedTotal

  // Find warehouse store
  const { data: warehouse } = await (admin.from('stores') as any)
    .select('id')
    .eq('is_warehouse', true)
    .limit(1)
    .single()

  const warehouseId = warehouse?.id || allocated[0]?.storeId || input.distribution[0]?.storeId

  const results: { storeId: string; batchId: string; qty: number }[] = []

  // Create batches and movements for allocated quantities
  for (const d of allocated) {
    const { data: batch } = await (admin.from('stock_batches') as any)
      .insert({
        product_id: input.productId,
        store_id: d.storeId,
        quantity_remaining: d.qty,
        unit_cost: input.unitCost,
      })
      .select('id')
      .single()

    if (batch) {
      await (admin.from('stock_movements') as any).insert({
        product_id: input.productId,
        store_id: d.storeId,
        batch_id: batch.id,
        type: 'restock',
        quantity: d.qty,
        unit_cost: input.unitCost,
        notes: input.notes || null,
        created_by: input.userId,
      })
      results.push({ storeId: d.storeId, batchId: batch.id, qty: d.qty })
    }
  }

  // Unallocated goes to warehouse
  if (unallocated > 0 && warehouseId) {
    const { data: batch } = await (admin.from('stock_batches') as any)
      .insert({
        product_id: input.productId,
        store_id: warehouseId,
        quantity_remaining: unallocated,
        unit_cost: input.unitCost,
      })
      .select('id')
      .single()

    if (batch) {
      await (admin.from('stock_movements') as any).insert({
        product_id: input.productId,
        store_id: warehouseId,
        batch_id: batch.id,
        type: 'restock',
        quantity: unallocated,
        unit_cost: input.unitCost,
        notes: input.notes || null,
        created_by: input.userId,
      })
      results.push({ storeId: warehouseId, batchId: batch.id, qty: unallocated })
    }
  }

  // Update product quantity_on_hand
  await (admin.from('products') as any)
    .select('quantity_on_hand')
    .eq('id', input.productId)
    .single()
    .then(({ data: prod }: any) => {
      if (prod) {
        return (admin.from('products') as any)
          .update({ quantity_on_hand: prod.quantity_on_hand + input.totalQty })
          .eq('id', input.productId)
      }
    })

  return results
}

/** Execute FIFO deduction after a sale. Creates sell movements and updates batches. */
export async function executeSaleFIFO(
  productId: string,
  storeId: string,
  qty: number,
  salePrice: number,
  saleId: string,
  userId: string
) {
  const admin = createAdminClient()
  const { batches } = await getFIFOBatches(productId, storeId, qty)
  const { deductedFrom, remainingNeeded } = calculateFIFODeduction(batches, qty)

  if (remainingNeeded > 0) {
    throw new Error(`Недостатъчна наличност: липсват ${remainingNeeded} бр.`)
  }

  for (const d of deductedFrom) {
    // Update batch remaining
    const { data: batch } = await (admin.from('stock_batches') as any)
      .select('quantity_remaining')
      .eq('id', d.batchId)
      .single()

    if (batch) {
      await (admin.from('stock_batches') as any)
        .update({ quantity_remaining: batch.quantity_remaining - d.qty })
        .eq('id', d.batchId)
    }

    // Create sell movement
    await (admin.from('stock_movements') as any).insert({
      product_id: productId,
      store_id: storeId,
      batch_id: d.batchId,
      type: 'sell',
      quantity: -d.qty,
      unit_cost: d.unitCost,
      unit_price: salePrice,
      sale_id: saleId,
      created_by: userId,
    })
  }
}

/** Get product inventory: stock per store + recent movements */
export async function getProductInventory(productId: string) {
  const admin = createAdminClient()

  // Fetch all data in parallel
  const [{ data: batches }, { data: movements }, { data: stores }] = await Promise.all([
    (admin.from('stock_batches') as any)
      .select('id, store_id, quantity_remaining, unit_cost, created_at')
      .eq('product_id', productId)
      .gt('quantity_remaining', 0)
      .order('created_at'),
    (admin.from('stock_movements') as any)
      .select('id, type, quantity, unit_cost, unit_price, store_id, source_store_id, notes, created_at')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(50),
    (admin.from('stores') as any)
      .select('id, name')
      .eq('is_active', true),
  ])

  // Build store name lookup
  const storeMap: Record<string, string> = {}
  ;(stores || []).forEach((s: any) => { storeMap[s.id] = s.name })

  // Attach store names
  const batchesWithStore = (batches || []).map((b: any) => ({
    ...b,
    store: { name: storeMap[b.store_id] || '—' },
  }))

  const movementsWithStore = (movements || []).map((m: any) => ({
    ...m,
    store: { name: storeMap[m.store_id] || '—' },
  }))

  return { batches: batchesWithStore, movements: movementsWithStore }
}
