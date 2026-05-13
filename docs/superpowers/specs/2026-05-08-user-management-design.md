# User Management — Design Spec

## Goal
Add user management: list, create, edit, deactivate users with role/store assignment. Admin creates users with temporary passwords; system emails login details via SMTP. New "Потребители" tab in Settings.

## Architecture
- **DB:** existing `users` table (has: id, display_name, role, store_id, is_active)
- **Auth:** Supabase Admin API (`createUser`, `updateUserById`, `generateLink`)
- **Email:** existing `email.ts` lib for sending welcome emails with login details
- **UI:** new `users-manager.tsx` component as a tab in Settings
- **API:** `POST /api/users` (create), `PUT /api/users/[id]` (update), `POST /api/users/[id]/send-invite` (resend)

## Settings UI Design

### Users Tab

Table with columns: Име, Имейл, Роля, Магазин, Статус, Действия

Actions per row:
- ✎ Edit (opens dialog)
- 🔗 Resend invite (if user hasn't logged in yet)
- ✕ Deactivate (soft-delete, sets is_active=false)

### Add/Edit User Dialog

Fields:
- Име (display_name)
- Имейл (email)
- Роля (select: Админ / Продавач)
- Магазин (select: only shown for seller role)
- Парола (auto-generated random 12-char, editable)
- Checkbox: "📧 Изпрати данни за вход на имейла"

On save:
1. Admin API creates/updates user in Supabase Auth
2. Profile saved to `users` table
3. If checkbox checked: send email with login URL + email + password via SMTP

### Password Change

Users need a page to change their temporary password. Two options:
- Supabase's built-in password reset flow (simplest)
- Custom "Смени парола" page in the app (more control)

Default: Supabase built-in reset. Admin can trigger password reset email from the users table.

### Status tracking

- 🔵 Активен — user has logged in at least once
- 🟡 Поканен — user created but never logged in (no `last_sign_in_at`)
- 🔴 Деактивиран — `is_active = false`

## Files

| File | Action | Purpose |
|------|--------|---------|
| `src/app/(admin)/settings/users-manager.tsx` | Create | Users table + add/edit dialog |
| `src/app/api/users/route.ts` | Create | List (GET) + create (POST) |
| `src/app/api/users/[id]/route.ts` | Create | Update (PUT) + deactivate (DELETE) |
| `src/app/api/users/[id]/send-invite/route.ts` | Create | Resend welcome email |
| `src/app/(admin)/settings/page.tsx` | Modify | Add "Потребители" tab |
| `src/lib/email.ts` | Modify | Add `sendWelcomeEmail()` function |

## Tech Stack
- Supabase Admin API (createUser, updateUserById)
- Existing SMTP + nodemailer
- shadcn/ui Dialog, Select, Input, Button, Table
- No new npm packages needed

## Scope
- User CRUD in Settings
- Assign role + store
- Auto-generated temp password
- Welcome email with login details
- Resend invite
- Deactivate (not delete)
