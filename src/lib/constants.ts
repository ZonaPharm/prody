export const STATUS_LABELS: Record<string, string> = {
  ordered: 'Поръчан',
  received: 'Получен',
  listed: 'В каталог',
  damaged: 'Повреден',
  returned: 'Върнат',
}

export const STATUS_VARIANTS: Record<string, 'secondary' | 'outline' | 'default' | 'destructive'> = {
  ordered: 'secondary',
  received: 'outline',
  listed: 'default',
  damaged: 'destructive',
  returned: 'destructive',
}
