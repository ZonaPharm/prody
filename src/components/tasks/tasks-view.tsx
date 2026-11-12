import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  Inbox,
  Package,
  Route,
  Store,
  Tag,
  Truck,
  UserRound,
} from 'lucide-react'
import type { Task, TaskIcon, TaskTone } from '@/lib/deliveries/tasks'
import type { NotificationRow } from '@/lib/deliveries/tasks-data'
import { sofiaDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { MarkRead } from './mark-read'

/**
 * "Задачи": the person's own cards, most urgent first, each with one button;
 * then what is coming to them; then their notifications. Same screen for
 * every role, the cards differ (src/lib/deliveries/tasks.ts).
 */

const ICON: Record<TaskIcon, React.ComponentType<{ className?: string }>> = {
  truck: Truck,
  package: Package,
  tag: Tag,
  inbox: Inbox,
  alert: AlertTriangle,
  route: Route,
  user: UserRound,
  store: Store,
}

const TONE: Record<TaskTone, { card: string; icon: string; button: string; label: string }> = {
  problem: { card: 'border-red-200', icon: 'bg-red-100 text-red-700', button: 'bg-red-600 text-white', label: 'text-red-700' },
  late: { card: 'border-amber-300', icon: 'bg-amber-100 text-amber-800', button: 'bg-amber-600 text-white', label: 'text-amber-800' },
  do: { card: 'border-slate-200', icon: 'bg-primary/10 text-primary', button: 'bg-primary text-primary-foreground', label: 'text-primary' },
  coming: { card: 'border-slate-200', icon: 'bg-emerald-50 text-emerald-700', button: 'bg-white text-slate-900 border', label: 'text-emerald-700' },
}

export function TasksView({ tasks, notifications, intro }: { tasks: Task[]; notifications: NotificationRow[]; intro?: string }) {
  const now = tasks.filter(t => t.tone !== 'coming')
  const coming = tasks.filter(t => t.tone === 'coming')
  const unread = notifications.filter(n => !n.read_at).map(n => n.id)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Задачи</h1>
        <p className="text-sm text-muted-foreground">{intro ?? 'Какво чака теб сега и какво идва към теб.'}</p>
      </div>

      <section className="space-y-3" aria-labelledby="tasks-now">
        <h2 id="tasks-now" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          За теб сега{now.length ? ` · ${now.length}` : ''}
        </h2>
        {now.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <Check className="h-5 w-5 shrink-0" />Няма какво да правиш сега.
          </p>
        ) : (
          <ul className="space-y-3">{now.map(t => <TaskCard key={t.key} task={t} />)}</ul>
        )}
      </section>

      {coming.length > 0 && (
        <section className="space-y-3" aria-labelledby="tasks-coming">
          <h2 id="tasks-coming" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Идва и предстои</h2>
          <ul className="space-y-3">{coming.map(t => <TaskCard key={t.key} task={t} />)}</ul>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="tasks-news">
        <h2 id="tasks-news" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Известия{unread.length ? ` · ${unread.length} нови` : ''}
        </h2>
        {notifications.length === 0 ? (
          <p className="rounded-xl border bg-white p-4 text-sm text-muted-foreground">Още няма известия.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-white">
            {notifications.map(n => <NotificationItem key={n.id} n={n} />)}
          </ul>
        )}
        <MarkRead ids={unread} />
      </section>
    </div>
  )
}

function TaskCard({ task }: { task: Task }) {
  const Icon = ICON[task.icon]
  const tone = TONE[task.tone]
  return (
    <li className={cn('rounded-xl border bg-white p-4 shadow-sm', tone.card)}>
      <div className="flex gap-3">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', tone.icon)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className={cn('text-xs font-semibold uppercase tracking-wide', tone.label)}>{task.label}</p>
          <p className="text-base font-semibold leading-snug text-slate-900 break-words">{task.title}</p>
          {task.when && (
            <p className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium',
              task.tone === 'late' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-800')}>
              <CalendarClock className="h-4 w-4" />{task.when}
            </p>
          )}
          {task.detail && <p className="text-sm text-slate-600">{task.detail}</p>}
          {task.items && task.items.length > 0 && (
            <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2.5 text-sm text-slate-700">
              {task.items.map((it, i) => <li key={i} className="break-words">{it}</li>)}
            </ul>
          )}
        </div>
      </div>
      {task.href && task.cta && (
        <Link
          href={task.href}
          className={cn('mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold sm:ml-14 sm:w-auto sm:px-5 sm:inline-flex', tone.button)}
        >
          {task.cta}<ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </li>
  )
}

function NotificationItem({ n }: { n: NotificationRow }) {
  const body = (
    <div className="flex gap-3 p-3">
      <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-blue-600')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm break-words', n.read_at ? 'text-slate-700' : 'font-semibold text-slate-900')}>
          {!n.read_at && <span className="sr-only">Ново: </span>}{n.title}
        </p>
        {n.body && <p className="text-sm text-slate-600 break-words">{n.body}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">{sofiaDateTime(n.created_at)}</p>
      </div>
      {n.link && <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />}
    </div>
  )
  return <li>{n.link ? <Link href={n.link} className="block hover:bg-slate-50">{body}</Link> : body}</li>
}
