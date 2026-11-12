import type { ShipmentStatus, TripStatus } from './work'

/**
 * "Кое след какво е": the steps a delivery and a trip go through, which one is
 * done, which one is now, and the one button that takes the user to the next
 * thing to do. Pure, so the screens only draw it.
 */

export type StepState = 'done' | 'current' | 'todo'

export type JourneyStep = {
  key: string
  label: string
  /** A short line under the label: "70 от 70 бр.", "чакат 12 бр." */
  detail: string
  state: StepState
  /** Where this step is done, when there is something to do there now. */
  href?: string
}

export type NextAction = { label: string; href: string } | null

export type Journey = { steps: JourneyStep[]; next: NextAction; finished: boolean }

type JourneyItem = {
  quantity: number
  received_qty: number
  labelled_qty: number
  needs_label?: boolean
  plan: { planned_qty: number; ready_qty: number; shipped_qty: number }[]
}

function state(done: boolean, active: boolean): StepState {
  if (done) return 'done'
  return active ? 'current' : 'todo'
}

/**
 * A saved delivery: received in Офис → labelled → sent to the stores.
 * Lines whose product needs no label count as labelled once received.
 */
export function deliveryJourney(
  delivery: { id: string; status: string; items: JourneyItem[] },
): Journey {
  const open = delivery.status === 'expected' || delivery.status === 'in_progress'
  const units = delivery.items.reduce((s, i) => s + i.quantity, 0)
  const received = delivery.items.reduce((s, i) => s + i.received_qty, 0)
  const labelNeeded = delivery.items.reduce((s, i) => s + (i.needs_label === false ? 0 : i.received_qty), 0)
  const labelled = delivery.items.reduce((s, i) => s + (i.needs_label === false ? 0 : Math.min(i.labelled_qty, i.received_qty)), 0)
  const toLabel = labelNeeded - labelled
  const planned = delivery.items.reduce((s, i) => s + i.plan.reduce((n, p) => n + p.planned_qty, 0), 0)
  const shipped = delivery.items.reduce((s, i) => s + i.plan.reduce((n, p) => n + p.shipped_qty, 0), 0)
  const toShip = delivery.items.reduce((s, i) => s + i.plan.reduce((n, p) => n + Math.max(0, p.ready_qty - p.shipped_qty), 0), 0)

  const receivedDone = units > 0 && received >= units
  const labelDone = receivedDone && toLabel <= 0
  const shipDone = labelDone && shipped >= planned

  const receiveHref = open && !receivedDone ? `/deliveries/${delivery.id}/receive` : undefined
  const labelHref = toLabel > 0 ? `/deliveries/labels?delivery=${delivery.id}` : undefined
  const shipHref = toShip > 0 ? '/deliveries/trips' : undefined

  const steps: JourneyStep[] = [
    { key: 'entered', label: 'Въведена', detail: `${units} бр.`, state: 'done' },
    {
      key: 'received',
      label: 'Получена в Офис',
      detail: `${received} от ${units} бр.`,
      state: state(receivedDone, !receivedDone),
      href: receiveHref,
    },
    {
      key: 'labelled',
      label: 'С етикет',
      detail: labelNeeded === 0 ? (receivedDone ? 'не трябва' : '—') : toLabel > 0 ? `чакат ${toLabel} бр.` : `${labelled} бр.`,
      state: state(labelDone, toLabel > 0),
      href: labelHref,
    },
    {
      key: 'shipped',
      label: 'Към магазините',
      detail: planned === 0 ? 'всичко остава в Офис' : `${shipped} от ${planned} бр.${toShip > 0 ? `, готови ${toShip}` : ''}`,
      state: state(shipDone, toShip > 0),
      href: shipHref,
    },
  ]

  let next: NextAction = null
  if (delivery.status !== 'cancelled' && delivery.status !== 'draft') {
    if (receiveHref) next = { label: received > 0 ? `Получи останалите ${units - received} бр.` : 'Получи стоката', href: receiveHref }
    else if (labelHref) next = { label: `Етикетирай ${toLabel} бр.`, href: labelHref }
    else if (shipHref) next = { label: `Направи курс за ${toShip} бр.`, href: shipHref }
  }
  // One obvious action at a time: receiving first, then labels, then the trip.
  // The trail above still links every step that has work, for parallel work.
  return { steps, next, finished: shipDone }
}

/** A trip: pack every shipment → the driver signs and leaves → the stores accept. */
export function tripJourney(trip: { status: TripStatus; shipments: { id: string; status: ShipmentStatus }[] }): Journey {
  const live = trip.shipments.filter(s => s.status !== 'cancelled')
  const packed = live.filter(s => s.status !== 'packing').length
  const accepted = live.filter(s => s.status === 'received' || s.status === 'received_with_issues').length
  const departed = trip.status === 'departed' || trip.status === 'completed'
  const firstToPack = live.find(s => s.status === 'packing')

  const steps: JourneyStep[] = [
    {
      key: 'packed',
      label: 'Опаковане',
      detail: `${packed} от ${live.length} пратки`,
      state: state(live.length > 0 && packed === live.length, trip.status === 'open'),
      href: firstToPack && trip.status === 'open' ? `/deliveries/shipments/${firstToPack.id}/pack` : undefined,
    },
    {
      key: 'departed',
      label: 'Шофьорът тръгва',
      detail: departed ? 'тръгнал' : 'подпис на шофьора',
      state: state(departed, trip.status === 'open' && live.length > 0 && packed === live.length),
    },
    {
      key: 'accepted',
      label: 'Приета в магазините',
      detail: `${accepted} от ${live.length} пратки`,
      state: state(live.length > 0 && accepted === live.length, departed),
    },
  ]

  let next: NextAction = null
  if (trip.status === 'open' && firstToPack) {
    const left = live.length - packed
    next = { label: left > 1 ? `Опаковай пратките (остават ${left})` : 'Опаковай пратката', href: `/deliveries/shipments/${firstToPack.id}/pack` }
  }
  return { steps, next, finished: trip.status === 'completed' }
}
