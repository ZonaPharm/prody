import { requireAdmin } from '@/lib/auth'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CategoriesManager } from './categories-manager'
import { StoresManager } from './stores-manager'

export default async function SettingsPage() {
  await requireAdmin()

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Настройки</h1>
      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Категории</TabsTrigger>
          <TabsTrigger value="stores">Магазини</TabsTrigger>
        </TabsList>
        <TabsContent value="categories">
          <CategoriesManager />
        </TabsContent>
        <TabsContent value="stores">
          <StoresManager />
        </TabsContent>
      </Tabs>
    </div>
  )
}
