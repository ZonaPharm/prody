import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, Lightbulb, OctagonAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * One look per kind of text, the same on every screen, so it is clear at a
 * glance what a piece of text is:
 *
 * - Заглавие на страницата: PageHeader (голямо, удебелено, черно), под него
 *   един ред сив текст какво е тази страница.
 * - Заглавие на раздел: SectionTitle (по-малко, удебелено, черно).
 * - Данни: обикновен черен текст; второстепенните (код, дата, кой) са малки
 *   и сиви: Meta.
 * - Подсказка какво да направите: Hint (синьо, с крушка).
 * - Обяснение / за сведение: Note tone="info" (сиво каре с „i“).
 * - Внимание: Note tone="warn" (жълто каре с триъгълник).
 * - Грешка или спряно: Note tone="danger" (червено каре).
 * - Готово: Note tone="success" (зелено каре с отметка).
 * - Празен списък: Empty (сив курсив в рамка).
 */

export function PageHeader({ title, intro, back, actions, className }: {
  title: ReactNode
  /** One line on what this screen is for. */
  intro?: ReactNode
  /** A back button, shown left of the title. */
  back?: ReactNode
  /** Buttons on the right (wrap under the title on a phone). */
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-2">
        {back}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {intro && <p className="mt-0.5 text-sm text-slate-600">{intro}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function SectionTitle({ children, count, action, className }: {
  children: ReactNode
  /** "3 магазина", "12 бр.": shown smaller and grey after the title. */
  count?: ReactNode
  /** A link or button on the right. */
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', className)}>
      <h2 className="text-base font-semibold text-slate-900">{children}</h2>
      {count != null && <span className="whitespace-nowrap text-sm text-slate-500">{count}</span>}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  )
}

/** What to do next / how to use this: blue with a light bulb. */
export function Hint({ children, className, small }: { children: ReactNode; className?: string; small?: boolean }) {
  return (
    <p className={cn('flex items-start gap-1.5 text-sky-800', small ? 'text-xs' : 'text-sm', className)}>
      <Lightbulb className={cn('shrink-0 text-sky-500', small ? 'mt-px h-3.5 w-3.5' : 'mt-0.5 h-4 w-4')} aria-hidden />
      <span>{children}</span>
    </p>
  )
}

const NOTE = {
  info: { box: 'border-slate-200 bg-slate-50 text-slate-700', icon: 'text-slate-500', Icon: Info },
  warn: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: 'text-amber-600', Icon: AlertTriangle },
  danger: { box: 'border-red-200 bg-red-50 text-red-800', icon: 'text-red-600', Icon: OctagonAlert },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: 'text-emerald-600', Icon: CheckCircle2 },
} as const

export type NoteTone = keyof typeof NOTE

/** A boxed message: an explanation (info), a warning, an error or "done". */
export function Note({ tone = 'info', children, className, small }: {
  tone?: NoteTone
  children: ReactNode
  className?: string
  small?: boolean
}) {
  const t = NOTE[tone]
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn('flex items-start gap-2 rounded-md border px-3 py-2', small ? 'text-xs' : 'text-sm', t.box, className)}
    >
      <t.Icon className={cn('shrink-0', small ? 'mt-px h-3.5 w-3.5' : 'mt-0.5 h-4 w-4', t.icon)} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Secondary data next to the main one: a code, a date, who did it. */
export function Meta({ children, className, as: As = 'p' }: { children: ReactNode; className?: string; as?: 'p' | 'span' | 'div' }) {
  return <As className={cn('text-xs text-slate-500', className)}>{children}</As>
}

/** An empty list: "Нищо не чака." */
export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('px-4 py-6 text-center text-sm italic text-slate-500', className)}>{children}</p>
}
