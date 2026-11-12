'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Pencil, Ban, Loader2, Copy } from 'lucide-react'
import { ROLES, ROLE_HINT, ROLE_LABEL, needsStore, rolesOf, sortRoles, type Role } from '@/lib/roles'

interface UserRow {
  id: string
  display_name: string
  email: string
  role: string
  roles?: string[] | null
  store_id: string | null
  is_active: boolean
  last_sign_in_at: string | null
  created_at: string
}

export function UsersManager() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [stores, setStores] = useState<{ id: string; name: string; is_warehouse?: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [toast, setToast] = useState('')

  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formRoles, setFormRoles] = useState<Role[]>(['seller'])
  const [formStoreId, setFormStoreId] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formSendEmail, setFormSendEmail] = useState(true)
  const [saving, setSaving] = useState(false)
  const [returnedPassword, setReturnedPassword] = useState('')

  const loadUsers = async () => {
    const res = await fetch('/api/users')
    if (res.ok) setUsers(await res.json())
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])
  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setStores(d)
    }).catch(() => {})
  }, [])

  const genPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    let pw = ''
    for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)]
    setFormPassword(pw)
  }

  const openNew = () => {
    setEditing(null)
    setFormName(''); setFormEmail(''); setFormRoles(['seller'])
    setFormStoreId(''); setFormSendEmail(true); setReturnedPassword('')
    genPassword()
    setDialogOpen(true)
  }

  const openEdit = (u: UserRow) => {
    setEditing(u)
    setFormName(u.display_name || '')
    setFormEmail(u.email || '')
    setFormRoles(rolesOf(u))
    setFormStoreId(u.store_id || '')
    setFormPassword('')
    setFormSendEmail(false)
    setReturnedPassword('')
    setDialogOpen(true)
  }

  const save = async () => {
    if (!formName || !formEmail) return
    setSaving(true)
    setReturnedPassword('')

    const body: any = {
      display_name: formName,
      email: formEmail,
      roles: formRoles,
      store_id: needsStore(formRoles) && !formRoles.includes('office') ? formStoreId : null,
      send_email: formSendEmail,
    }
    if (formPassword) body.password = formPassword

    try {
      const url = editing ? `/api/users/${editing.id}` : '/api/users'
      const method = editing ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      if (data.password) {
        setReturnedPassword(data.password)
      } else {
        setDialogOpen(false)
        loadUsers()
      }
    } catch (e: any) {
      setToast(e.message || 'Грешка')
      setTimeout(() => setToast(''), 3000)
    }
    setSaving(false)
  }

  const deactivate = async (u: UserRow) => {
    if (!confirm(`Деактивиране на ${u.display_name}?`)) return
    await fetch(`/api/users/${u.id}`, { method: 'DELETE' })
    loadUsers()
  }

  const copyPassword = () => {
    navigator.clipboard.writeText(returnedPassword)
    setToast('Паролата е копирана')
    setTimeout(() => setToast(''), 2000)
  }

  const toggleRole = (r: Role, on: boolean) =>
    setFormRoles(prev => sortRoles(on ? [...prev, r] : prev.filter(x => x !== r)))
  const warehouse = stores.find(s => s.is_warehouse)
  const shopStores = stores.filter(s => !s.is_warehouse)

  if (loading) return <div className="p-4 text-muted-foreground">Зареждане...</div>

  return (
    <Card>
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm">{toast}</div>
      )}
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-lg">Потребители</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="mr-1.5 h-4 w-4" />Добави</Button>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Име</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Имейл</th>
                <th className="text-left px-4 py-3 font-medium">Роли</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Магазин</th>
                <th className="text-center px-4 py-3 font-medium">Статус</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium">{u.display_name}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{u.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {rolesOf(u).map(r => (
                        <Badge key={r} variant="secondary" className={`text-[10px] ${ROLE_TONE[r]}`}>{ROLE_LABEL[r]}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {stores.find(s => s.id === u.store_id)?.name || '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {!u.is_active ? (
                      <Badge variant="secondary" className="bg-red-100 text-red-800 text-[10px]">Деактивиран</Badge>
                    ) : u.last_sign_in_at ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800 text-[10px]">Активен</Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-[10px]">Поканен</Badge>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(u)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => deactivate(u)}>
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader>
              <DialogTitle>{editing ? 'Редактирай потребител' : 'Нов потребител'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-1">
                <Label className="text-xs">Име</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Имейл</Label>
                <Input value={formEmail} onChange={e => setFormEmail(e.target.value)} className="h-9" />
              </div>
              <fieldset className="space-y-1">
                <legend className="text-xs font-medium">Роли <span className="font-normal text-muted-foreground">(може няколко)</span></legend>
                <div className="divide-y rounded-lg border">
                  {ROLES.map(r => (
                    <label key={r} className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-slate-50" data-testid={`role-${r}`}>
                      <input type="checkbox" className="mt-1 h-4 w-4" checked={formRoles.includes(r)}
                        onChange={e => toggleRole(r, e.target.checked)} />
                      <span>
                        <span className="block text-sm font-medium">{ROLE_LABEL[r]}</span>
                        <span className="block text-xs text-muted-foreground">{ROLE_HINT[r]}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {formRoles.length === 0 && <p className="text-xs text-red-600">Изберете поне една роля.</p>}
              </fieldset>
              {formRoles.includes('office') ? (
                <p className="rounded-md bg-slate-50 px-3 py-2 text-sm">Магазин: <b>{warehouse?.name ?? 'Офис'}</b> <span className="text-muted-foreground">(Офис работи там)</span></p>
              ) : formRoles.includes('seller') && (
                <div className="space-y-1">
                  <Label className="text-xs">Магазин</Label>
                  <Select value={formStoreId} onValueChange={setFormStoreId}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Изберете магазина, в който работи" /></SelectTrigger>
                    <SelectContent>
                      {shopStores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      {warehouse && formStoreId === warehouse.id && <SelectItem value={warehouse.id}>{warehouse.name}</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Парола</Label>
                  <button type="button" onClick={genPassword} className="text-xs text-blue-600 hover:underline">
                    Генерирай
                  </button>
                </div>
                <Input
                  value={formPassword}
                  onChange={e => setFormPassword(e.target.value)}
                  className="h-9"
                  placeholder={editing ? 'Остави празно за без промяна' : ''}
                />
              </div>
              {!editing && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formSendEmail} onChange={e => setFormSendEmail(e.target.checked)} />
                  <span className="text-sm">📧 Изпрати данни за вход на имейла</span>
                </label>
              )}
              {returnedPassword && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-700 font-medium mb-1">Парола — копирай преди да затвориш</p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-bold bg-white px-2 py-1 rounded border">{returnedPassword}</code>
                    <Button size="sm" variant="outline" onClick={copyPassword}>
                      <Copy className="mr-1 h-3 w-3" />Копирай
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => { setDialogOpen(false); setReturnedPassword('') }}>
                  Отказ
                </Button>
                <Button onClick={save} disabled={saving || formRoles.length === 0 || (formRoles.includes('seller') && !formRoles.includes('office') && !formStoreId)}>
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  {editing ? 'Запази' : 'Създай'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

const ROLE_TONE: Record<Role, string> = {
  admin: 'bg-purple-100 text-purple-800',
  office: 'bg-amber-100 text-amber-800',
  seller: 'bg-blue-100 text-blue-800',
  driver: 'bg-emerald-100 text-emerald-800',
  accountant: 'bg-slate-200 text-slate-800',
}
