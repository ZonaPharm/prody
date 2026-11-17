'use client'

import { DateField } from '@/components/ui/date-field'
import { TYPING_PAUSE_MS } from '@/lib/date-ranges'

type Props = {
  /** The date the page is showing now (YYYY-MM-DD). */
  value: string
  /** Called with a whole, real date: after a pause in typing, on Enter, on leaving the field, or at once when picked from the calendar. */
  onCommit: (date: string) => void
  className?: string
  'aria-label'?: string
}

/**
 * A "От" / "До" field for the period filters (дд.мм.гггг, see DateField).
 *
 * The old fields searched on every change. Typing a year went through
 * 0002, 0020, 0202 first, and each of those started a search; on "Моите
 * продажби" the field was also rebuilt after each search, so the cursor fell
 * out and the year came out wrong. On "Отчети" the whole page, fields
 * included, was swapped for "Зареждане..." after the first digit.
 *
 * This field searches only with a whole, real date and waits for a pause in
 * typing, so one date is one search. When the page changes the period itself
 * (quick buttons, Back), the field shows the new date; the answer to its own
 * search does not wipe what is being typed.
 */
export function PeriodDateInput({ value, onCommit, className, ...aria }: Props) {
  return <DateField value={value} onChange={onCommit} typingPauseMs={TYPING_PAUSE_MS} className={className} {...aria} />
}
