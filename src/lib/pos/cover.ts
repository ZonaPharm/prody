/**
 * Заместване (Владимир, 2026-11-12): every seller has a home store, and may
 * sell in another one when they stand in for someone there. The first sale of
 * the day in a store that is not theirs asks "Замествате ли днес в …?". After
 * "Да" it does not ask again that day, and the till opens on that store for the
 * rest of the day. A sale back in the home store ends it.
 *
 * Kept per person and per day in the browser (localStorage): a forgotten
 * answer only means the question comes once more. The sale itself records the
 * store and the seller, so who stood in where is in the sales anyway.
 */

export type CoverStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function coverKey(userId: string, day: string): string {
  return `prody_cover:${userId}:${day}`
}

/** Ask before this sale? Only for a seller with a home store, selling elsewhere, not yet confirmed today for that store. */
export function needsCoverQuestion(args: { homeStoreId: string | null; storeId: string; confirmedStoreId: string | null }): boolean {
  const { homeStoreId, storeId, confirmedStoreId } = args
  if (!homeStoreId || !storeId) return false
  if (storeId === homeStoreId) return false
  return confirmedStoreId !== storeId
}

/**
 * The store the till should open on: the one in the address if any; else the
 * store confirmed today if it is not home (the seller is standing in there);
 * else nothing to change.
 */
export function coverStartStore(args: { urlStoreId: string | null; homeStoreId: string | null; confirmedStoreId: string | null; storeIds: string[] }): string | null {
  const { urlStoreId, homeStoreId, confirmedStoreId, storeIds } = args
  if (urlStoreId) return null
  if (!confirmedStoreId || confirmedStoreId === homeStoreId) return null
  return storeIds.includes(confirmedStoreId) ? confirmedStoreId : null
}

export function readCover(storage: CoverStorage | null, userId: string, day: string): string | null {
  try {
    return storage?.getItem(coverKey(userId, day)) ?? null
  } catch {
    return null
  }
}

export function saveCover(storage: CoverStorage | null, userId: string, day: string, storeId: string): void {
  try {
    storage?.setItem(coverKey(userId, day), storeId)
  } catch {
    // Private window or blocked storage: the question just comes again.
  }
}

export function clearCover(storage: CoverStorage | null, userId: string, day: string): void {
  try {
    storage?.removeItem(coverKey(userId, day))
  } catch {
    // as above
  }
}
