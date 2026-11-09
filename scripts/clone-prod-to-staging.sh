#!/bin/bash
# Clone the Prody production database into the staging project.
#
# Copies: public schema (structure + data), the auth users needed to log in,
# and the exact privileges production gives each role on tables and functions.
# Does NOT copy Storage objects — product_images.url keeps pointing at the
# production bucket, so images still render in staging (read-only).
#
# Production is only ever read from. Everything that writes goes to staging,
# inside one transaction: if any step fails, staging is left as it was.
#
# Usage — copy both URIs from the Supabase dashboard (project > Connect >
# Session pooler; the pooler works over IPv4, the direct host may not):
#   read -rsp 'Production DB URI: ' PROD_DB_URL && echo && export PROD_DB_URL
#   read -rsp 'Staging DB URI: '    STAGING_DB_URL && echo && export STAGING_DB_URL
#   ./scripts/clone-prod-to-staging.sh
#
# Requires pg_dump/psql 17 (both projects run Postgres 17).

set -euo pipefail

PROD_REF="ocvmqlbfkloskabicxuw"
STAGING_REF="ruhhsixmqusnpiajkbxe"

if [ -z "${PROD_DB_URL:-}" ] || [ -z "${STAGING_DB_URL:-}" ]; then
  echo "Error: PROD_DB_URL and STAGING_DB_URL must both be set." >&2
  exit 1
fi

# Safety rails: this script drops and recreates the target's public schema.
# It must never be able to run against production.
case "$STAGING_DB_URL" in
  *"$PROD_REF"*)
    echo "REFUSING: STAGING_DB_URL points at production ($PROD_REF)." >&2
    exit 1
    ;;
  *"$STAGING_REF"*) ;;
  *)
    echo "REFUSING: STAGING_DB_URL does not point at the staging project ($STAGING_REF)." >&2
    exit 1
    ;;
esac

case "$PROD_DB_URL" in
  *"$PROD_REF"*) ;;
  *)
    echo "REFUSING: PROD_DB_URL does not point at production ($PROD_REF)." >&2
    exit 1
    ;;
esac

PG_MAJOR=$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')
if [ "$PG_MAJOR" != "17" ]; then
  echo "Error: pg_dump $PG_MAJOR found; use pg_dump/psql 17 to match both servers." >&2
  exit 1
fi

# -X: ignore ~/.psqlrc, so nothing on the operator's machine (AUTOCOMMIT off,
# say) changes what these statements do.
PSQL=(psql -X -v ON_ERROR_STOP=1 --quiet)

# The dumps hold production data, password hashes included. Owner-only, and
# removed on exit whatever happens.
umask 077
DIR="$(cd "$(dirname "$0")/.." && pwd)/.clone-tmp"
mkdir -p "$DIR"
trap 'rm -rf "$DIR"' EXIT

# One line per role per table and function in public, e.g.
#   fn  is_admin() anon=-      tbl sales authenticated=SIUD
# Run against both databases at the end: any difference fails the clone.
PRIVILEGE_FINGERPRINT_SQL="
select line from (
  select 'fn  ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || r.role || '=' ||
         case when has_function_privilege(r.role, p.oid, 'EXECUTE') then 'X' else '-' end as line
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin')) as r(role)
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 'tbl ' || c.relname || ' ' || r.role || '=' ||
         case when has_table_privilege(r.role, c.oid, 'SELECT') then 'S' else '-' end ||
         case when has_table_privilege(r.role, c.oid, 'INSERT') then 'I' else '-' end ||
         case when has_table_privilege(r.role, c.oid, 'UPDATE') then 'U' else '-' end ||
         case when has_table_privilege(r.role, c.oid, 'DELETE') then 'D' else '-' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role)
  where n.nspname = 'public' and c.relkind = 'r'
) s order by 1;"

echo "==> 1/5  Dumping production schema"
pg_dump "$PROD_DB_URL" --schema-only --schema=public \
  --no-owner --no-privileges --quote-all-identifiers > "$DIR/schema.sql"

echo "==> 2/5  Dumping production data"
pg_dump "$PROD_DB_URL" --data-only --schema=public \
  --no-owner --no-privileges --quote-all-identifiers > "$DIR/data.sql"

# Only the two tables Supabase needs to authenticate a user. Copying all of
# auth would drag in sessions and refresh tokens, which are worthless here.
echo "==> 3/5  Dumping auth users"
pg_dump "$PROD_DB_URL" --data-only \
  --table='auth.users' --table='auth.identities' \
  --no-owner --no-privileges --quote-all-identifiers > "$DIR/auth.sql"

