'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { closedOrder, countFirstLine, type Category } from '@/lib/pos/categories'

interface CategoryPillsProps {
  /** Already in the order to show (src/lib/pos/categories.ts orderCategoriesByUse). */
  categories: Category[]
  selected: string | null
  onSelect: (id: string | null) => void
  className?: string
}

/**
 * The supplier buttons: one line, and "Покажи още" under it opens the rest.
 * The line wraps instead of scrolling sideways, so a mouse reaches every
 * supplier too (17.11.2026 Панацея could not be reached on a computer).
 */
export function CategoryPills({ categories, selected, onSelect, className }: CategoryPillsProps) {
  const [open, setOpen] = useState(false)
  // Suppliers on the first line, measured in the browser. Until then all count
  // as shown, so nothing offers "Покажи още" before it is known to be needed.
  const [onLine, setOnLine] = useState(categories.length)
  const rowRef = useRef<HTMLDivElement>(null)

  const shown = open ? categories : closedOrder(categories, selected)
  const shownKey = shown.map(c => c.id).join(',')

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const measure = () => {
      // A hidden copy (the till draws a phone and a computer layout) has no size.
      if (row.offsetParent === null) return
      const tops = Array.from(row.children).map(el => (el as HTMLElement).offsetTop)
      // The first button is "Всички".
      setOnLine(Math.max(0, countFirstLine(tops) - 1))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    return () => ro.disconnect()
  }, [shownKey, open])

  const hidden = open ? 0 : Math.max(0, categories.length - onLine)

  const pick = (id: string | null) => {
    onSelect(id)
    setOpen(false)
  }

  return (
    <div className={className}>
      <div
        ref={rowRef}
        data-testid="till-categories"
        className={cn('relative -m-0.5 flex flex-wrap gap-2 p-0.5', !open && 'max-h-10 overflow-hidden')}
      >
        <Button
          variant={selected === null ? 'default' : 'outline'}
          size="sm"
          className="shrink-0 rounded-full"
          onClick={() => pick(null)}
        >
          Всички
        </Button>
        {shown.map((cat, i) => (
          <Button
            key={cat.id}
            variant={selected === cat.id ? 'default' : 'outline'}
            size="sm"
            className="shrink-0 rounded-full"
            // Cut off by the closed line: out of the keyboard order as well.
            tabIndex={!open && i >= onLine ? -1 : undefined}
            onClick={() => pick(cat.id)}
          >
            {cat.name}
          </Button>
        ))}
      </div>
      {(hidden > 0 || open) && (
        <button
          type="button"
          data-testid="till-categories-more"
          className="mt-1 inline-flex h-8 items-center gap-1 text-sm font-medium text-primary hover:underline"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          {open
            ? <>Покажи по-малко <ChevronUp className="h-4 w-4" /></>
            : <>Покажи още ({hidden}) <ChevronDown className="h-4 w-4" /></>}
        </button>
      )}
    </div>
  )
}
