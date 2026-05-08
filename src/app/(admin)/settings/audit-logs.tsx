'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const ACTION_LABELS: Record<string, string> = {
  create_product: '📦 Създаден продукт', update_product: '✏️ Редактиран продукт', delete_product: '🗑️ Изтрит продукт',
  restock: '📥 Зареждане', transfer: '🔄 Трансфер', sale: '🛒 Продажба',
  request_create: '📋 Заявка', request_fulfill: '✅ Изпълнена заявка', request_confirm: '✔️ Потвърдена заявка',
  user_create: '👤 Създаден потребител', user_update: '✏️ Редактиран потребител', user_deactivate: '🚫 Деактивиран',
  settings_update: '⚙️ Настройки', error: '❌ Грешка',
  login: '🔑 Вход', magiclink: '📧 Magic link', logout: '🚪 Изход',
}

export function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([])
  const [type, setType] = useState('action')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ type, limit: '200' })
    if (action && action !== '__all__') params.set('action', action)
    if (from) params.set('from', from + 'T00:00:00')
    if (to) params.set('to', to + 'T23:59:59')
    const res = await fetch(`/api/audit-logs?${params}`)
    setLogs(await res.json())
    setLoading(false)
  }, [type, action, from, to])

  useEffect(() => { load() }, [load])

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Логове</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={type} onValueChange={v => { setType(v); setAction('') }}>
          <TabsList className="mb-4">
            <TabsTrigger value="action">📋 Действия</TabsTrigger>
            <TabsTrigger value="auth">🔑 Вход/Изход</TabsTrigger>
          </TabsList>

          <div className="flex flex-wrap gap-2 mb-4">
            {type === 'action' && (
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue placeholder="Всички действия" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Всички действия</SelectItem>
                  {Object.entries(ACTION_LABELS).filter(([k]) => !['login','magiclink','logout'].includes(k)).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {type === 'auth' && (
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Всички" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Всички</SelectItem>
                  <SelectItem value="login">Вход</SelectItem>
                  <SelectItem value="magiclink">Magic link</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-[140px] h-8 text-xs" />
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-[140px] h-8 text-xs" />
          </div>

          <TabsContent value="action" className="mt-0">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-xs">Час</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Потребител</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Действие</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Детайли</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-muted-foreground text-xs">Няма записи</td></tr>
                  ) : (
                    logs.map(l => (
                      <tr key={l.id} className="border-b last:border-0 hover:bg-slate-50/50">
                        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString('bg-BG')}</td>
                        <td className="px-4 py-2 text-xs">{l.user_name || '—'}</td>
                        <td className="px-4 py-2 text-xs">{ACTION_LABELS[l.action] || l.action}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{l.details || l.entity_type || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="auth" className="mt-0">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-xs">Час</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Потребител</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Действие</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Статус</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Детайли</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-xs">Няма записи</td></tr>
                  ) : (
                    logs.map(l => (
                      <tr key={l.id} className="border-b last:border-0 hover:bg-slate-50/50">
                        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString('bg-BG')}</td>
                        <td className="px-4 py-2 text-xs">{l.user_name || l.details || '—'}</td>
                        <td className="px-4 py-2 text-xs">{ACTION_LABELS[l.action] || l.action}</td>
                        <td className="px-4 py-2 text-xs">
                          <Badge variant="secondary" className={`text-[10px] ${l.status === 'success' ? 'bg-green-100 text-green-800' : l.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-slate-100'}`}>
                            {l.status === 'success' ? '✅ Успех' : l.status === 'failed' ? '❌ Грешка' : l.status || '—'}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{l.details || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