# The dumps run with --no-privileges, so function privileges have to be carried
# across separately. Restored without them, every function would fall back to
# the default of being callable by anyone — which reopens decrement_product_stock
# to anonymous callers, the hole closed in production on 9 November 2026.
# Each function's ACL is reproduced as production has it, roles beyond
# anon/authenticated included: handle_new_user must stay callable by
# supabase_auth_admin, or creating a user in staging fails.
echo "==> 4/5  Reading production privileges"
"${PSQL[@]}" "$PROD_DB_URL" -At > "$DIR/function-acl.sql" <<'SQL'
select stmt from (
  select p.oid, 0 as ord,
    format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated, service_role;',
           p.proname, pg_get_function_identity_arguments(p.oid)) as stmt
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.proacl is not null
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select p.oid, 1,
    format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO %s;',
           p.proname, pg_get_function_identity_arguments(p.oid),
           case when a.grantee = 0 then 'PUBLIC' else quote_ident(r.rolname) end)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  left join pg_roles r on r.oid = a.grantee
  where n.nspname = 'public' and p.prokind = 'f' and p.proacl is not null
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
) s order by oid, ord, stmt;
SQL
"${PSQL[@]}" "$PROD_DB_URL" -At -c "$PRIVILEGE_FINGERPRINT_SQL" > "$DIR/prod-privileges.txt"

echo "==> 5/5  Replacing staging (one transaction)"
{
  cat <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
DELETE FROM auth.identities;
DELETE FROM auth.users;
SQL

  # session_replication_role=replica suppresses triggers and FK checks during
  # the load. Without it on_auth_user_created fires while auth.users is being
  # restored and fights with the public.users rows inserted after it.
  echo "SET session_replication_role = replica;"
  grep -v -E '^CREATE SCHEMA "?public"?;' "$DIR/schema.sql"
  echo "SET session_replication_role = replica;"
  cat "$DIR/auth.sql"
  echo "SET session_replication_role = replica;"
  cat "$DIR/data.sql"
  echo "SET session_replication_role = DEFAULT;"

  cat <<'SQL'
-- Table privileges: open, as Supabase sets them; RLS does the access control.
-- Checked against production by the fingerprint below.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
SQL

  # Function privileges, exactly as production has them (step 4).
  cat "$DIR/function-acl.sql"

  cat <<'SQL'
-- pg_dump only covers the public schema, so this auth trigger is not carried
-- over. Without it a newly signed-up user gets no public.users row.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Staging must not mail real people. The copied settings carry production's
-- SMTP password and recipient list, so a report sent from a preview deploy
-- would reach them. Clearing both stops every outgoing message.
UPDATE public.email_settings SET smtp_pass = NULL, recipients = '[]'::jsonb;

-- PostgREST caches the schema. Dropping it invalidates that cache, and until
-- it reloads every request fails with PGRST205, which the app surfaces as an
-- endless redirect back to /login. Delivered when the transaction commits.
NOTIFY pgrst, 'reload schema';
SQL
} | "${PSQL[@]}" --single-transaction "$STAGING_DB_URL"

echo
echo "Checking staging privileges against production..."
"${PSQL[@]}" "$STAGING_DB_URL" -At -c "$PRIVILEGE_FINGERPRINT_SQL" > "$DIR/staging-privileges.txt"
if ! diff -u "$DIR/prod-privileges.txt" "$DIR/staging-privileges.txt"; then
  echo "FAILED: staging privileges differ from production (lines above: - production, + staging)." >&2
  echo "The data is in place, but do not test permissions on staging until this is fixed." >&2
  exit 1
fi
echo "Privileges match: $(wc -l < "$DIR/prod-privileges.txt" | tr -d ' ') checks."

echo
echo "Done. Staging mirrors production as of $(date -u +'%Y-%m-%d %H:%M UTC')."
COUNTS_SQL="select 'products', count(*) from public.products
  union all select 'sales', count(*) from public.sales
  union all select 'stock_batches', count(*) from public.stock_batches
  union all select 'users', count(*) from public.users
  union all select 'auth users', count(*) from auth.users"
echo "production:"; "${PSQL[@]}" "$PROD_DB_URL" -At -F ': ' -c "$COUNTS_SQL" | sed 's/^/  /'
echo "staging:";    "${PSQL[@]}" "$STAGING_DB_URL" -At -F ': ' -c "$COUNTS_SQL" | sed 's/^/  /'
