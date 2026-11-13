import { requireAdmin } from '@/lib/auth'
import { isGranted } from '@/lib/assistant/access'
import { AssistantChat } from '@/components/assistant/assistant-chat'
import { Note, PageHeader } from '@/components/ui/text'

export const dynamic = 'force-dynamic'

/** AI асистент: only admins ticked in Настройки → AI (the API checks again on every question). */
export default async function AssistantPage() {
  const user = await requireAdmin()
  if (!(await isGranted(user.id).catch(() => false))) {
    return (
      <div className="max-w-2xl space-y-4">
        <PageHeader title="AI асистент" />
        <Note>Нямате достъп до AI асистента. Администратор може да ви го даде в Настройки → AI.</Note>
      </div>
    )
  }
  return <AssistantChat />
}
