import { requireAuth } from '@/lib/auth'
import Link from 'next/link'
import { ShoppingBag, Package2, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'

const navItems = [
  { href: '/record-sale', label: 'Запиши продажба', icon: ShoppingBag },
  { href: '/my-sales', label: 'Моите продажби', icon: BarChart3 },
  { href: '/seller-catalog', label: 'Каталог', icon: Package2 },
]

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth()

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r bg-slate-900 text-white flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <Link href="/record-sale" className="text-xl font-bold tracking-tight">Prody</Link>
          <p className="text-xs text-slate-400 mt-1">{user.display_name}</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(item => (
            <Button key={item.href} variant="ghost" asChild className="w-full justify-start text-slate-300 hover:text-white hover:bg-slate-800">
              <Link href={item.href}>
                <item.icon className="mr-2 h-4 w-4" />
                {item.label}
              </Link>
            </Button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800">
          <form action="/auth/signout" method="post">
            <Button variant="ghost" className="w-full justify-start text-slate-400 hover:text-white">
              Изход
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 bg-slate-50 p-8">{children}</main>
    </div>
  )
}
