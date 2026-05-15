# Система за заявки (Request Workflow) — Prody

**Последно обновяване:** 2026-05-15

## Общ преглед

Продавачи заявяват продукти към админ/склад. Админът преглежда, прехвърля склад, изпраща. Продавачът потвърждава получаване. Двупосочни коментари.

---

## Статуси

```
pending → accepted → in_transit → delivered → confirmed ✅
pending → rejected ❌
```

| Статус | Кой | Значение |
|---|---|---|
| `pending` | Продавач/Админ | Чака преглед |
| `accepted` | Админ | Приета, подготвя се |
| `in_transit` | Админ | Склад прехвърлен, на път |
| `delivered` | Админ | Пристигнала в магазина |
| `confirmed` | Продавач | Проверена и потвърдена |
| `rejected` | Всеки | Отказана |

## Таблици

### `stock_requests`
Основни полета: `id`, `product_id`, `store_id`, `requested_by`, `requested_qty`, `status`, `notes`
Допълнителни: `accepted_at`, `in_transit_at`, `delivered_at`, `fulfilled_at`, `fulfilled_by`, `received_qty`

### `request_notes` (нова)
Коментари между админ и продавач: `id`, `request_id`, `user_id`, `body`, `created_at`

### `request_events` (нова)
Автоматичен лог на статус промени: `id`, `request_id`, `status`, `user_id`, `notes`, `meta`, `created_at`

## API Endpoints

| Endpoint | Метод | Роля | Действие |
|---|---|---|---|
| `/api/inventory/request-batch` | POST | Продавач/Админ | Групова заявка |
| `/api/inventory/request` | POST | Продавач | Единична заявка |
| `/api/inventory/requests` | GET | Админ | Списък (филтър `?status=`) |
| `/api/inventory/requests/count` | GET | Админ | Брой чакащи (badge) |
| `/api/inventory/requests/[id]/accept` | POST | Админ | pending → accepted |
| `/api/inventory/requests/[id]/ship` | POST | Админ | accepted → in_transit |
| `/api/inventory/requests/[id]/deliver` | POST | Админ | in_transit → delivered |
| `/api/inventory/requests/[id]/fulfill` | POST | Админ | (legacy) директен fulfill |
| `/api/inventory/requests/[id]/reject` | POST | Админ/Продавач | → rejected |
| `/api/inventory/requests/[id]/confirm` | POST | Продавач | delivered → confirmed/partial |
| `/api/inventory/requests/[id]/notes` | GET/POST | Двамата | Коментари |
| `/api/inventory/requests/[id]/events` | GET | Двамата | История на статусите |
| `/api/inventory/requests/[id]/stock` | GET | Админ | Наличности за трансфер |

## UI

### Админ — `/requests`
- **Split panel:** ляво = списък с batch-ове, дясно = детайли + коментари
- **3 таба:** Чакащи / В процес / Приключени
- **Бързи бутони:** Приеми, Откажи, Прехвърли и изпрати, Маркирай като доставена
- **Нова заявка** — бутон за админ с избор на магазин и търсене на продукти

### Продавач — `/my-requests`
- **3 таба:** Заяви (търсене + кошница) / Моите заявки (статус + потвърждение) / Ниски наличности

---

## Часова зона

Всички времена и дати се показват в **Europe/Sofia** (UTC+2/+3).
- `sofiaToday()`, `sofiaTime()`, `sofiaDate()`, `sofiaDateTime()` в `src/lib/date-utils.ts`
- `sale_date` се записва в Sofia часова зона

## Други ключови промени (May 2026)

- **Voided филтър:** Всички тотали, KPI-та и експорти изключват сторнирани продажби
- **Групови маркери:** Продажбите в група са визуално оцветени
- **Пагинация:** Admin sales и My sales по 50 реда на страница
- **Автоматични филтри:** Без бутон "Филтрирай" — сменят се автоматично
- **Мобилно:** Фиксирана лента с safe-area, единичен скрол
- **Desktop POS:** Без двоен scrollbar, количката е sticky
