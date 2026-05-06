export const STATUS_LABELS: Record<string, string> = {
  active: 'Активен',
  inactive: 'Неактивен',
}

export const STATUS_VARIANTS: Record<string, { bg: string; text: string; border: string }> = {
  active: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' },
  inactive: { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200' },
}

export const INACTIVE_REASON_LABELS: Record<string, string> = {
  ordered: 'Поръчан',
  received: 'Получен',
  damaged: 'Повреден',
  returned: 'Върнат',
}
