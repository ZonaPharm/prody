import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CategoriesManager } from './categories-manager'
import { StoresManager } from './stores-manager'
import { AiSettings } from './ai-settings'
import { MinQtyManager } from './min-qty-manager'
import { EmailSettings } from './email-settings'
import { UsersManager } from './users-manager'
import { AuditLogs } from './audit-logs'
import { BackupSettings } from './backup-settings'
import { ExternalImages } from './external-images'
import { SuppliersManager } from './suppliers-manager'
import { deliveriesEnabledFor } from '@/lib/deliveries/feature'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const user = await requireAdmin()
  // Suppliers belong to the deliveries feature and show only where it is on.
  const deliveries = deliveriesEnabledFor(user.email)
  const supabase = await createServerSupabaseClient()

  const { data: products } = await (supabase.from('products') as any)
    .select('id, name, min_quantity')
    .eq('status', 'active')
    .order('name')

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Настройки</h1>
      <Tabs defaultValue="categories">
        <TabsList className="flex-wrap">
          <TabsTrigger value="categories">Категории</TabsTrigger>
          <TabsTrigger value="stores">Магазини</TabsTrigger>
          {deliveries && <TabsTrigger value="suppliers">Доставчици</TabsTrigger>}
          <TabsTrigger value="min-qty">Мин. количества</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="email">Имейл</TabsTrigger>
          <TabsTrigger value="users">Потребители</TabsTrigger>
          <TabsTrigger value="logs">Логове</TabsTrigger>
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
        <TabsContent value="backup">
          <BackupSettings />
          <ExternalImages />
        </TabsContent>
      </Tabs>
    </div>
  )
}
