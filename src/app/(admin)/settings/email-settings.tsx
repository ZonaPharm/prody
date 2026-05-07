'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
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
    if (!list.includes(newRecipient)) {
      setSettings({ ...settings, recipients: [...list, newRecipient] })
    }
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
      <CardHeader>
        <CardTitle className="text-lg">Имейл настройки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* SMTP */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">SMTP Хост</Label>
            <Input value={settings.smtp_host || ''} onChange={e => setSettings({ ...settings, smtp_host: e.target.value })} placeholder="smtp.gmail.com" className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">SMTP Порт</Label>
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

        {/* Sender */}
        <div className="space-y-1 max-w-sm">
          <Label className="text-xs">Имейл подател</Label>
          <Input value={settings.sender_email || ''} onChange={e => setSettings({ ...settings, sender_email: e.target.value })} placeholder="prody@zonapharm.com" className="h-9" />
        </div>

        {/* Recipients */}
        <div className="space-y-2">
          <Label className="text-xs">Получатели</Label>
          <div className="flex flex-wrap gap-2 mb-2">
            {(settings.recipients || []).map((email: string) => (
              <span key={email} className="inline-flex items-center gap-1 bg-slate-100 rounded-full px-3 py-1 text-sm">
                📧 {email}
                <button onClick={() => removeRecipient(email)} className="text-slate-400 hover:text-red-500"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={newRecipient} onChange={e => setNewRecipient(e.target.value)} placeholder="email@example.com" className="h-9 max-w-xs"
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addRecipient())} />
            <Button size="sm" variant="outline" onClick={addRecipient}><Plus className="mr-1 h-3 w-3" />Добави</Button>
          </div>
        </div>

        {/* Report schedule */}
        <div className="flex items-center gap-4 flex-wrap">
          <Label className="text-sm">Седмичен отчет:</Label>
          <Select value={String(settings.report_day || 5)} onValueChange={v => setSettings({ ...settings, report_day: parseInt(v) })}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(settings.report_hour || 18)} onValueChange={v => setSettings({ ...settings, report_hour: parseInt(v) })}>
            <SelectTrigger className="w-[85px]"><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: 24 }, (_, i) => <SelectItem key={i} value={String(i)}>{i}:00</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {/* Sections */}
        <div className="space-y-2">
          <Label className="text-xs">Съдържание на отчета</Label>
          {SECTIONS.map(s => (
            <div key={s.key} className="flex items-center gap-2">
              <Checkbox id={`sec-${s.key}`} checked={(settings.report_sections || []).includes(s.key)} onCheckedChange={() => toggleSection(s.key)} />
              <label htmlFor={`sec-${s.key}`} className="text-sm cursor-pointer">{s.label}</label>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2 border-t">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Запази
          </Button>
          <Button variant="outline" onClick={testSend} disabled={testing}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Изпрати тестов отчет
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
