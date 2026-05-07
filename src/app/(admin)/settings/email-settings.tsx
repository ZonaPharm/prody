'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Save, Send, Plus, X, Loader2 } from 'lucide-react'

const DAYS = ['Неделя', 'Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота']
const SECTIONS = [
  { key: 'summary', label: 'Общо — оборот, брой продажби, среден чек' },
  { key: 'stores', label: 'По обекти — оборот по магазини' },
  { key: 'top-products', label: 'Топ продукти — най-продавани (брой)' },
  { key: 'top-revenue', label: 'Топ приходи — най-продавани (оборот)' },
  { key: 'low-stock', label: 'Ниски наличности — продукти под минимума' },
]

export function EmailSettings() {
  const [settings, setSettings] = useState<any>(null)
  const [newRecipient, setNewRecipient] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    fetch('/api/email-settings').then(r => r.json()).then(setSettings)
  }, [])

  const save = async () => {
    setSaving(true)
    await fetch('/api/email-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaving(false)
    setToast('Запазено')
    setTimeout(() => setToast(''), 2000)
  }

  const testSend = async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/reports/send-email', { method: 'POST' })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error) }
      setToast('Тестов мейл изпратен')
    } catch (e: any) { setToast('Грешка: ' + (e.message || 'неуспешно')) }
    setTesting(false)
    setTimeout(() => setToast(''), 3000)
  }

  const addRecipient = () => {
    if (!newRecipient || !newRecipient.includes('@')) return
    const list = settings?.recipients || []
    if (!list.includes(newRecipient)) setSettings({ ...settings, recipients: [...list, newRecipient] })
    setNewRecipient('')
  }

  const removeRecipient = (email: string) => {
    setSettings({ ...settings, recipients: (settings?.recipients || []).filter((e: string) => e !== email) })
  }

  const toggleSection = (key: string) => {
    const list = settings?.report_sections || []
    const next = list.includes(key) ? list.filter((s: string) => s !== key) : [...list, key]
    setSettings({ ...settings, report_sections: next })
  }

  if (!settings) return <div className="p-4 text-muted-foreground">Зареждане...</div>

  return (
    <Card>
      {toast && <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm">{toast}</div>}
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Имейл настройки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* SMTP */}
        <div>
          <h3 className="text-sm font-semibold mb-3">SMTP сървър</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Хост</Label>
              <Input value={settings.smtp_host || ''} onChange={e => setSettings({ ...settings, smtp_host: e.target.value })} placeholder="smtp.gmail.com" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Порт</Label>
              <Input type="number" value={settings.smtp_port || 587} onChange={e => setSettings({ ...settings, smtp_port: parseInt(e.target.value) || 587 })} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Потребител</Label>
              <Input value={settings.smtp_user || ''} onChange={e => setSettings({ ...settings, smtp_user: e.target.value })} placeholder="prody@gmail.com" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Парола (App Password)</Label>
              <Input type="password" value={settings.smtp_pass || ''} onChange={e => setSettings({ ...settings, smtp_pass: e.target.value })} className="h-9" />
            </div>
          </div>
          <div className="mt-3 max-w-xs">
            <Label className="text-xs">Имейл подател</Label>
            <Input value={settings.sender_email || ''} onChange={e => setSettings({ ...settings, sender_email: e.target.value })} placeholder="prody@zonapharm.com" className="h-9" />
          </div>
        </div>

        {/* Recipients + Report side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recipients */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Получатели</h3>
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
              {(settings.recipients || []).length === 0 ? (
                <span className="text-xs text-muted-foreground">Няма добавени получатели</span>
              ) : (
                (settings.recipients || []).map((email: string) => (
                  <span key={email} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 rounded-full px-2.5 py-0.5 text-xs border border-blue-200">
                    {email}
                    <button onClick={() => removeRecipient(email)} className="hover:text-red-500 ml-0.5"><X className="h-3 w-3" /></button>
                  </span>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <Input value={newRecipient} onChange={e => setNewRecipient(e.target.value)} placeholder="email@example.com" className="h-8 text-sm"
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addRecipient())} />
              <Button size="sm" variant="outline" onClick={addRecipient} className="h-8"><Plus className="mr-1 h-3 w-3" />Добави</Button>
            </div>
          </div>

          {/* Report schedule */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Седмичен отчет</h3>
            <div className="flex items-center gap-2 mb-3">
              <Select value={String(settings.report_day || 5)} onValueChange={v => setSettings({ ...settings, report_day: parseInt(v) })}>
                <SelectTrigger className="w-[130px] h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">в</span>
              <Select value={String(settings.report_hour || 18)} onValueChange={v => setSettings({ ...settings, report_hour: parseInt(v) })}>
                <SelectTrigger className="w-[75px] h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from({ length: 24 }, (_, i) => <SelectItem key={i} value={String(i)}>{i}:00</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              {SECTIONS.map(s => (
                <label key={s.key} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={(settings.report_sections || []).includes(s.key)} onChange={() => toggleSection(s.key)} className="h-3.5 w-3.5 rounded" />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-3 border-t">
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Запази
          </Button>
          <Button variant="outline" size="sm" onClick={testSend} disabled={testing}>
            {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
            Изпрати тестов отчет
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
