# Prody Database Backup & Restore

## Overview

Daily backup at 3:00 AM UTC via Vercel cron → Supabase Storage `db-backups` bucket + email. Retention: 7 days.

## Backup Contents

Each backup (.json.gz) contains ALL data from all 14 tables:
products, product_images, categories, labels, stores, stock_batches, stock_movements,
stock_requests, request_events, request_notes, sales, users, email_settings, audit_logs

## Where Backups Are Stored

1. **Supabase Storage** — `db-backups` bucket (private, service_role only)
   - Download via Supabase Dashboard > Storage > db-backups
2. **Email** — Sent to recipients configured in `email_settings` table

## How to Restore from Auto-Backup

### Option A: Restore via Supabase Dashboard (easiest)

1. Download the backup file from Supabase Dashboard > Storage > db-backups
2. Gunzip: `gunzip prody-backup-YYYY-MM-DDTHH-MM-SS.json.gz`
3. You now have a JSON file with all table data
4. Use the Supabase Dashboard SQL Editor to restore:
   - First, run migrations from `supabase/migrations/` in order to recreate schema
   - Then use the restore script below

### Option B: Restore via Node.js script

```bash
cd /path/to/prody
node scripts/restore.mjs <backup-file.json>
```

### Option C: Restore via Supabase Dashboard (manual per table)

1. Gunzip the backup file
2. Open Supabase Dashboard > Table Editor
3. For each table, use "Import data via CSV" or "Insert row"
4. Paste data from the JSON file

## Restore from pg_dump (manual script backup)

If you used `scripts/backup.sh` which creates `.sql.gz`:

```bash
# 1. Get the target database URL
export DATABASE_URL='postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres'

# 2. Drop and recreate schema (if needed)
# Run migrations in order from supabase/migrations/

# 3. Restore data
gunzip -c backups/prody-backup-YYYY-MM-DDTHH-MM-SS.sql.gz | psql "$DATABASE_URL"
```

## Emergency Restore Steps

1. **Don't panic.** Backups exist in email and Supabase Storage.
2. **Stop writes.** If possible, prevent new data from being written (e.g. put app in maintenance mode).
3. **Download latest backup** from email or Supabase Storage.
4. **Create a fresh database** (optional: use a new Supabase project for testing).
5. **Restore** using one of the methods above.
6. **Verify:** Check product count, user count, sales count match.
7. **Reconnect** the app to the restored database if needed.

## How to Trigger Manual Backup

Visit this URL (replace SECRET with CRON_SECRET env value):
```
https://prody.vercel.app/api/cron/backup?secret=SECRET
```

Or trigger via Vercel dashboard:
1. Go to Vercel Dashboard > Prody > Settings > Cron Jobs
2. Find the backup cron job
3. Click "Run Now"

## Verification Checklist After Restore

- [ ] Products count matches: `SELECT count(*) FROM products`
- [ ] Users count matches: `SELECT count(*) FROM users`
- [ ] Sales count matches: `SELECT count(*) FROM sales`
- [ ] Stock batches match: `SELECT count(*) FROM stock_batches`
- [ ] Product images restored: `SELECT count(*) FROM product_images`
- [ ] App loads and catalog page shows products
- [ ] Login works with existing credentials
