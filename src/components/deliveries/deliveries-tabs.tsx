import Link from 'next/link'
import { cn } from '@/lib/utils'

export type DeliveriesTab = 'list' | 'work' | 'labels' | 'trips' | 'problems'

const TABS: { key: DeliveriesTab; href: string; label: string }[] = [
  { key: 'list', href: '/deliveries', label: 'Доставки' },
  { key: 'work', href: '/deliveries/work', label: 'За работа' },
  { key: 'labels', href: '/deliveries/labels', label: 'Етикетиране' },
  { key: 'trips', href: '/deliveries/trips', label: 'Курсове' },
  { key: 'problems', href: '/deliveries/problems', label: 'Проблеми' },
]

/** The sections of "Доставки", one row of links above each page. */
export function DeliveriesTabs({ active, problems = 0 }: { active: DeliveriesTab; problems?: number }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b pb-2" aria-label="Доставки">
      {TABS.map(t => (
        <Link key={t.key} href={t.href}
          className={cn('rounded-md px-3 py-1.5 text-sm', active === t.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>
          {t.label}
          {t.key === 'problems' && problems > 0 && (
            <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{problems}</span>
          )}
        </Link>
      ))}
    </nav>
  )
}
