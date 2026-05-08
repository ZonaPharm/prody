'use client'

import { useState, useRef, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { STATUS_LABELS } from '@/lib/constants'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RestockForm } from '@/components/inventory/restock-form'
import { Loader2, Upload, Star } from 'lucide-react'

type CategoryOption = { id: string; name: string }

interface ProductFormProps {
  initialData?: {
    id?: string
    name?: string
    description?: string | null
    price?: number | null
    cost_price?: number | null
    sku?: string | null
    barcode?: string | null
    category_id?: string | null
    source?: string | null
    source_url?: string | null
    source_order_date?: string | null
    status?: string
    quantity_on_hand?: number
    min_quantity?: number
    images?: { id: string; url: string; is_primary: boolean; sort_order: number }[]
    label?: { title: string; content: string } | null
  }
  categories: CategoryOption[]
}

export default function ProductForm({ initialData, categories }: ProductFormProps) {
  const router = useRouter()

  const [name, setName] = useState(initialData?.name || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [price, setPrice] = useState(initialData?.price?.toString() || '')
  const [costPrice, setCostPrice] = useState(initialData?.cost_price?.toString() || '')
  const [categoryId, setCategoryId] = useState(initialData?.category_id || '__none__')
  const [source, setSource] = useState(initialData?.source || '')
  const [sourceUrl, setSourceUrl] = useState(initialData?.source_url || '')
  const [sourceOrderDate, setSourceOrderDate] = useState(
    initialData?.source_order_date
      ? initialData.source_order_date.split('T')[0]
      : ''
  )
  const [status, setStatus] = useState(initialData?.status || 'active')
  const [quantityOnHand, setQuantityOnHand] = useState(
    initialData?.quantity_on_hand?.toString() || '0'
  )
  const [minQuantity, setMinQuantity] = useState(
    initialData?.min_quantity?.toString() || '5'
  )

  const [files, setFiles] = useState<File[]>([])
  const [existingImages, setExistingImages] = useState<
    { id: string; url: string; is_primary: boolean; sort_order: number }[]
  >(initialData?.images || [])
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([])

  const [labelTitle, setLabelTitle] = useState(initialData?.label?.title || '')
  const [labelContent, setLabelContent] = useState(initialData?.label?.content || '')

  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [restockProductId, setRestockProductId] = useState<string | null>(null)
  const [restockProductName, setRestockProductName] = useState('')
  const [restockQty, setRestockQty] = useState(0)
  const [restockCost, setRestockCost] = useState(0)
  const [restockStores, setRestockStores] = useState<any[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [rewriteLoading, setRewriteLoading] = useState(false)

  const handleAiRewrite = async () => {
    if (!description.trim()) return
    setRewriteLoading(true)
    try {
      const res = await fetch('/api/ai/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setSubmitError(data.error || 'AI грешка'); return }
      if (data.description) setDescription(data.description)
    } catch {
      setSubmitError('Грешка при свързване с AI')
    } finally {
      setRewriteLoading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files
    if (!selected) return
    const newFiles = Array.from(selected)
    setFiles((prev) => [...prev, ...newFiles])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const removeExistingImage = (id: string) => {
    setExistingImages((prev) => prev.filter((img) => img.id !== id))
    setRemovedImageIds((prev) => [...prev, id])
  }

  const setPrimaryExistingImage = (id: string) => {
    setExistingImages((prev) =>
      prev.map((img) => ({ ...img, is_primary: img.id === id }))
    )
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitLoading(true)
    setSubmitError('')

    const supabase = createClient()
    try {
      const payload: Record<string, any> = {
        name: name.trim(),
        description: description.trim() || null,
        price: price ? parseFloat(price) : null,
        cost_price: costPrice ? parseFloat(costPrice) : null,
        category_id: categoryId === '__none__' ? null : (categoryId || null),
        source: source.trim() || null,
        source_url: sourceUrl.trim() || null,
        source_order_date: sourceOrderDate || null,
        status,
        min_quantity: minQuantity ? parseInt(minQuantity, 10) : 5,
      }

      // Only set quantity_on_hand for new products; edits go through inventory system
      if (!isEdit) {
        payload.quantity_on_hand = quantityOnHand ? parseInt(quantityOnHand, 10) : 0
      }

      let productId: string

      if (initialData?.id) {
        const { error } = await (supabase
          .from('products') as any)
          .update(payload)
          .eq('id', initialData.id)

        if (error) throw error
        productId = initialData.id
      } else {
        const { data, error } = await (supabase
          .from('products') as any)
          .insert(payload)
          .select('id')
          .single()

        if (error) throw error
        productId = data.id
      }

      // Delete removed images from storage and DB
      for (const imgId of removedImageIds) {
        const img = initialData?.images?.find(i => i.id === imgId)
        if (img) {
          const urlPath = img.url.split('/').slice(-2).join('/')
          await supabase.storage.from('products').remove([urlPath])
          await (supabase.from('product_images') as any).delete().eq('id', imgId)
        }
      }

      // Upload new images
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const ext = file.name.split('.').pop() || 'jpg'
          const path = `${productId}/${i + 1}.${ext}`

          const { error: uploadError } = await supabase.storage
            .from('products')
            .upload(path, file, { upsert: true })

          if (uploadError) {
            // Clean up: delete the product if it was just created and image upload fails
            if (!initialData?.id) {
              await supabase.from('products').delete().eq('id', productId)
            }
            throw uploadError
          }

          const { data: urlData } = supabase.storage.from('products').getPublicUrl(path)

          const { error: insertError } = await supabase
            .from('product_images')
            .insert({
              product_id: productId,
              url: urlData.publicUrl,
              is_primary: existingImages.length === 0 && i === 0,
              sort_order: existingImages.length + i,
            } as any)

          if (insertError) {
            // Clean up: remove uploaded file and product if newly created
            await supabase.storage.from('products').remove([path])
            if (!initialData?.id) {
              await supabase.from('products').delete().eq('id', productId)
            }
            throw insertError
          }
        }
      }

      // Sync primary image changes among existing images
      const existingPrimaryChanged = existingImages.find(img => img.is_primary)
      if (existingPrimaryChanged) {
        const prevPrimary = initialData?.images?.find(img => img.is_primary)
        if (prevPrimary && prevPrimary.id !== existingPrimaryChanged.id) {
          await (supabase.from('product_images') as any).update({ is_primary: false }).eq('id', prevPrimary.id)
        }
        if (!prevPrimary || prevPrimary.id !== existingPrimaryChanged.id) {
          await (supabase.from('product_images') as any).update({ is_primary: true }).eq('id', existingPrimaryChanged.id)
        }
      }

      // Move fetched images to product folder
      for (const img of existingImages) {
        if (img.id.startsWith('fetched/')) {
          try {
            const res = await fetch(img.url)
            const blob = await res.blob()
            const ext = img.id.split('.').pop() || 'jpg'
            const newPath = `${productId}/${img.sort_order}.${ext}`
            await supabase.storage.from('products').upload(newPath, blob)
            const { data: newUrlData } = supabase.storage.from('products').getPublicUrl(newPath)
            await (supabase.from('product_images') as any).update({ url: newUrlData.publicUrl }).eq('id', img.id)
            await supabase.storage.from('products').remove([img.id])
          } catch { /* skip failed moves */ }
        }
      }

      // Upsert label
      if (labelTitle.trim() || labelContent.trim()) {
        const { data: existingLabel } = await (supabase
          .from('labels') as any)
          .select('id')
          .eq('product_id', productId)
          .maybeSingle()

        if (existingLabel) {
          await (supabase.from('labels') as any).update({
            title: labelTitle.trim(),
            content: labelContent.trim(),
          }).eq('id', existingLabel.id)
        } else {
          await (supabase.from('labels') as any).insert({
            product_id: productId,
            title: labelTitle.trim(),
            content: labelContent.trim(),
          })
        }
      }

      // If new product with quantity, show RestockForm modal inline
      if (!isEdit && parseInt(quantityOnHand, 10) > 0) {
        const { data: storeList } = await (supabase.from('stores') as any).select('id, name, is_warehouse').eq('is_active', true).order('name')
        setRestockProductId(productId)
        setRestockProductName(name.trim())
        setRestockQty(parseInt(quantityOnHand, 10))
        setRestockCost(costPrice ? parseFloat(costPrice) : 0)
        setRestockStores(storeList || [])
      } else {
        router.push('/catalog')
        router.refresh()
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Грешка при запазване')
    } finally {
      setSubmitLoading(false)
    }
  }

  const isEdit = Boolean(initialData?.id)

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-6">
      {submitError && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-700">{submitError}</p>
        </div>
      )}

      <Tabs defaultValue="info" className="w-full">
        <TabsList>
          <TabsTrigger value="info">Информация</TabsTrigger>
          <TabsTrigger value="label">Етикет</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-6 pt-4">

      {/* Row 1: Name — full width */}
      <div className="space-y-2">
        <Label htmlFor="name">Име *</Label>
        <Input id="name" required value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Име на продукта" />
      </div>

      {/* Row 2: Price, Cost, Category — 3 columns */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="price">Цена *</Label>
          <Input id="price" type="number" step="0.01" min="0" required
            value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cost_price">Доставна цена</Label>
          <Input id="cost_price" type="number" step="0.01" min="0"
            value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0.00" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="category_id">Категория</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="category_id"><SelectValue placeholder="Избери категория" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Без категория</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 3: SKU, Barcode, Status, Quantity, Min Qty */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="space-y-2">
          <Label htmlFor="status">Статус</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="quantity">Наличност (бр.)</Label>
          {isEdit ? (
            <>
              <Input id="quantity" type="number" min="0" value={quantityOnHand} disabled
                className="bg-slate-50 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">
                Количествата се управляват през{' '}
                <a href={`/catalog/${initialData?.id}`} className="text-blue-600 hover:underline">складова наличност</a>
              </p>
            </>
          ) : (
            <Input id="quantity" type="number" min="0" value={quantityOnHand}
              onChange={(e) => setQuantityOnHand(e.target.value)} placeholder="0" />
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="min_quantity">Мин. количество</Label>
          <Input id="min_quantity" type="number" min="0" value={minQuantity}
            onChange={(e) => setMinQuantity(e.target.value)} placeholder="5" />
          <p className="text-[10px] text-muted-foreground">Предупреждение при падане под този брой</p>
        </div>
      </div>

      {/* Row 4: Source, Source URL — 2 cols */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="source">Източник</Label>
          <Input id="source" value={source}
            onChange={(e) => setSource(e.target.value)} placeholder="Име на доставчик" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="source_url">URL на източник</Label>
          <Input id="source_url" type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://..." />
        </div>
      </div>

      {/* Row 4b: Date + Source order date */}
      <div className="space-y-2">
        <Label htmlFor="source_order_date">Дата на поръчка</Label>
        <Input id="source_order_date" type="date" value={sourceOrderDate}
          onChange={(e) => setSourceOrderDate(e.target.value)} />
      </div>

      {/* Row 5: Description + AI button */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="description">Описание</Label>
          <Button type="button" variant="outline" size="sm"
            onClick={handleAiRewrite}
            disabled={rewriteLoading || !description.trim()}>
            {rewriteLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Пренапиши с AI
          </Button>
        </div>
        <Textarea id="description" rows={4} value={description}
          onChange={(e) => setDescription(e.target.value)} placeholder="Описание на продукта" />
      </div>

        </TabsContent>

        <TabsContent value="label" className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">Не е задължително. Етикетът се показва в детайлите на продукта и може да се принтира.</p>
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label htmlFor="label_title">Заглавие</Label>
              <Input id="label_title" value={labelTitle} onChange={(e) => setLabelTitle(e.target.value)} placeholder="Заглавие на етикета" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="label_content">Текст</Label>
              <Textarea id="label_content" rows={6} value={labelContent} onChange={(e) => setLabelContent(e.target.value)} placeholder="Текст на етикета" />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Row 7: Images */}
      {existingImages.length > 0 && (
        <div className="space-y-2">
          <Label>Текущи снимки</Label>
          <div className="flex flex-wrap gap-3">
            {existingImages.map((img) => (
              <div key={img.id} className="relative group">
                <img src={img.url} alt="" className="h-24 w-24 object-cover rounded-md border" />
                <button type="button" onClick={() => setPrimaryExistingImage(img.id)}
                  className={`absolute top-1 left-1 rounded-full w-5 h-5 text-xs flex items-center justify-center transition-opacity ${img.is_primary ? 'bg-yellow-400 text-white opacity-100' : 'bg-white/80 text-slate-500 opacity-0 group-hover:opacity-100'}`}
                  title="Задай като основна">
                  <Star className="h-3 w-3" />
                </button>
                <button type="button" onClick={() => removeExistingImage(img.id)}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">x</button>
                {img.is_primary && (
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5 rounded-b-md">Основна</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>Снимки</Label>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Избери файлове
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={handleFileChange} />
          <span className="text-sm text-muted-foreground">
            {files.length > 0
              ? `${files.length} избран${files.length === 1 ? '' : 'и'} файл${files.length === 1 ? '' : 'а'}`
              : 'Няма избрани файлове'}
          </span>
        </div>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-3">
            {files.map((file, i) => (
              <div key={`${file.name}-${i}`} className="relative group">
                <img src={URL.createObjectURL(file)} alt={file.name} className="h-24 w-24 object-cover rounded-md border" />
                <button type="button" onClick={() => removeFile(i)}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">x</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-4 border-t">
        <Button type="submit" disabled={submitLoading}>
          {submitLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {submitLoading ? 'Запазва...' : isEdit ? 'Запази промените' : 'Добави продукт'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push('/catalog')}>Отказ</Button>
      </div>
    </form>

      {restockProductId && (
        <RestockForm
          productId={restockProductId}
          productName={restockProductName}
          stores={restockStores}
          autoOpen={true}
          initialQty={restockQty}
          initialCost={restockCost}
          onSuccess={() => {
            setRestockProductId(null)
            router.push('/catalog')
          }}
        />
      )}
    </>
  )
}
