# Email Notifications & Weekly Report — Design Spec

## Goal
Add Resend-based email sending to Prody. A new "Имейл" tab in Settings configures API key, sender, recipients, report day/time, and which report sections to include. A cron job triggers the weekly report email with both HTML summary body and attached Excel file.

## Architecture
- **Settings UI:** New tab "Имейл" with Resend API key, sender email, recipient list, day/time picker, and section checkboxes
- **Storage:** New `email_settings` table stores configuration as a singleton row
- **Email sending:** New `src/lib/email.ts` wraps Resend SDK — `sendWeeklyReport()` builds HTML body + attaches Excel via the existing export lib
- **Cron trigger:** Vercel Cron Job calls `GET /api/cron/weekly-report` once per week; checks day/time settings and sends if matching
- **Test button:** `POST /api/reports/send-email` for manual test send

## Tech Stack
- `resend` npm package (new)
- Vercel Cron Jobs (free tier: 1 cron per project)
- Existing `export-reports.ts` lib for Excel generation
- Existing `/api/reports` endpoint for report data
- New `email_settings` Supabase table

## Settings UI Design

```
┌─ Настройки: [Категории] [Магазини] [Мин. к-ва] [AI] [Имейл] ─┐
├─────────────────────────────────────────────────────────────────┤
│ Resend API ключ                                                 │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx                     │     │
│ └─────────────────────────────────────────────────────────┘     │
│                                                                 │
│ Имейл подател                                                   │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ prody@zonapharm.com                                     │     │
│ └─────────────────────────────────────────────────────────┘     │
│                                                                 │
│ Получатели:                                     [+ Добави]     │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ 📧 vladimir@example.com                         [✕]    │     │
│ │ 📧 schetovoditel@example.com                    [✕]    │     │
│ └─────────────────────────────────────────────────────────┘     │
│                                                                 │
│ Седмичен отчет                                                  │
│ ▸ Ден: [Петък ▼]    ▸ Час: [18 ▼] : [00 ▼]                    │
│                                                                 │
│ Съдържание:                                                     │
│ ☑ Общо — оборот, брой продажби, среден чек                     │
│ ☑ По обекти — оборот по магазини                               │
│ ☑ Топ продукти — най-продавани (брой)                          │
│ ☑ Топ приходи — най-продавани (оборот)                         │
│ ☑ Ниски наличности — продукти под минимума                     │
│                                                                 │
│ [📤 Изпрати тестов отчет сега]                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Database

```sql
CREATE TABLE email_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton
  resend_api_key text,
  sender_email text,
  recipients jsonb DEFAULT '[]',
  report_day int DEFAULT 5, -- 0=Sun, 5=Fri, 6=Sat
  report_hour int DEFAULT 18,
  report_minute int DEFAULT 0,
  report_sections jsonb DEFAULT '["summary","stores","top-products","top-revenue","low-stock"]',
  updated_at timestamptz DEFAULT now()
);
```

## Files

| File | Action | Purpose |
|------|--------|---------|
| `src/app/api/cron/weekly-report/route.ts` | Create | Cron handler, checks settings, sends email |
| `src/app/api/reports/send-email/route.ts` | Create | Manual test send endpoint |
| `src/app/api/email-settings/route.ts` | Create | GET/POST settings CRUD |
| `src/lib/email.ts` | Create | Resend client, HTML template builder, send function |
| `src/app/(admin)/settings/email-settings.tsx` | Create | Settings UI component |
| `src/app/(admin)/settings/page.tsx` | Modify | Add "Имейл" tab |
| `supabase/migrations/00011_email_settings.sql` | Create | DB migration |

## Scope
- Email notifications for weekly reports only (v1)
- No real-time triggers (low stock, new request) — future
- Vercel Cron runs the check, sends if day/hour matches
- Excel file attached to email
- Settings singleton row, managed via API + UI