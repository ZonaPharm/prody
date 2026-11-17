import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CategoriesManager } from './categories-manager'
import { StoresManager } from './stores-manager'
import { AiSettings } from './ai-settings'
import { AssistantAccess } from './assistant-access'
import { MinQtyManager } from './min-qty-manager'
import { EmailSettings } from './email-settings'
import { UsersManager } from './users-manager'
import { AuditLogs } from './audit-logs'
import { AppErrors } from './app-errors'
import { BackupSettings } from './backup-settings'
import { ExternalImages } from './external-images'
import { SuppliersManager } from './suppliers-manager'
import { deliveriesEnabledFor } from '@/lib/deliveries/feature'

export const dynamic = 'force-dynamic'

const TABS = ['categories', 'stores', 'suppliers', 'min-qty', 'ai', 'email', 'users', 'logs', 'errors', 'backup', 'images']

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireAdmin()
  // Links from other screens open the right tab, e.g. /settings?tab=users.
  const { tab } = await searchParams
  const initialTab = tab && TABS.includes(tab) ? tab : 'categories'
  // Suppliers belong to the deliveries feature and show only where it is on.
  const deliveries = deliveriesEnabledFor(user.email)
  const supabase = await createServerSupabaseClient()

  const { data: products } = await (supabase.from('products') as any)
    .select('id, name, min_quantity')
    .eq('status', 'active')
    .order('name')

  // Open errors on the tab itself, so they are seen without opening it.
  // Before the app_errors migration this is simply null and the tab shows none.
  const { count: openErrors } = await (createAdminClient().from('app_errors') as any)
    .select('id', { count: 'exact', head: true })
    .is('resolved_at', null)

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">Настройки</h1>
      <Tabs defaultValue={initialTab}>
        {/* Ten sections: on a phone they wrap into rows, all visible, instead of a strip that hides half of them off-screen. */}
        <TabsList className="h-auto flex-wrap gap-1 overflow-visible mb-2">
          <TabsTrigger value="categories">Категории</TabsTrigger>
          <TabsTrigger value="stores">Магазини</TabsTrigger>
          {deliveries && <TabsTrigger value="suppliers">Доставчици</TabsTrigger>}
          <TabsTrigger value="min-qty">Мин. количества</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="email">Имейл</TabsTrigger>
          <TabsTrigger value="users">Потребители</TabsTrigger>
          <TabsTrigger value="logs">Логове</TabsTrigger>
          <TabsTrigger value="errors" className={openErrors ? 'text-red-700' : undefined}>
            Грешки{openErrors ? ` (${openErrors})` : ''}
          </TabsTrigger>
          <TabsTrigger value="backup">Бекъп</TabsTrigger>
        </TabsList>
        <TabsContent value="categories">
          <CategoriesManager />
        </TabsContent>
        <TabsContent value="stores">
          <StoresManager />
        </TabsContent>
        {deliveries && (
          <TabsContent value="suppliers">
            <SuppliersManager />
          </TabsContent>
        )}
        <TabsContent value="min-qty">
          <MinQtyManager products={products || []} />
        </TabsContent>
        <TabsContent value="ai">
          <AiSettings />
          <AssistantAccess />
        </TabsContent>
        <TabsContent value="email">
          <EmailSettings />
        </TabsContent>
        <TabsContent value="users">
          <UsersManager />
        </TabsContent>
        <TabsContent value="logs">
          <AuditLogs />
        </TabsContent>
        <TabsContent value="errors">
          <AppErrors />
        </TabsContent>
        <TabsContent value="backup">
          <BackupSettings />
          <ExternalImages />
        </TabsContent>
      </Tabs>
    </div>
  )
}
