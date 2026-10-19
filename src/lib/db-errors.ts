/**
 * Whether a database error means "that is not in this database yet".
 *
 * A deploy can reach production before its migration does. A route that reads
 * a table, column or function the migration adds must carry on as it did
 * before rather than fail — and must tell that case apart from a real failure,
 * which it must not paper over. PostgREST and Postgres each have their own
 * codes for a missing table, column and function; any of them, and nothing
 * else, counts.
 */
const MISSING = new Set([
  "PGRST202", // function not found in the schema cache
  "PGRST204", // column not found in the schema cache
  "PGRST205", // table not found in the schema cache
  "42P01", // undefined_table
  "42703", // undefined_column
  "42883", // undefined_function
]);

export function notMigratedYet(error: { code?: string | null } | null | undefined): boolean {
  return Boolean(error?.code && MISSING.has(error.code));
}
