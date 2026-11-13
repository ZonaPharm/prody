'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  Bell,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Package2,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Truck,
  X,
  Receipt,
  PackageCheck,
  ListChecks,
  Sparkles,
} from 'lucide-react'
import { SwitchRoleButton } from '@/components/admin/switch-role-button'

/**
 * One frame for both admin and seller screens.
 *
 *  - Computer (lg and up): light sidebar on the left with the logo, the menu and,
 *    at the bottom, who is signed in, "Виж като продавач" and "Изход".
 *  - Phone and tablet: a slim bar on top and a tab bar at the bottom with the
 *    main screens; the rest sit under "Още". Screens with their own action bar at
 *    the bottom place it above the tab bar with `bottom-[var(--bottom-nav-h)]`
 *    (the height is set in globals.css and is 0 on a computer).
 */

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '/dashboard': LayoutDashboard,
  '/catalog': Package2,
  '/sales': Receipt,
  '/reports': BarChart3,
  '/inventory': ClipboardList,
  '/deliveries': Truck,
  '/requests': Bell,
  '/settings': Settings,
  '/record-sale': ShoppingCart,
  '/my-sales': ShoppingBag,
  '/my-requests': Bell,
  '/my-shipments': PackageCheck,
  '/tasks': ListChecks,
  '/my-tasks': ListChecks,
  '/assistant': Sparkles,
}

export interface ShellNavItem {
  href: string
  label: string
  /** Shorter label for the phone tab bar. */
  short?: string
  /** A number shown beside the item (0 or missing hides it). */
  badge?: number
  /** Red for problems, blue for "waiting for you", amber for "on the way". */
  badgeTone?: 'red' | 'blue' | 'amber'
  /** A live badge rendered by the item itself (e.g. requests count). */
  badgeNode?: React.ReactNode
}

const TONE: Record<NonNullable<ShellNavItem['badgeTone']>, string> = {
  red: 'bg-red-600 text-white',
  blue: 'bg-blue-600 text-white',
  amber: 'bg-amber-500 text-white',
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/')
}

function Badge({ item }: { item: ShellNavItem }) {
  if (item.badgeNode) return <>{item.badgeNode}</>
  if (!item.badge) return null
  return (
    <span className={`ml-auto min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center ${TONE[item.badgeTone ?? 'red']}`}>
      {item.badge}
    </span>
  )
}

