# Prody Database Backup & Restore

## Overview

Daily backup at 3:00 AM UTC via Vercel cron → Supabase Storage `db-backups` bucket + email. Retention: 7 days.

## Backup Contents

Each backup (.json.gz) holds every row of these tables, listed here — and in
`TABLES` in `src/lib/backup.ts` — in foreign-key order, so a restore that inserts
them in this order never meets a missing parent:

categories, stores, users, products, product_images, labels, label_sheet_profiles,
suppliers, deliveries, delivery_items, delivery_item_plan, trips, shipments,
shipment_lines, delivery_signals, delivery_events,
stock_batches, sales, stock_movements, stock_requests, request_events,
request_notes, stock_corrections, email_settings, audit_logs

Not in the backup: `auth.users`, which `users`, `audit_logs`, `stock_requests`,
`request_events` and `request_notes` reference — the auth accounts must exist
before those tables are restored.

The deliveries tables (suppliers … delivery_events) come from
`20261110_deliveries_schema.sql`, and `label_sheet_profiles` from
`20261111_label_sheet_profiles.sql`. Until that migration is applied where the
backup runs, they are skipped and the email's details say `още няма: …`.

### Restoring the deliveries tables

- **Order matters more than before.** `stock_batches.delivery_item_id` references
  `delivery_items`, and `stock_movements.delivery_id` / `shipment_id` reference
  `deliveries` / `shipments`. Restore the deliveries tables before `stock_batches`
  and `stock_movements`, as listed above.
- **`delivery_events` is append-only.** A trigger rejects every UPDATE and DELETE
  on it, for every role. Restore it with plain `INSERT`s into an empty table. A
  restore that upserts (`INSERT … ON CONFLICT DO UPDATE`, or the Table Editor's
  upsert) or that clears the table with `DELETE` fails on it. To empty it before a
  restore, disable its triggers for the duration of the restore and enable them
  again afterwards (`alter table public.delivery_events disable trigger user;` …
  `enable trigger user;`). `TRUNCATE` is blocked by a statement trigger too.
- **`delivery_items.unlabelled_qty` is a generated column** (`received_qty − labelled_qty`).
  Leave it out of the restored rows: Postgres refuses a value for it. Restore
  `delivery_items` before `delivery_item_plan`, with the triggers of both tables disabled
  (`alter table … disable trigger user;` … `enable trigger user;`), so `labelled_qty`
  comes back exactly as backed up.
- `trips.number`, `shipments.number` and `deliveries.number` come from sequences.
  After a restore set each sequence past the highest number restored, e.g.
  `select setval('public.delivery_number_seq', coalesce((select max(number) from public.deliveries), 0) + 1, false);`
  (same for `shipment_number_seq` / `shipments` and `trip_number_seq` / `trips`).

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

> `scripts/restore.mjs` is not in the repository (checked 10.11.2026). Whoever
> writes it: insert table by table in the order of `TABLES`, with plain inserts
> (no upsert), and see "Restoring the deliveries tables" above.

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
