import { describe, expect, it } from 'vitest'
import {
  daysBetween,
  isLate,
  listText,
  shipmentComingText,
  shipmentIssueText,
  shipmentSentText,
  shortTime,
  tripAssignedText,
  tripCancelledText,
  whenText,
} from './notify-text'

const TODAY = '2026-11-12' // a Thursday

describe('when a trip leaves, in words', () => {
  it('counts calendar days across months and years', () => {
    expect(daysBetween(TODAY, '2026-11-13')).toBe(1)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween(TODAY, '2026-11-10')).toBe(-2)
  })

  it('says today, tomorrow, yesterday, a weekday within a week, a full date beyond', () => {
    expect(whenText('2026-11-12', null, TODAY)).toBe('днес')
    expect(whenText('2026-11-13', '09:30', TODAY)).toBe('утре, 9:30')
    expect(whenText('2026-11-11', null, TODAY)).toBe('вчера')
    expect(whenText('2026-11-16', '14:00:00', TODAY)).toBe('понеделник 16.11, 14:00')
    expect(whenText('2026-11-25', null, TODAY)).toBe('сряда 25.11.2026')
    expect(whenText(null, '09:00', TODAY)).toBe('без ден')
  })

  it('a past day is late; no day is never late', () => {
    expect(isLate('2026-11-11', TODAY)).toBe(true)
    expect(isLate('2026-11-12', TODAY)).toBe(false)
    expect(isLate(null, TODAY)).toBe(false)
  })

  it('short hour and lists of stores', () => {
    expect(shortTime('08:05:00')).toBe('8:05')
    expect(shortTime(null)).toBe('')
    expect(listText(['Ботев'])).toBe('Ботев')
    expect(listText(['Ботев', 'Център'])).toBe('Ботев и Център')
    expect(listText(['Ботев', 'Център', 'Младост'])).toBe('Ботев, Център и Младост')
  })
})

describe('notification texts', () => {
  const trip = { number: 27, planned_date: '2026-11-13', planned_time: '09:00', stores: ['Ботев', 'Център'] }

  it('the driver hears the trip, the day and the stores', () => {
    const t = tripAssignedText(trip, TODAY)
    expect(t.kind).toBe('trip_assigned')
    expect(t.title).toBe('Имаш курс К-000027: утре, 9:00')
    expect(t.body).toContain('Магазини: Ботев и Център')
  })

  it('a store hears what comes and when, and not to ask for it', () => {
    const t = shipmentComingText({ number: 35, units: 10, products: 3 }, trip, TODAY)
    expect(t.title).toBe('Идва към вас П-000035: 10 бр., тръгва утре, 9:00')
    expect(t.body).toContain('Не правете заявка')
    const noDay = shipmentComingText({ number: 35, units: 1, products: 1 }, { ...trip, planned_date: null }, TODAY)
    expect(noDay.title).toBe('Идва към вас П-000035: 1 бр.')
    expect(noDay.body).toMatch(/^1 продукт /)
  })

  it('on the way: driver and boxes when known', () => {
    expect(shipmentSentText({ number: 35, units: 10, products: 2, boxes: 3 }, 'Ивайло').body).toMatch(/^Шофьор Ивайло, 3 кашона\. /)
    expect(shipmentSentText({ number: 35, units: 10, products: 2, boxes: null }, null).body).toMatch(/^Стоката вече се продава/)
  })

  it('cancelled and issues', () => {
    expect(tripCancelledText({ number: 27 }, 'няма кола').body).toBe('Причина: няма кола. Стоката остава в Офис за следващ курс.')
    expect(shipmentIssueText({ number: 35 }, 'Ботев', 2).title).toBe('Ботев прие П-000035 с разлики')
    expect(shipmentIssueText({ number: 35 }, 'Ботев', 1).body).toMatch(/^1 ред не е наред/)
  })
})
