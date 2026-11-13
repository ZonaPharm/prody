'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { autoDots, formatDateBg, parseDateBg } from '@/lib/date-input'
import { fieldTextAfterPageChange } from '@/lib/date-ranges'

export type DateFieldProps = {
  /** YYYY-MM-DD, or '' for no date. */
  value: string
  /** Called with YYYY-MM-DD once a whole date is typed or picked ('' when cleared, if allowEmpty). */
  onChange: (ymd: string) => void
  /** Earliest date allowed (YYYY-MM-DD). */
  min?: string
  /** The field may be left empty (a filter that is off). */
  allowEmpty?: boolean
  /** Wait this long after typing stops before taking a typed date (filters that start a search). */
  typingPauseMs?: number
  id?: string
  className?: string
  inputClassName?: string
  'aria-label'?: string
  disabled?: boolean
}

/**
 * A date field that always shows and takes дд.мм.гггг, whatever the browser's
 * language (the browser's own field showed 11/08/2026 in an English browser).
 * The dots go in by themselves, so the phone's number pad is enough. The
 * calendar button opens the browser's calendar for picking with a tap.
 */
export function DateField({
  value, onChange, min, allowEmpty = false, typingPauseMs = 0,
  id, className, inputClassName, disabled, ...aria
}: DateFieldProps) {
  const [text, setText] = useState(formatDateBg(value))
  const [shown, setShown] = useState(value)
  // The date this field gave the page and is waiting to see come back.
  const [askedFor, setAskedFor] = useState<string | null>(null)
  if (value !== shown) {
    setShown(value)
    setText(fieldTextAfterPageChange(formatDateBg(value), askedFor === null ? null : formatDateBg(askedFor), text))
    setAskedFor(null)
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  useEffect(() => stop, [])

  const allowed = (ymd: string | null): ymd is string => !!ymd && (!min || ymd >= min)
  const take = (ymd: string) => {
    stop()
    if (ymd === value || ymd === askedFor) return
    setAskedFor(ymd)
    onChange(ymd)
  }
  // Enter or leaving the field: take what is there (8.11.26 too), or put the date back.
  const settle = () => {
    stop()
    const ymd = parseDateBg(text, { shortYear: true })
    if (allowed(ymd)) { setText(formatDateBg(ymd)); take(ymd) }
    else if (text.trim() === '' && allowEmpty) { if (value !== '') { setAskedFor(''); onChange('') } }
    else setText(formatDateBg(value))
  }

  return (
    <div className={cn('relative h-10', className)}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="дд.мм.гггг"
        disabled={disabled}
        {...aria}
        value={text}
        onChange={e => {
          const t = autoDots(e.target.value)
          setText(t)
          stop()
          const ymd = parseDateBg(t)
          if (!allowed(ymd)) return
          if (typingPauseMs > 0) timer.current = setTimeout(() => take(ymd), typingPauseMs)
          else take(ymd)
        }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); settle() } }}
        onBlur={settle}
        className={cn(
          'flex h-full w-full rounded-md border border-input bg-background pl-3 pr-10 py-2 text-base tabular-nums ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          inputClassName,
        )}
      />
      {/* The calendar: the browser's own date picker under a transparent field over the icon. */}
      <span className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground">
        <CalendarDays className="h-4 w-4" aria-hidden />
        <input
          type="date"
          tabIndex={-1}
          aria-label="Избери от календара"
          disabled={disabled}
          value={value}
          min={min}
          onClick={e => { try { e.currentTarget.showPicker() } catch { /* older browsers open it themselves */ } }}
          onChange={e => {
            const ymd = e.target.value
            if (!allowed(ymd)) return
            setText(formatDateBg(ymd))
            take(ymd)
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
    </div>
  )
}
