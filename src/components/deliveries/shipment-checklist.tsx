'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import {
  buildConfirmBody,
  buildPackBody,
  checklistSummary,
  type RowState,
} from '@/lib/deliveries/checklist'
import { formatDeliveryNumber, formatMoney, formatShipmentNumber } from '@/lib/deliveries/format'
import type { ShipmentLineView } from '@/lib/deliveries/work'
import { cn } from '@/lib/utils'
import { ProductThumb } from './product-picker'
import { ProblemButton, ProblemDialog, ProblemText, RowTick, SignBar, postJson, rowTone } from './checklist-ui'

/**
 * One shipment, line by line. Two uses:
 *   mode 'pack'  — in Офис, before the trip leaves: ticked = in the boxes;
 *                  the box count is typed once; the signature packs the shipment.
 *   mode 'store' — in the store, when the boxes arrive: ticked = received;
 *                  short lines become signals and leave the store's stock.
 * Every line must be ticked or marked before signing.
 */
export function ShipmentChecklist({ mode, shipmentId, number, storeName, lines, userName, doneHref }: {
  mode: 'pack' | 'store'
  shipmentId: string
  number: number
  storeName: string
  lines: ShipmentLineView[]
  userName: string
  doneHref: string
}) {
  const router = useRouter()
  const [state, setState] = useState<Record<string, RowState>>({})
  const [boxes, setBoxes] = useState('')
  const [problemFor, setProblemFor] = useState<ShipmentLineView | null>(null)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')

  const rows = lines.map(l => ({ line_id: l.id, qty: l.qty }))
  const pack = buildPackBody(rows, state)
  const confirm = buildConfirmBody(rows, state)
  const missing = mode === 'pack' ? pack.missing : confirm.missing
  const problems = lines.filter(l => state[l.id]?.problem).length
  const units = mode === 'pack'
    ? pack.body.lines.reduce((s, l) => s + l.qty, 0)
    : confirm.lines.reduce((s, l) => s + l.received_qty, 0)
  const done = lines.length - missing
  const boxCount = boxes.trim() === '' ? 0 : Number(boxes)
  const needBoxes = mode === 'pack' && !(Number.isInteger(boxCount) && boxCount >= 1)

  function setRow(id: string, patch: Partial<RowState>) {
    setState(prev => {
      const cur = prev[id] ?? { checked: false, problem: null }
      return { ...prev, [id]: { ...cur, ...patch } }
    })
  }

  async function sign() {
    setSigning(true)
    setError('')
    try {
      if (mode === 'pack') {
        await postJson(`/api/deliveries/shipments/${shipmentId}/pack`, { ...pack.body, box_count: boxCount }, 'Опаковането не мина')
      } else {
        await postJson(`/api/shipments/${shipmentId}/confirm`, { lines: confirm.lines }, 'Потвърждението не мина')
      }
      router.push(doneHref)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
      setSigning(false)
    }
  }

  const disabledReason = missing > 0
    ? `Остават ${missing} ${missing === 1 ? 'неотметнат ред' : 'неотметнати реда'}`
    : needBoxes ? 'Напишете броя кашони' : undefined

  return (
    <div className="space-y-4 pb-28">
      <ul className="rounded-lg border bg-white divide-y">
        {lines.map(l => {
          const s = state[l.id]
          return (
            <li key={l.id} className={cn('flex flex-wrap items-center gap-3 px-3 py-3', rowTone(s))} data-testid="shipment-row">
              <RowTick state={s} label={`${mode === 'pack' ? 'В кашона' : 'Получено'}: ${l.product_name}`} onChange={on => setRow(l.id, { checked: on })} />
              <ProductThumb src={l.image} size={40} />
              <div className="flex-1 min-w-[180px]">
                <div className="font-medium leading-tight">{l.product_name}</div>
                <div className="text-xs text-muted-foreground">
                  {l.product_sku ? `${l.product_sku} · ` : ''}цена {formatMoney(l.product_price)}
                  {mode === 'pack' && l.delivery_number != null ? ` · ${formatDeliveryNumber(l.delivery_number)}` : ''}
                </div>
                <div className="text-sm"><span className="font-semibold">{l.qty} бр.</span></div>
                {s?.problem && <ProblemText step={mode} problem={s.problem} />}
              </div>
              <ProblemButton state={s} onOpen={() => setProblemFor(l)} onClear={() => setRow(l.id, { problem: null })} />
            </li>
          )
        })}
      </ul>

      <SignBar
        userName={userName}
        summary={done ? checklistSummary(done, units, problems) : 'Нищо не е отметнато'}
        statement={mode === 'pack'
          ? `Тези бройки са в кашоните за ${storeName} (пратка ${formatShipmentNumber(number)}).`
          : `Получих това в ${storeName} (пратка ${formatShipmentNumber(number)}).`}
        disabled={missing > 0 || needBoxes || signing}
        disabledReason={disabledReason}
        error={error}
        signing={signing}
        onSign={sign}
      >
        {mode === 'pack' && (
          <label className="flex items-center gap-2 text-sm">
            Кашони
            <Input className="w-20" inputMode="numeric" value={boxes} onChange={e => setBoxes(e.target.value.replace(/[^0-9]/g, ''))} aria-label="Брой кашони" />
          </label>
        )}
      </SignBar>

      {problemFor && (
        <ProblemDialog
          step={mode}
          title={problemFor.product_name}
          expected={problemFor.qty}
          hint={`В пратката са ${problemFor.qty} бр.`}
          onClose={() => setProblemFor(null)}
          onSave={p => { setRow(problemFor.id, { problem: p, checked: false }); setProblemFor(null) }}
        />
      )}
      {lines.length === 0 && (
        <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">Пратката няма редове.</p>
      )}
      {mode === 'store' && (
        <p className="text-xs text-muted-foreground">
          Стоката вече е в наличността на обекта и се продава. С отметките потвърждавате, че е пристигнала. Ако нещо липсва, натиснете „Не е наред“: липсващите бройки излизат от наличността, докато админ не реши.
        </p>
      )}
    </div>
  )
}
