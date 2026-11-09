# Prody — Inventory Management & Sales Platform

Наличности и продажби за верига аптеки (Зона Фарма): каталог, продажби (POS), партиди по обекти,
заявки между обектите, отчети, качване на продукти в WooCommerce магазина.

**Това е production система.** Продавачите записват продажби в нея всеки ден.

## Tech Stack

- **Framework:** Next.js 16.2.4 (App Router, Turbopack) + React 19.2
- **База данни и вход:** Supabase (Postgres + Auth + Storage) през `@supabase/ssr` и `@supabase/supabase-js`.
  Няма ORM — заявките са директно през Supabase клиента. `src/types/supabase.ts` е остарял, затова
  кодът навсякъде ползва `as any`.
- **Auth:** Supabase Auth с имейл и парола. Ролите (`admin` / `seller`) са в `public.users`.
  Проверките са в `src/lib/auth.ts` (`requireAuth`, `requireAdmin`); админ може да гледа като продавач
  чрез cookie `prody_view_as`.
- **UI:** Tailwind CSS 3.4 + Radix UI + shadcn/ui; графики с Recharts; форми с react-hook-form + zod
- **Export:** exceljs, xlsx (+ sharp за снимки в експорта на наличностите)
- **Email:** nodemailer през Brevo SMTP (настройките са в таблица `email_settings`)
- **Магазин:** WooCommerce REST + WordPress media (`src/lib/woocommerce.ts`, `src/lib/wordpress-media.ts`)

## Среди

| | Supabase | Деплой |
|---|---|---|
| **Production** | `ocvmqlbfkloskabicxuw` | Vercel (екип BLV Systems, Hobby), автоматично от `main` |
| **Staging** | `ruhhsixmqusnpiajkbxe` | Vercel preview за всеки друг клон; също локалният `.env.local` |

- Разработката и тестовете вървят **срещу staging**. Продът не се пипа, докато промяната не е минала там.
- Preview деплоите са зад Vercel логин. Staging е копие на прода, със зачистени SMTP парола и получатели,
  за да не стигат имейли от него до реални хора. Синхронизира се база към база в Supabase.
- `NEXT_PUBLIC_SITE_URL` е общ за preview и production: „Изход“ от preview праща към входа на прода.
- Cron на Vercel: `/api/cron/backup` в 03:00 UTC — бекъп към Storage `db-backups` плюс нощна проверка
  за цялост на данните (`src/lib/integrity-*.ts`). Удостоверява се с `Authorization: Bearer CRON_SECRET`.
  `/api/cron/*` е публичен в `src/proxy.ts`, затова всеки cron route трябва сам да проверява тайната.

## Git и деплой

- GitHub: `ZonaPharm/prody`. Vercel деплойва само от него.
- Във Vercel е включено **Require Verified Commits**: неподписан комит в `main` не се деплойва изобщо —
  без грешка и без запис в Deployments.
- PR-ите се сливат със **Squash** или **Create a merge commit**, никога с **Rebase and merge**:
  при rebase GitHub пресъздава комитите без подпис.

## Команди

```bash
npm run dev        # next dev; .env.local трябва да сочи към staging
npm run build
npm test           # Vitest — src/**/*.test.ts, чиста логика, без база
npm run test:e2e   # Playwright срещу next dev; отказва да тръгне, ако адресът сочи към прода
```

Тестовете за базата са в `supabase/tests/*.test.sql`. Пускат се срещу staging, а данните, които
създават, се отменят.

## База данни — какво трябва да се знае

- **Наличността е в `stock_batches`**, по партида и обект. Изваждането е FIFO по `(created_at, id)`.
  `products.quantity_on_hand` е производен брояч и трябва винаги да е равен на сбора от партидите.
- **Продажба:** `POST /api/sales/group` → `executeSaleFIFO` → RPC `sell_from_batches`. Една транзакция
  намалява партидите, записва движенията `sell` и намалява брояча. Не изваждай стока от JS с четене →
  смятане → запис: така се губят изваждания при едновременни продажби.
- **PostgREST връща най-много 1000 реда.** За повече ползвай `fetchAll`; за дълги списъци с ID-та
  ползвай `fetchByIds` (`src/lib/fetch-all.ts`). Филтърът по обект в каталога слага ID-тата в URL-а и
  спира да работи около 398 продукта — нощната проверка следи за това.
- **Нови функции в `public`:** Supabase дава EXECUTE на `anon` и `authenticated` директно, така че
  `REVOKE ... FROM PUBLIC` не стига. Винаги
  `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` и после
  `GRANT EXECUTE ... TO service_role;`.
- **Миграции:** `supabase/migrations/`, новите са с имена `YYYYMMDD_name.sql`. Пускат се първо в
  staging, после в production. Историята на миграциите в прода съдържа и стари записи, които ги няма в
  репото.

## Структура

```
src/
  app/
    (admin)/      # табло, каталог, продажби, отчети, инвентаризация, заявки, настройки
    (seller)/     # запис на продажба (POS), моите продажби, заявки, ниски наличности
    api/          # route handlers: sales, inventory, products, reports, cron, backups, users, woocommerce…
    login/, auth/ # вход и изход
  components/     # pos/, products/, inventory/, sales/, ui/ (shadcn)
  lib/            # auth, inventory, integrity-*, fetch-all, backup, email, woocommerce, supabase/ клиенти
  proxy.ts        # пуска само заявки с Supabase cookie, освен публичните пътища
supabase/
  migrations/     # схема и права
  tests/          # SQL тестове за staging
e2e/              # Playwright
docs/             # планове, спецификации, бекъп
```

## Документация

- `docs/ideas-backlog.md` — какво следва
- `docs/superpowers/specs`, `docs/superpowers/plans` — дизайн и планове на досегашните функции
- `docs/BACKUP-RESTORE.md` — бекъп и възстановяване
- `docs/wp-rollback-plan.md`, `docs/production-wp-migration.sql` — интеграцията с WooCommerce
- `docs/request-workflow-plan.md` — системата за заявки
- `docs/audit-2026-05-20.md` — одит от май 2026 (част от находките вече са поправени)
