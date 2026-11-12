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
    <nav className="no-scrollbar -mx-4 px-4 lg:mx-0 lg:px-0 flex gap-1 overflow-x-auto border-b" aria-label="Доставки">
      {TABS.map(t => (
        <Link key={t.key} href={t.href}
          className={cn(
            '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors',
            active === t.key
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-900',
          )}>
          {t.label}
          {t.key === 'problems' && problems > 0 && (
            <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{problems}</span>
          )}
        </Link>
      ))}
    </nav>
  )
}
