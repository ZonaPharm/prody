# Prody — Inventory Management & Sales Platform

Фармацевтичен inventory management и sales tracking за верига аптеки.

## Tech Stack

- **Framework:** Next.js 16.2.4 (App Router) + React 19.2
- **База данни:** Supabase Cloud (PostgreSQL) — `ocvmqlbfkloskabicxuw.supabase.co`
- **ORM:** Drizzle ORM (схема в `drizzle/`, queries в `src/lib/db/`)
- **Auth:** NextAuth.js чрез Supabase — `src/auth.ts`
- **UI:** Tailwind CSS 3.4 + Radix UI + shadcn/ui компоненти
- **Charts:** Recharts
- **Forms:** react-hook-form + zod валидация
- **Export:** exceljs, xlsx
- **Email:** nodemailer (Brevo SMTP)
- **Деплой:** Docker → Coolify → `https://prody.blv.bg:3000`

## Структура

```
src/
  app/
    (admin)/     # Админ панел (catalog, reports, stores, requests)
    (seller)/    # Продавач (record-sale, my-requests, my-sales)
    api/         # REST API endpoints
      products/   # Продуктов каталог, търсене, load-more
      sales/      # Продажби и grouped reports
      reports/    # Low-stock, inventory reports
      stores/     # Управление на аптеки
      inventory/  # Наличности и складове
      email-settings/
      cron/       # Scheduled tasks (dev mode)
      backups/    # DB backup management
    auth/        # NextAuth handlers
    login/       # Login страница
  lib/
    db/          # Drizzle query функции (products.ts, stores.ts, categories.ts)
  components/    # UI компоненти (products/, layout/)
  hooks/         # Custom React hooks
  proxy.ts       # API route прокси
docs/            # Документация (деплой, бекъп, request workflow)
```

## Основни функционалности

- **Управление на продукти:** Каталог с търсене/филтриране, продуктови изображения от Supabase Storage
- **Продажби:** Запис на продажби, история, grouped by product/date
- **Складове и инвентар:** Multi-store stock tracking, stock_batches таблица
- **Request Workflow:** Система за заявки между аптеки (stock_requests → accepted → delivered)
- **Low Stock Alerts:** Per-store breakdown на артикули под минимум
- **Email нотификации:** Brevo SMTP за системни известия
- **Backup:** Автоматичен nightly backup към Supabase Storage `db-backups` bucket (3:00 AM UTC)
- **Excel Export:** Експорт на продажби и репорти

## Технически детайли

- **Docker build:** Multi-stage — deps → build → runtime (node:22-alpine, user: nextjs)
- **Build args:** NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY се подават от Coolify
- **Git remotes:** `github` → ZonaPharm/prody, `origin` → gitlab.bronic.com/vladimir/prody
- **Локална разработка:** `npm run dev` на порт 3000, ползва същия Supabase cloud
- **prody-local:** Отделен локален вариант с Docker PostgreSQL (не Supabase) — `~/Documents/Apps/prody-local`

## Документация

- `docs/deployment-self-hosted.md` — Хибриден деплой план (Supabase managed + Next.js на VPS)
- `docs/BACKUP-RESTORE.md` — Backup & restore процедури
- `docs/request-workflow-plan.md` — Спецификация на системата за заявки
- `docs/audit-2026-05-20.md` — Код одит от 20 май 2026
