'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { dateFieldAction, fieldTextAfterPageChange, TYPING_PAUSE_MS } from '@/lib/date-ranges'

type Props = Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onKeyDown'> & {
  /** The date the page is showing now (YYYY-MM-DD). */
  value: string
  /** Called with a whole, real date once the person stops typing, presses Enter, leaves the field or picks from the calendar. */
  onCommit: (date: string) => void
}

/**
 * A "От" / "До" field for the period filters.
 *
 * The old fields searched on every change. Typing a year went through
 * 0002, 0020, 0202 first, and each of those started a search; on "Моите
 * продажби" the field was also rebuilt after each search, so the cursor fell
 * out and the year came out wrong. On "Отчети" the whole page, fields
 * included, was swapped for "Зареждане..." after the first digit.
 *
 * This field keeps what is typed and searches only with a whole, real date:
 * after a pause in typing, on Enter or on leaving the field. A date picked
 * from the calendar searches at once. When the page changes the period itself
 * (quick buttons, Back), the field shows the new date.
 */
export function PeriodDateInput({ value, onCommit, ...rest }: Props) {
  const [typed, setTyped] = useState(value)
  const [shown, setShown] = useState(value)
  // The date this field asked the page for and is waiting to see.
  const [askedFor, setAskedFor] = useState<string | null>(null)
  if (value !== shown) {
    setShown(value)
    setTyped(fieldTextAfterPageChange(value, askedFor, typed))
    setAskedFor(null)
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastKey = useRef(0)
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  useEffect(() => stop, [])

  const commit = (v: string) => {
    stop()
    if (dateFieldAction(v, value) !== 'search' || v === askedFor) return
    setAskedFor(v)
    onCommit(v)
  }

  return (
    <Input
      {...rest}
      type="date"
      value={typed}
      onKeyDown={e => {
        lastKey.current = Date.now()
        if (e.key === 'Enter') commit(typed)
      }}
      onChange={e => {
        const v = e.target.value
        setTyped(v)
        stop()
        if (dateFieldAction(v, value) !== 'search') return
        const fromKeyboard = Date.now() - lastKey.current < 150
        if (fromKeyboard) timer.current = setTimeout(() => commit(v), TYPING_PAUSE_MS)
        else commit(v)
      }}
      onBlur={() => {
        if (dateFieldAction(typed, value) === 'wait') { stop(); setTyped(value) } // half-typed or empty
        else commit(typed)
      }}
    />
  )
}