export function AppShell({
  navItems,
  tabHrefs,
  userName,
  roleLabel,
  switchRole,
  bell,
  children,
}: {
  navItems: ShellNavItem[]
  /** Which items get their own tab on the phone (at most 4); the rest go under "Още". */
  tabHrefs?: string[]
  userName: string
  roleLabel?: string
  /** Which "switch view" button to show, if any. */
  switchRole?: 'seller' | 'admin'
  /** "Задачи" in the phone's top bar, with the count of what waits for this person. */
  bell?: { href: string; count: number }
  children: React.ReactNode
}) {
  const pathname = usePathname()
  // The "Още" sheet remembers the screen it was opened on, so it closes by
  // itself as soon as the user goes to another screen.
  const [moreOpenOn, setMoreOpenOn] = useState<string | null>(null)
  const moreOpen = moreOpenOn === pathname
  const setMoreOpen = (open: boolean) => setMoreOpenOn(open ? pathname : null)

  const tabs = (tabHrefs ?? navItems.slice(0, 4).map(i => i.href))
    .map(h => navItems.find(i => i.href === h))
    .filter(Boolean) as ShellNavItem[]
  const rest = navItems.filter(i => !tabs.includes(i))
  const restActive = rest.some(i => isActive(pathname, i.href))
  const restHasBadge = rest.some(i => i.badge)

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* ---------- Computer: sidebar ---------- */}
      <aside className="hidden lg:flex w-56 shrink-0 flex-col border-r bg-white sticky top-0 h-screen">
        <Link href={navItems[0]?.href ?? '/'} className="flex h-16 items-center px-5 border-b">
          <Image src="/logo-trim.png" alt="Prody" width={112} height={38} className="h-8 w-auto" priority />
        </Link>
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {navItems.map(item => {
            const Icon = ICONS[item.href]
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {Icon && <Icon className="h-[18px] w-[18px] shrink-0" />}
                <span className="truncate">{item.label}</span>
                <Badge item={item} />
              </Link>
            )
          })}
        </nav>
        <div className="border-t p-3 space-y-2">
          <UserLine userName={userName} roleLabel={roleLabel} />
          {switchRole && <SwitchRoleButton targetRole={switchRole} />}
          <SignOut />
        </div>
      </aside>

      {/* ---------- Phone: top bar ---------- */}
      <header className="lg:hidden sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-white/95 backdrop-blur px-4 pt-[env(safe-area-inset-top)]">
        <Image src="/logo-trim.png" alt="Prody" width={84} height={29} className="h-6 w-auto" priority />
        <div className="flex-1" />
        {bell && (
          <Link
            href={bell.href}
            className={`relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-100 ${isActive(pathname, bell.href) ? 'text-primary' : 'text-slate-600'}`}
            aria-label={bell.count ? `Задачи: ${bell.count}` : 'Задачи'}
          >
            <ListChecks className="h-5 w-5" />
            {bell.count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white ring-2 ring-white">
                {bell.count > 99 ? '99+' : bell.count}
              </span>
            )}
          </Link>
        )}
        <button
          onClick={() => setMoreOpen(true)}
          className="h-9 w-9 rounded-full bg-primary/10 text-primary text-sm font-semibold flex items-center justify-center"
          aria-label="Профил и изход"
        >
          {initials(userName)}
        </button>
      </header>

      <main className="flex-1 min-w-0 p-4 lg:p-6 pb-[calc(var(--bottom-nav-h)+1rem)] lg:pb-6">
        {children}
      </main>

      {/* ---------- Phone: bottom tab bar ---------- */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
        aria-label="Главно меню"
      >
        <div className="flex h-[3.75rem]">
          {tabs.map(item => {
            const Icon = ICONS[item.href]
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
                  active ? 'text-primary font-semibold' : 'text-slate-500'
                }`}
              >
                {active && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-primary" />}
                <span className="relative">
                  {Icon && <Icon className="h-6 w-6" />}
                  {(item.badge || item.badgeNode) ? <TabDot item={item} /> : null}
                </span>
                <span className="truncate max-w-full px-1">{item.short ?? item.label}</span>
              </Link>
            )
          })}
          {rest.length > 0 && (
            <button
              onClick={() => setMoreOpen(true)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
                restActive ? 'text-primary font-semibold' : 'text-slate-500'
              }`}
            >
              {restActive && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-primary" />}
              <span className="relative">
                <MenuIcon className="h-6 w-6" />
                {restHasBadge && <span className="absolute -top-0.5 -right-1 h-2.5 w-2.5 rounded-full bg-red-600 ring-2 ring-white" />}
              </span>
              <span>Още</span>
            </button>
          )}
        </div>
      </nav>

      {/* ---------- Phone: "Още" sheet ---------- */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white shadow-xl pb-[calc(env(safe-area-inset-bottom)+0.75rem)] animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <UserLine userName={userName} roleLabel={roleLabel} />
              <button onClick={() => setMoreOpen(false)} className="h-9 w-9 rounded-full hover:bg-slate-100 flex items-center justify-center" aria-label="Затвори">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            {rest.length > 0 && (
              <nav className="px-2 py-1 border-t">
                {rest.map(item => {
                  const Icon = ICONS[item.href]
                  const active = isActive(pathname, item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex h-12 items-center gap-3 rounded-lg px-3 text-[15px] ${
                        active ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-700 active:bg-slate-100'
                      }`}
                    >
                      {Icon && <Icon className="h-5 w-5" />}
                      <span>{item.label}</span>
                      <Badge item={item} />
                    </Link>
                  )
                })}
              </nav>
            )}
            <div className="px-4 pt-2 space-y-2 border-t">
              <div className="pt-1" />
              {switchRole && <SwitchRoleButton targetRole={switchRole} />}
              <SignOut />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TabDot({ item }: { item: ShellNavItem }) {
  if (item.badgeNode) return <span className="absolute -top-1.5 -right-3 scale-90">{item.badgeNode}</span>
  return (
    <span className={`absolute -top-1.5 -right-3 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center ring-2 ring-white ${TONE[item.badgeTone ?? 'red']}`}>
      {item.badge}
    </span>
  )
}

function UserLine({ userName, roleLabel }: { userName: string; roleLabel?: string }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="h-8 w-8 shrink-0 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
        {initials(userName)}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">{userName}</p>
        {roleLabel && <p className="text-xs text-slate-500 truncate">{roleLabel}</p>}
      </div>
    </div>
  )
}

function SignOut() {
  return (
    <form action="/auth/signout" method="post">
      <button className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900">
        <LogOut className="h-[18px] w-[18px]" />
        Изход
      </button>
    </form>
  )
}

function initials(name: string) {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}
