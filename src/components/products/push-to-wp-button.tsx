'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Globe } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useRouter } from 'next/navigation'

type Props = {
  productId: string
  wpTitle: string | null
  wpProductId: number | null
  wpSyncedAt: string | null
}

export function PushToWpButton({ productId, wpTitle, wpProductId, wpSyncedAt }: Props) {
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  const hasTitle = Boolean(wpTitle?.trim())

  const push = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/products/${productId}/push-to-wp`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      const body = await res.json().catch(() => ({}))

      if (res.ok) {
        toast({
          title: body.created ? 'Продуктът е качен в сайта' : 'Продуктът е обновен в сайта',
          description: body.permalink,
        })
        router.refresh()
      } else {
        toast({
          title: 'Качването не мина',
          description: body.error || `Грешка ${res.status}`,
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Няма връзка със сървъра', variant: 'destructive' })
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" onClick={push} disabled={busy || !hasTitle}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
        {wpProductId ? 'Обнови в сайта' : 'Изпрати към сайта'}
      </Button>
      {!hasTitle && (
        <p className="text-xs text-muted-foreground">
          Липсва заглавие за сайта — попълнете го в таб „За уебсайта“
        </p>
      )}
      {wpSyncedAt && (
        <p className="text-xs text-muted-foreground">
          В сайта от {new Date(wpSyncedAt).toLocaleDateString('bg-BG')}
        </p>
      )}
    </div>
  )
}
