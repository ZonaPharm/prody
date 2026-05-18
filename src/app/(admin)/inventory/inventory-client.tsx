'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Search, ClipboardList, ArrowRight, ArrowLeft, Check, AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react'

interface Store {
  id: string
  name: string
}

interface ProductResult {
  id: string
  name: string
  barcode?: string
}

interface CorrectionRow {
  id: string
  old_quantity: number
  new_quantity: number
  difference: number
  reason: string
  reason_label: string
  notes: string | null
  product_name: string
  store_name: string
  user_name: string
  created_at: string
}

const REASONS = [
  { value: 'wrong_entry', label: 'Грешно въвеждане' },
  { value: 'damaged', label: 'Повреден продукт' },
  { value: 'expired', label: 'Изтекъл срок' },
  { value: 'inventory_count', label: 'Установено при инвентаризация' },
  { value: 'other', label: 'Друго' },
]

type Step = 'select' | 'count' | 'reason'

export function InventoryClient({ stores }: { stores: Store[] }) {
  const { toast } = useToast()
  const [step, setStep] = useState<Step>('select')

  // Step 1 state
  const [storeId, setStoreId] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [products, setProducts] = useState<ProductResult[]>([])
  const [selectedProduct, setSelectedProduct] = useState<ProductResult | null>(null)
  const [searching, setSearching] = useState(false)

  // Step 2 state
  const [systemTotal, setSystemTotal] = useState<number | null>(null)
  const [actualQuantity, setActualQuantity] = useState('')
  const [loadingStock, setLoadingStock] = useState(false)

  // Step 3 state
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // History
  const [corrections, setCorrections] = useState<CorrectionRow[]>([])

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Search products
  const doSearch = useCallback((q: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (q.length < 2) { setProducts([]); return }
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=10`)
        if (res.ok) {
          const data = await res.json()
          setProducts(data)
        } else {
          const err = await res.json().catch(() => ({ error: res.statusText }))
          toast({ title: err.error || 'Грешка при търсене', variant: 'destructive' })
        }
      } catch (e: any) {
        toast({ title: e.message || 'Грешка при търсене', variant: 'destructive' })
      }
      setSearching(false)
    }, 300)
  }, [])

  // Load system stock when product+store selected
  const loadStock = useCallback(async (productId: string, sid: string) => {
    setLoadingStock(true)
    try {
      const invRes = await fetch(`/api/products/${productId}/inventory`)
      if (invRes.ok) {
        const data = await invRes.json()
        const storeBatches = (data.batches || []).filter((b: any) => b.store_id === sid)
        const total = storeBatches.reduce((s: number, b: any) => s + b.quantity_remaining, 0)
        setSystemTotal(total)
      }
    } catch { /* ignore */ }
    setLoadingStock(false)
  }, [])

  // Load correction history for store
  const loadHistory = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/inventory/corrections?store_id=${sid}&limit=10`)
      if (res.ok) setCorrections(await res.json())
    } catch { /* ignore */ }
  }, [])

  // When store changes, reload history
  useEffect(() => {
    if (storeId) loadHistory(storeId)
  }, [storeId, loadHistory])

  const diff = actualQuantity !== '' && systemTotal !== null
    ? parseInt(actualQuantity) - systemTotal
    : 0

  const canProceedToCount = storeId && selectedProduct
  const canProceedToReason = actualQuantity !== '' && diff !== 0

  const handleProductSelect = (p: ProductResult) => {
    setSelectedProduct(p)
    setProductSearch(p.name)
    setProducts([])
    if (storeId) loadStock(p.id, storeId)
  }

  const handleStoreChange = (sid: string) => {
    setStoreId(sid)
    if (selectedProduct) loadStock(selectedProduct.id, sid)
  }

  const handleSave = async () => {
    if (!selectedProduct || !storeId || diff === 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/inventory/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct.id,
          store_id: storeId,
          actual_quantity: parseInt(actualQuantity),
          reason,
          notes: notes || undefined,
        }),
      })
      if (res.ok) {
        toast({ title: 'Корекцията е записана успешно' })
        setStep('select')
        setSelectedProduct(null)
        setProductSearch('')
        setActualQuantity('')
        setSystemTotal(null)
        setReason('')
        setNotes('')
        loadHistory(storeId)
      } else {
        const err = await res.json()
        toast({ title: err.error || 'Грешка', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Грешка при запис', variant: 'destructive' })
    }
    setSaving(false)
  }

  const storeName = stores.find(s => s.id === storeId)?.name

  return (
    <div className="space-y-6 w-full">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Инвентаризация</h1>
        <p className="text-muted-foreground text-sm mt-1">Корекция на наличностите</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(['select', 'count', 'reason'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
              step === s ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'
            }`}>
              {step === s ? i + 1 : (i + 1)}
            </div>
            <span className={step === s ? 'font-medium' : 'text-muted-foreground'}>
              {s === 'select' ? 'Избор' : s === 'count' ? 'Бройка' : 'Причина'}
            </span>
            {i < 2 && <ArrowRight className="w-4 h-4 text-muted-foreground mx-1" />}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          {step === 'select' && (
            <>
              <div>
                <Label>Магазин</Label>
                <Select value={storeId} onValueChange={handleStoreChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Изберете магазин" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Продукт</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-10"
                    placeholder="Търсене по име или баркод..."
                    value={productSearch}
                    onChange={e => { const v = e.target.value; setProductSearch(v); setSelectedProduct(null); doSearch(v) }}
                  />
                </div>
                {products.length > 0 && !selectedProduct && (
                  <div className="border rounded-md mt-1 max-h-48 overflow-auto">
                    {products.map(p => (
                      <button
                        key={p.id}
                        className="w-full text-left px-3 py-2 hover:bg-slate-100 text-sm"
                        onClick={() => handleProductSelect(p)}
                      >
                        {p.name}
                        {p.barcode && <span className="text-muted-foreground ml-2">({p.barcode})</span>}
                      </button>
                    ))}
                  </div>
                )}
                {searching && <p className="text-xs text-muted-foreground mt-1">Търсене...</p>}
              </div>

              {selectedProduct && (
                <div className="bg-slate-50 rounded-md p-3 flex items-center gap-2">
                  <Check className="w-4 h-4 text-green-600" />
                  <span className="font-medium">{selectedProduct.name}</span>
                </div>
              )}

              <Button className="w-full" disabled={!canProceedToCount} onClick={() => setStep('count')}>
                Напред <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}

          {step === 'count' && (
            <>
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-1">
                  {selectedProduct?.name} &mdash; {storeName}
                </p>
                <p className="text-sm text-muted-foreground">Системна наличност</p>
                <p className="text-4xl font-bold mt-1">
                  {loadingStock ? '...' : systemTotal} <span className="text-lg font-normal text-muted-foreground">бр.</span>
                </p>
              </div>

              <div>
                <Label>Реална наличност (преброена)</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={actualQuantity}
                  onChange={e => setActualQuantity(e.target.value)}
                  placeholder="Въведете реална бройка"
                  className="text-lg"
                />
              </div>

              {actualQuantity !== '' && (
                <div className={`rounded-md p-4 text-center ${
                  diff === 0 ? 'bg-slate-100' :
                  diff > 0 ? 'bg-green-50' : 'bg-red-50'
                }`}>
                  <div className="flex items-center justify-center gap-2">
                    {diff === 0 ? (
                      <AlertTriangle className="w-5 h-5 text-slate-500" />
                    ) : diff > 0 ? (
                      <TrendingUp className="w-5 h-5 text-green-600" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-600" />
                    )}
                    <span className="text-lg font-bold">
                      Разлика: {diff > 0 ? '+' : ''}{diff} бр.
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {diff === 0 ? 'Няма разлика. Корекция не е нужна.' :
                     diff > 0 ? `Ще бъдат добавени ${diff} бр.` :
                     `Ще бъдат извадени ${Math.abs(diff)} бр.`}
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('select')}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Назад
                </Button>
                <Button className="flex-1" disabled={!canProceedToReason} onClick={() => setStep('reason')}>
                  Напред <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </>
          )}

          {step === 'reason' && (
            <>
              <div className="bg-slate-50 rounded-md p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {selectedProduct?.name} &mdash; {storeName}
                </p>
                <p className="text-sm">
                  Системна: <strong>{systemTotal} бр.</strong> &rarr; Реална: <strong>{actualQuantity} бр.</strong>
                </p>
                <p className={`text-lg font-bold mt-1 ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  Разлика: {diff > 0 ? '+' : ''}{diff} бр.
                </p>
              </div>

              <div>
                <Label>Причина за корекция</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="Изберете причина" />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Бележка (незадължително)</Label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Допълнителна информация..."
                  rows={2}
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('count')}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Назад
                </Button>
                <Button
                  className="flex-1"
                  disabled={!reason || saving}
                  onClick={handleSave}
                >
                  {saving ? 'Записване...' : 'Потвърди корекция'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* History */}
      {corrections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="w-5 h-5" />
              Последни корекции
              {storeName && <span className="text-muted-foreground font-normal text-sm">&mdash; {storeName}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {corrections.map(c => (
                <div key={c.id} className="px-6 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.product_name}</span>
                    <span className="text-muted-foreground text-xs">
                      {new Date(c.created_at).toLocaleDateString('bg-BG', { timeZone: 'Europe/Sofia' })}{' '}
                      {new Date(c.created_at).toLocaleTimeString('bg-BG', { timeZone: 'Europe/Sofia', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-muted-foreground">{c.old_quantity} &rarr; {c.new_quantity}</span>
                    <span className={`font-medium ${c.difference > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {c.difference > 0 ? '+' : ''}{c.difference}
                    </span>
                    <span className="text-muted-foreground">&mdash; {c.reason_label}</span>
                  </div>
                  <div className="text-muted-foreground text-xs mt-0.5">
                    {c.user_name} {c.store_name !== storeName && `• ${c.store_name}`}
                    {c.notes && <span className="ml-2 italic">{c.notes}</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
