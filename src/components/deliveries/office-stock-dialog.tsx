'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PackagePlus, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { officeStockText, type OfficeStockRow } from '@/lib/deliveries/office'
import { formatShipmentNumber, formatTripNumber } from '@/lib/deliveries/format'
import { postJson } from './checklist-ui'
import { ProductThumb } from './product-picker'

export type StoreChoice = { id: string; name: string }

type Picked = { row: OfficeStockRow; qty: string }

type Result = {
  trip_id: string
  trip_number: number
  new_trip: boolean
  shipment_number: number
  reopened: boolean
  units: number
}

/**
 * "Добави от Офис": products Офис already holds go to a store with a trip, with or
 * without a delivery behind them. Used for the store's shipment in a trip (the last
 * call "one more box"), for a store not yet in the trip, and for a new trip with Office
 * stock only. The stock leaves Офис when the driver signs, like everything else in
 * the trip, and the store confirms it with the shipment.
 */
export function OfficeStockButton({ tripId = null, stores, store, packed = false, label = 'Добави от Офис', size = 'sm', variant = 'outline' }: {
  tripId?: string | null
  stores: StoreChoice[]
  /** The shipment's store: no store choice then. */
  store?: StoreChoice
  /** The store's shipment is packed: adding opens it for packing again. */
  packed?: boolean
  label?: string
  size?: 'sm' | 'default'
  variant?: 'outline' | 'ghost' | 'default'
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <PackagePlus className="mr-1 h-4 w-4" />{label}
      </Button>
      {open && <OfficeStockDialog tripId={tripId} stores={stores} store={store} packed={packed} onClose={() => setOpen(false)} />}
    </>
  )
}

function OfficeStockDialog({ tripId, stores, store, packed, onClose }: {
  tripId: string | null
  stores: StoreChoice[]
  store?: StoreChoice
  packed: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [storeId, setStoreId] = useState(store?.id ?? '')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<OfficeStockRow[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<Picked[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Result | null>(null)
  const seq = useRef(0)

  // Search a moment after typing stops; an older answer never overwrites a newer one.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) return
    const my = ++seq.current
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/deliveries/office-stock?q=${encodeURIComponent(term)}`)
        const data = await res.json().catch(() => [])
        if (my === seq.current) setFound(Array.isArray(data) ? data : [])
      } finally {
        if (my === seq.current) setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const storeName = store?.name ?? stores.find(s => s.id === storeId)?.name ?? ''
  const lines = picked.map(p => ({ product_id: p.row.id, qty: Number(p.qty) }))
  const bad = picked.find(p => !Number.isInteger(Number(p.qty)) || Number(p.qty) < 1 || Number(p.qty) > p.row.free)
  const units = lines.reduce((n, l) => n + (Number.isFinite(l.qty) ? l.qty : 0), 0)
  const disabledReason = !storeId ? 'Изберете магазин'
    : picked.length === 0 ? 'Добавете поне един продукт'
    : bad ? `„${bad.row.name}“: от 1 до ${bad.row.free} бр.`
    : ''

  function add(r: OfficeStockRow) {
    setPicked(prev => prev.some(p => p.row.id === r.id) ? prev : [...prev, { row: r, qty: '1' }])
    setQ('')
    setFound([])
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      const data = await postJson<Result>('/api/deliveries/trips/office', { trip_id: tripId, store_id: storeId, lines }, 'Нищо не беше добавено')
      setDone(data)
      setBusy(false)
      if (data.new_trip) router.push(`/deliveries/trips/${data.trip_id}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нищо не беше добавено')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{store ? `Добави от Офис за ${store.name}` : tripId ? 'Добави от Офис' : 'Курс със стока от Офис'}</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 text-sm">
            <p>
              Добавени {done.units} бр. в пратка {formatShipmentNumber(done.shipment_number)} за {storeName}
              {done.new_trip ? `, нов курс ${formatTripNumber(done.trip_number)}` : ''}.
            </p>
            <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
              {done.reopened
                ? 'Пратката беше опакована, затова е отворена отново: сложете новото в кашона, после „Опаковай“ и подпишете пак.'
                : 'Сложете го в кашона и при „Опаковай“ го отметнете като останалото.'}
            </p>
            <div className="flex justify-end"><Button onClick={onClose}>Готово</Button></div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Стока, която вече е в Офис, без доставка. Тръгва с курса и излиза от Офис, когато шофьорът подпише. Магазинът я приема с пратката.
            </p>
            {packed && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Пратката вече е опакована. След добавянето тя се отваря отново и трябва да се опакова и подпише пак.
              </p>
            )}

            {!store && (
              <label className="block space-y-1 text-sm">
                <span>Магазин</span>
                <select className="h-10 w-full rounded-md border border-input bg-white px-2 text-sm" value={storeId} onChange={e => setStoreId(e.target.value)} aria-label="Магазин">
                  <option value="">Изберете…</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}

            <div className="space-y-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Продукт: име, код или баркод"
                  value={q}
                  onChange={e => {
                    setQ(e.target.value)
                    if (e.target.value.trim().length < 2) { seq.current++; setFound([]); setSearching(false) }
                  }}
                  aria-label="Търси продукт"
                  autoFocus
                />
                {searching && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
              </div>
              {found.length > 0 && (
                <ul className="max-h-60 overflow-y-auto rounded-md border divide-y" data-testid="office-found">
                  {found.map(r => {
                    const already = picked.some(p => p.row.id === r.id)
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          disabled={r.free === 0 || already}
                          onClick={() => add(r)}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ProductThumb src={r.image} size={32} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{r.name}</span>
                            <span className="block text-xs text-muted-foreground">{r.sku ? `${r.sku} · ` : ''}{officeStockText(r)}</span>
                          </span>
                          {already ? <span className="text-xs text-muted-foreground">добавен</span> : <Plus className="h-4 w-4 shrink-0" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {q.trim().length >= 2 && !searching && found.length === 0 && (
                <p className="text-xs text-muted-foreground">Няма такъв продукт.</p>
              )}
            </div>

            {picked.length > 0 && (
              <ul className="rounded-md border divide-y" data-testid="office-picked">
                {picked.map(p => (
                  <li key={p.row.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.row.name}</span>
                      <span className="block text-xs text-muted-foreground">свободни в Офис {p.row.free}</span>
                    </span>
                    <Input
                      className="w-20 text-right"
                      inputMode="numeric"
                      value={p.qty}
                      onChange={e => {
                        const v = e.target.value.replace(/[^0-9]/g, '')
                        setPicked(prev => prev.map(x => x.row.id === p.row.id ? { ...x, qty: v } : x))
                      }}
                      aria-label={`Бройки: ${p.row.name}`}
                    />
                    <span className="text-muted-foreground">бр.</span>
                    <Button size="icon" variant="ghost" aria-label={`Махни ${p.row.name}`} onClick={() => setPicked(prev => prev.filter(x => x.row.id !== p.row.id))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {disabledReason && <span className="mr-auto text-xs text-muted-foreground">{disabledReason}</span>}
              <Button variant="ghost" onClick={onClose}>Назад</Button>
              <Button onClick={save} disabled={!!disabledReason || busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-2 h-4 w-4" />}
                {tripId ? `Добави ${units} бр.` : `Направи курс с ${units} бр.`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
