/**
 * True when a PostgREST error says the table (or a column) is not in the
 * schema at all — as opposed to a read that failed.
 *
 * The deliveries tables arrive with migration 20261110_deliveries_schema,
 * which runs on staging first and on production later. Code that reads them
 * nightly (the backup, the integrity check) can be deployed in between; there
 * a missing table means "not migrated yet", not a hole in the data.
 *
 * PGRST205: table not in the schema cache. PGRST204: column not in the
 * schema cache. 42P01 / 42703: undefined table / column from Postgres itself
 * (older PostgREST, or an embedded resource).
 */
const MISSING_CODES = new Set(['PGRST205', 'PGRST204', '42P01', '42703'])

export function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && MISSING_CODES.has(code)
}
