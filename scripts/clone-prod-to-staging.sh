#!/bin/bash
# Clone the Prody production database into the staging project.
#
# Copies: public schema (structure + data) and the auth users needed to log in.
# Does NOT copy Storage objects — product_images.url keeps pointing at the
# production bucket, so images still render in staging (read-only).
#
# Usage:
#   export PROD_DB_URL='postgresql://postgres:[PASSWORD]@db.ocvmqlbfkloskabicxuw.supabase.co:5432/postgres'
#   export STAGING_DB_URL='postgresql://postgres:[PASSWORD]@db.ruhhsixmqusnpiajkbxe.supabase.co:5432/postgres'
#   ./scripts/clone-prod-to-staging.sh
#
# Connection strings: Supabase Dashboard > Project Settings > Database > Connection string (URI).
# Requires pg_dump/psql 17 or newer (both projects run Postgres 17).

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

DIR="$(cd "$(dirname "$0")/.." && pwd)/.clone-tmp"
mkdir -p "$DIR"
trap 'rm -rf "$DIR"' EXIT

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

echo "==> 4/6  Resetting staging public schema"
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
-- Supabase default: grants are open, RLS does the real access control.
-- These apply to tables created *after* this point, i.e. the restore below.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
DELETE FROM auth.identities;
DELETE FROM auth.users;
SQL

echo "==> 5/6  Restoring into staging"
# session_replication_role=replica suppresses triggers and FK checks during the
# load. Without it the on_auth_user_created trigger fires while auth.users is
# being restored and fights with the public.users rows we are about to insert.
{
  echo "SET session_replication_role = replica;"
  grep -v -E '^CREATE SCHEMA "?public"?;' "$DIR/schema.sql"
  echo "SET session_replication_role = replica;"
  cat "$DIR/auth.sql"
  echo "SET session_replication_role = replica;"
  cat "$DIR/data.sql"
} | psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 --quiet

echo "==> 6/6  Restoring role grants"
# pg_dump runs with --no-privileges, so table-level GRANTs are not carried over.
# Without these every authenticated query fails with "permission denied for
# table ...", which leaves the app redirecting in a loop after login.
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 --quiet <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- pg_dump only covers the public schema, so this auth trigger is not carried
-- over. Without it a newly signed-up user gets no public.users row.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- PostgREST caches the schema. The DROP SCHEMA above invalidates it, and until
-- it reloads every request fails with PGRST205 "Could not find the table ...",
-- which the app surfaces as an endless redirect back to /login.
NOTIFY pgrst, 'reload schema';
SQL

echo
echo "Done. Staging now mirrors production as of $(date -u +'%Y-%m-%d %H:%M UTC')."
psql "$STAGING_DB_URL" -t -c "select 'products: '||count(*) from public.products
  union all select 'sales: '||count(*) from public.sales
  union all select 'stock_batches: '||count(*) from public.stock_batches
  union all select 'users: '||count(*) from public.users
  union all select 'auth users: '||count(*) from auth.users;"
