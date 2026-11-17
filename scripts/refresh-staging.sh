#!/bin/bash
# Refresh the Prody staging database from production.
#
# Run by the "Обнови staging от продукшън" GitHub Action
# (.github/workflows/refresh-staging.yml); it can also be run by hand.
#
# Copies: the public schema (structure and data), the auth users needed to log
# in, the exact privileges production gives each role on tables and functions,
# and production's Storage policies. Does NOT copy Storage files:
# product_images.url keeps pointing at the production bucket, so images still
# render in staging (read-only).
#
# Production is only ever read from. Everything that writes goes to staging,
# inside one transaction: if any step fails, staging is left as it was.
#
# Staging loses whatever only it had: its own test accounts and data in public.
# Its migration history (supabase_migrations) is left alone.
#
# By hand, copy both URIs from the Supabase dashboard (project > Connect >
# Session pooler; the pooler works over IPv4, the direct host may not):
#   read -rsp 'Production DB URI: ' PROD_DB_URL && echo && export PROD_DB_URL
#   read -rsp 'Staging DB URI: '    STAGING_DB_URL && echo && export STAGING_DB_URL
#   ./scripts/refresh-staging.sh
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
  *"$STAGING_REF"*)
    echo "REFUSING: PROD_DB_URL points at staging ($STAGING_REF); are the two swapped?" >&2
    exit 1
    ;;
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

# Postgres error output can quote the row it failed on (CONTEXT: COPY ...,
# DETAIL: Key (email)=...). In a GitHub Action that would put production data
# into the run log, so only the error itself and where it happened are shown.
show_errors() {
  sed -E \
    -e 's/^(CONTEXT:  COPY [^,]+, line [0-9]+).*/\1/' \
    -e 's/^(DETAIL:  ).*/\1(hidden: may contain data)/' \
    -e '/^LINE [0-9]+:/d' -e '/^ +\^$/d' \
    "$1" >&2
}

# Read-only queries against production go through here.
prod_query() {
  "${PSQL[@]}" "$PROD_DB_URL" -At "$@"
}

# One line per role per table and function in public, plus one per Storage
# policy, e.g.
#   fn  is_admin() anon=-      tbl sales authenticated=SIUD
# Run against both databases at the end: any difference fails the refresh.
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
  union all
  select 'pol ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || cmd || ' ' ||
         roles::text || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-')
  from pg_policies where schemaname = 'storage'
) s order by 1;"

echo "==> 1/6  Dumping production schema"
pg_dump "$PROD_DB_URL" --schema-only --schema=public \
  --no-owner --no-privileges --quote-all-identifiers > "$DIR/schema.sql"

echo "==> 2/6  Dumping production data"
pg_dump "$PROD_DB_URL" --data-only --schema=public \
  --no-owner --no-privileges --quote-all-identifiers > "$DIR/data.sql"

# Only the two tables Supabase needs to authenticate a user. Copying all of
# auth would drag in sessions and refresh tokens, which are worthless here.
echo "==> 3/6  Dumping auth users"
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
echo "==> 4/6  Reading production privileges"
prod_query > "$DIR/function-acl.sql" <<'SQL'
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

# Storage policies live outside public but call into it (is_admin()), so
# DROP SCHEMA public CASCADE below takes them with it. Rebuilt from production's
# definitions; the ones that do not touch public are rebuilt too, so staging
# ends up with exactly production's set.
echo "==> 5/6  Reading production Storage policies"
prod_query > "$DIR/storage-policies.sql" <<'SQL'
select format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
              policyname, schemaname, tablename, permissive, cmd,
              (select string_agg(case when r = 'public' then 'PUBLIC' else quote_ident(r) end, ', ')
                 from unnest(roles) r),
              case when qual is not null then ' USING (' || qual || ')' else '' end,
              case when with_check is not null then ' WITH CHECK (' || with_check || ')' else '' end)
from pg_policies where schemaname = 'storage'
order by tablename, policyname;
SQL
prod_query -c "$PRIVILEGE_FINGERPRINT_SQL" > "$DIR/prod-privileges.txt"

echo "==> 6/6  Replacing staging (one transaction)"
if ! {
  cat <<'SQL'
SET client_min_messages = warning;
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
  # The dumps reset search_path to empty; the policy expressions below name
  # public functions unqualified, as production stores them.
  echo "SET search_path = public, extensions;"

  cat <<'SQL'
-- Table privileges: open, as Supabase sets them; RLS does the access control.
-- Checked against production by the fingerprint below.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
SQL

  # Function privileges, exactly as production has them (step 4).
  cat "$DIR/function-acl.sql"

  # Storage policies, exactly as production has them (step 5).
  cat <<'SQL'
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'storage' LOOP
    EXECUTE format('DROP POLICY %I ON storage.%I', p.policyname, p.tablename);
  END LOOP;
END $$;
SQL
  cat "$DIR/storage-policies.sql"

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
} | "${PSQL[@]}" --single-transaction "$STAGING_DB_URL" > /dev/null 2> "$DIR/load.err"; then
  show_errors "$DIR/load.err"
  echo "FAILED: nothing was changed in staging (the load runs as one transaction)." >&2
  exit 1
fi

echo
echo "Checking staging privileges and Storage policies against production..."
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
  union all select 'sales today', count(*) from public.sales where sale_date = current_date
  union all select 'stock_batches', count(*) from public.stock_batches
  union all select 'users', count(*) from public.users
  union all select 'auth users', count(*) from auth.users"
echo "production:"; prod_query -F ': ' -c "$COUNTS_SQL" | sed 's/^/  /'
echo "staging:";    "${PSQL[@]}" "$STAGING_DB_URL" -At -F ': ' -c "$COUNTS_SQL" | sed 's/^/  /'
