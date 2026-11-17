/**
 * products.label_kind arrives with the migration 20261112_product_label_kind.sql.
 * Until that migration has run in a database (staging first, then production),
 * the screens must keep working on needs_label alone instead of failing to load:
 * a read retries without the column, a write leaves it out. labelKindOf() already
 * falls back to needs_label when label_kind is missing.
 */

type PgError = { code?: string; message?: string } | null | undefined

/** The database does not have products.label_kind yet. */
export function missingLabelKind(error: unknown): boolean {
  const e = error as PgError
  if (!e) return false
  // 42703: undefined column (select, filter); PGRST204: column not in the schema cache (insert, update).
  return (e.code === '42703' || e.code === 'PGRST204') && /label_kind/.test(e.message ?? '')
}

/** The same column list without label_kind. */
export function withoutLabelKind(columns: string): string {
  return columns.replace(/,\s*label_kind\b/g, '').replace(/\blabel_kind\s*,\s*/g, '')
}

/** Runs a read with label_kind, and once more without it if the column is not there yet. */
export async function selectWithLabelKind<T>(
  columns: string,
  run: (columns: string) => PromiseLike<{ data: T; error: unknown }>,
): Promise<{ data: T; error: unknown }> {
  const first = await run(columns)
  if (!missingLabelKind(first.error)) return first
  return run(withoutLabelKind(columns))
}
