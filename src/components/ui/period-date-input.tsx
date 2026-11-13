'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { dateFieldAction } from '@/lib/date-ranges'

type Props = Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'onBlur'> & {
  /** The date the page is showing now (YYYY-MM-DD). */
  value: string
  /** Called with a whole, real date once the person stops typing or leaves the field. */
  onCommit: (date: string) => void
}

/**
 * A "От" / "До" field for the period filters.
 *
 * The old fields searched on every change. Typing a year went through
 * 0002, 0020, 0202 first, and each of those started a search; on "Моите
 * продажби" the field was also rebuilt after each search, so the cursor fell
 * out and the year came out as 0001 or 52026. On "Отчети" the whole page,
 * fields included, was swapped for "Зареждане..." after the first digit.
 *
 * This field keeps what is typed, searches only with a whole, real date, and
 * waits a moment so one date is one search. Picking from the calendar works
 * as before. When the page changes the period itself (quick buttons, Back),
 * the field shows the new date.
 */
export function PeriodDateInput({ value, onCommit, ...rest }: Props) {
  const [typed, setTyped] = useState(value)
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setTyped(value)
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The page takes a moment to show a new date; do not ask twice for the same one.
  const sent = useRef<string | null>(null)
  const commit = (v: string) => {
    if (sent.current === v) return
    sent.current = v
    onCommit(v)
  }
  // Once the page shows a date, any date may be asked for again.
  useEffect(() => { sent.current = null }, [value])
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  useEffect(() => stop, [])

  return (
    <Input
      {...rest}
      type="date"
      value={typed}
      onChange={e => {
        const v = e.target.value
        setTyped(v)
        stop()
        if (dateFieldAction(v, value) === 'search') {
          timer.current = setTimeout(() => { timer.current = null; commit(v) }, 400)
        }
      }}
      onBlur={() => {
        const action = dateFieldAction(typed, value)
        if (action === 'search') { stop(); commit(typed) }
        // Left half-typed or empty: show the date the page is using.
        else if (action === 'wait') { stop(); setTyped(value) }
      }}
    />
  )
}
