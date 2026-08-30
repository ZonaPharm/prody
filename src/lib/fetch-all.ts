/**
 * PostgREST caps every response at 1000 rows (db-max-rows). A query that walks
 * past that cap comes back silently truncated — no error, no flag — so any
 * total computed from it is quietly wrong.
 *
 * fetchAll pages through the full result set with .range() until a short page
 * says there is nothing left.
 */
const PAGE_SIZE = 1000

type RangeQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
}

export async function fetchAll<T>(
  buildQuery: () => RangeQuery<T>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = data || []
    out.push(...page)
    if (page.length < pageSize) return out
  }
}

/**
 * Look up rows by a list of ids. The ids travel in the query string, so a long
 * list has to be split or the URL exceeds what the server will accept — which
 * surfaces as an opaque "fetch failed" rather than a PostgREST error.
 */
export async function fetchByIds<T>(
  buildQuery: (ids: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
  ids: string[],
  chunkSize = 200,
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const { data, error } = await buildQuery(ids.slice(i, i + chunkSize))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}
