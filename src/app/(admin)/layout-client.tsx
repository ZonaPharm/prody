'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/ui/header'
import { X, LayoutDashboard, Package2, ShoppingBag, BarChart3, Settings } from 'lucide-react'

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  '/dashboard': LayoutDashboard,
  '/catalog': Package2,
  '/sales': ShoppingBag,
  '/reports': BarChart3,
  '/settings': Settings,
}

interface NavItem {
  href: string
  label: string
}

export function AdminLayoutClient({
  navItems,
  children,
}: {
  navItems: NavItem[]
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  const currentTitle = navItems.find(item => pathname.startsWith(item.href))?.label

  return (
    <div className="flex min-h-screen flex-col">
      <Header title={currentTitle} showRoleSwitch onMenuClick={() => setSidebarOpen(true)} />

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-56 flex-col border-r bg-slate-900 text-white shrink-0">
          <SidebarContent navItems={navItems} pathname={pathname} />
        </aside>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="absolute left-0 top-0 h-full w-64 bg-slate-900 text-white flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-slate-800">
                <span className="font-bold text-lg">Prody</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-slate-400"
                  onClick={() => setSidebarOpen(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <SidebarContent navItems={navItems} pathname={pathname} />
            </aside>
          </div>
        )}

        <main className="flex-1 bg-slate-50 p-4 lg:p-8 overflow-auto">{children}</main>
      </div>
    </div>
  )
}

function SidebarContent({
  navItems,
  pathname,
}: {
  navItems: NavItem[]
  pathname: string
}) {
  return (
    <>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(item => {
          const Icon = iconMap[item.href]
          return (
            <Button
              key={item.href}
              variant={pathname.startsWith(item.href) ? 'secondary' : 'ghost'}
              asChild
              className={`w-full justify-start ${
                pathname.startsWith(item.href)
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Link href={item.href}>
                {Icon && <Icon className="mr-2 h-4 w-4" />}
                {item.label}
              </Link>
            </Button>
          )
        })}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <form action="/auth/signout" method="post">
          <Button
            variant="ghost"
            className="w-full justify-start text-slate-400 hover:text-white"
          >
            Изход
          </Button>
        </form>
      </div>
    </>
  )
}
