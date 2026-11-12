'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Loader2, Search } from 'lucide-react'
import type { DeliveryProduct } from '@/lib/deliveries/products'
import { cn } from '@/lib/utils'

/**
 * The search field of the entry screen: type a name, SKU or barcode, pick with
 * the mouse or with ↑ ↓ and Enter. Enter on a fresh search takes the first hit,
 * so a barcode scanner (which types and presses Enter) adds the line at once.
 */
export function ProductPicker({ onPick, disabled, placeholder = 'Добави продукт: име, код или баркод и Enter', autoFocus, className, scrollOnFocus }: {
  onPick: (p: DeliveryProduct) => void
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
  className?: string
  /** On a phone the list opens under the field: bring the field up first so the list fits above the keyboard. */
  scrollOnFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<DeliveryProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [error, setError] = useState('')
  const seq = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingEnter = useRef(false)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    const my = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/deliveries/products/search?q=${encodeURIComponent(term)}`)
        const data = await res.json()
        if (my !== seq.current) return
        if (!res.ok) throw new Error(data.error || 'Търсенето не мина')
        setResults(data)
        setActive(0)
        setOpen(true)
        setError('')
        if (pendingEnter.current && data.length > 0) {
          pendingEnter.current = false
          pick(data[0])
        }
      } catch (e: any) {
        if (my === seq.current) setError(e.message)
      } finally {
        if (my === seq.current) setLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function pick(p: DeliveryProduct) {
    onPick(p)
    setQ('')
    setResults([])
    setOpen(false)
    pendingEnter.current = false
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(a => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(a => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (loading) pendingEnter.current = true
      else if (results[active]) pick(results[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={q}
        disabled={disabled}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (results.length) setOpen(true)
          if (scrollOnFocus && window.innerWidth < 640) inputRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn('pl-8 bg-white scroll-mt-24', className)}
        aria-label="Търсене на продукт"
      />
      {loading && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {open && q.trim().length >= 2 && !loading && (
        <div className="absolute z-30 mt-1 w-full rounded-md border bg-white shadow-lg max-h-80 overflow-auto">
          {results.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">Няма такъв продукт. Използвайте „Нов продукт“.</div>
          ) : (
            results.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(p)}
                onMouseEnter={() => setActive(i)}
                className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm', i === active && 'bg-slate-100')}
              >
                <ProductThumb src={p.image} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.sku ? `${p.sku} · ` : ''}наличност {p.quantity_on_hand} бр.
                    {p.status !== 'active' && <span className="ml-1 text-amber-700">(неактивен)</span>}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function ProductThumb({ src, size = 32 }: { src: string | null; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="rounded object-cover bg-slate-100 shrink-0" style={{ width: size, height: size }} />
  ) : (
    <span className="rounded bg-slate-100 shrink-0" style={{ width: size, height: size }} />
  )
}
