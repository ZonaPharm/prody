#!/bin/bash
# Manual database backup script for Prody
# Usage: ./scripts/backup.sh
# Requires: pg_dump, DATABASE_URL in environment
# Output: ./backups/prody-backup-YYYY-MM-DDTHH-MM-SS.sql.gz

set -e

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL not set"
  echo "Get the connection string from Supabase Dashboard > Project Settings > Database > Connection string"
  echo "Then: export DATABASE_URL='postgresql://...'"
  exit 1
fi

DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
mkdir -p "$DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S")
FILE="$DIR/prody-backup-$TIMESTAMP.sql.gz"

echo "Backing up to $FILE ..."
pg_dump "$DATABASE_URL" | gzip > "$FILE"

SIZE=$(ls -lh "$FILE" | awk '{print $5}')
echo "Done. Size: $SIZE"
echo "To restore: gunzip -c $FILE | psql <DATABASE_URL>"
