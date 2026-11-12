import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import type { JourneyStep, NextAction } from '@/lib/deliveries/journey'
import { cn } from '@/lib/utils'

/**
 * The steps of a delivery or a trip in order, with the one in progress marked,
 * so it is clear what comes after what. A step with work waiting is a link.
 */
export function StepTrail({ steps }: { steps: JourneyStep[] }) {
  return (
    <ol
      className="grid gap-1 rounded-xl border bg-white p-2"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      aria-label="Стъпки"
    >
      {steps.map((s, i) => {
        const body = (
          <>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  s.state === 'done' && 'bg-emerald-600 text-white',
                  s.state === 'current' && 'bg-primary text-primary-foreground ring-4 ring-primary/15',
                  s.state === 'todo' && 'bg-slate-100 text-slate-500',
                )}
              >
                {s.state === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn('hidden h-px flex-1 sm:block', i === steps.length - 1 ? 'invisible' : s.state === 'done' ? 'bg-emerald-300' : 'bg-slate-200')} />
            </span>
            <span className={cn('mt-1.5 block text-xs font-semibold leading-tight sm:text-sm', s.state === 'todo' ? 'text-slate-500' : 'text-slate-900')}>{s.label}</span>
            <span className="block text-[11px] leading-tight text-muted-foreground sm:text-xs">{s.detail}</span>
          </>
        )
        return (
          <li key={s.key} aria-current={s.state === 'current' ? 'step' : undefined} className="min-w-0">
            {s.href ? (
              <Link href={s.href} className="block rounded-lg p-2 hover:bg-slate-50">{body}</Link>
            ) : (
              <div className="p-2">{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** The one big button for what to do now. */
export function NextStep({ next, doneText }: { next: NextAction; doneText?: string }) {
  if (!next) {
    return doneText ? (
      <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <Check className="h-4 w-4" />{doneText}
      </p>
    ) : null
  }
  return (
    <Link
      href={next.href}
      className="flex items-center justify-between gap-3 rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-sm transition-opacity hover:opacity-95"
    >
      <span>
        <span className="block text-xs uppercase tracking-wide opacity-75">Следваща стъпка</span>
        <span className="block text-base font-semibold">{next.label}</span>
      </span>
      <ArrowRight className="h-5 w-5 shrink-0" />
    </Link>
  )
}
