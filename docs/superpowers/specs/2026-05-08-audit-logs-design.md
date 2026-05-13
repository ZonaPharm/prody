# Audit Logs — Design Spec

## Goal
Add audit logging: track all important actions (CRUD, transfers, sales, errors) and login attempts in separate views within a new "Логове" tab in Settings.

## Architecture
- **DB:** Single `audit_logs` table with type field distinguishing `action` vs `auth`
- **Lib:** `src/lib/audit.ts` — `logAction()` and `logAuth()` helper functions
- **API:** `GET /api/audit-logs?type=&action=&user_id=&from=&to=` for querying
- **UI:** Two sub-tabs: "📋 Действия" (actions) and "🔑 Вход/Изход" (auth)
- **Integration:** Existing API routes call `logAction()` / `logAuth()` at key points

## DB

```sql
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('action', 'auth')),
  action text NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  user_name text,
  entity_type text,
  entity_id uuid,
  details text,
  metadata jsonb,
  status text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_audit_type_created ON audit_logs(type, created_at DESC);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
```

## Logged Events

### Actions (type='action')
| action | entity_type | When |
|--------|-------------|------|
| create_product | product | Product created |
| update_product | product | Product edited |
| delete_product | product | Product deleted |
| restock | stock_batch | Stock added |
| transfer | stock_movement | Stock transferred |
| sale | sale | Sale recorded |
| request_create | stock_request | Request submitted |
| request_fulfill | stock_request | Request fulfilled |
| request_confirm | stock_request | Receipt confirmed |
| user_create | user | User created |
| user_update | user | User edited |
| user_deactivate | user | User deactivated |
| settings_update | email_settings | Settings changed |
| error | — | Any API error |

### Auth (type='auth')
| action | status | When |
|--------|--------|------|
| login | success | Successful password login |
| login | failed | Wrong email/password |
| magiclink | sent | Magic link email sent |
| logout | success | User logged out |

## Files

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/00014_audit_logs.sql` | Create | Migration |
| `src/lib/audit.ts` | Create | logAction(), logAuth() helpers |
| `src/app/api/audit-logs/route.ts` | Create | GET with filters |
| `src/app/(admin)/settings/audit-logs.tsx` | Create | UI with two sub-tabs |
| `src/app/(admin)/settings/page.tsx` | Modify | Add "Логове" tab |
| Various API routes | Modify | Add logAction() calls at key points |

## Scope
- Migration + lib + API + UI for viewing logs
- Integrate into key API routes (products, inventory, auth, users)
- Two sub-tab views with filters
