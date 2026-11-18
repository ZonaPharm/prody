'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PackagePlus } from 'lucide-react'
import ProductForm from '@/components/products/product-form'
import type { DeliveryProduct } from '@/lib/deliveries/products'

type Option = { id: string; name: string }

/**
 * "Нов продукт" without leaving the delivery: the same form as Каталог → Нов
 * продукт (all fields, photos, label, website), so nothing has to be filled in
 * twice. Once saved, the product becomes the delivery's next line; its stock
 * comes with the delivery, so the form has no stock field.
 */
export function NewProductDialog({
  categories,
  suppliers,
  supplierId,
  onCreated,
  disabled,
}: {
  categories: Option[]
  suppliers: (Option & { is_active?: boolean | null })[]
  /** The delivery's supplier, to start the product's supplier with. */
  supplierId: string | null
  /** quantity: the "Наличност (бр.)" typed in the form, for the line. */
  onCreated: (p: DeliveryProduct, quantity: number | null) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  // A new form every time the window opens, so nothing is left from the last product.
  const [formKey, setFormKey] = useState(0)
  const [error, setError] = useState('')

  async function saved(productId: string, quantity: number | null) {
    setError('')
    try {
      const res = await fetch(`/api/deliveries/products/${productId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Продуктът е създаден, но не се добави')
      onCreated(data, quantity)
      setOpen(false)
    } catch (err: any) {
      // The product is saved: say so and how to add it, rather than lose it.
      setError(`${err.message}. Потърсете го по име в реда и го изберете.`)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => { setError(''); setFormKey(k => k + 1); setOpen(true) }}
        disabled={disabled}
      >
        <PackagePlus className="mr-2 h-4 w-4" />Нов продукт
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-testid="delivery-new-product"
          className="h-[100dvh] max-h-[100dvh] max-w-none gap-3 p-4 sm:h-auto sm:max-h-[92dvh] sm:max-w-3xl sm:p-6"
          // A long form: a click beside the window must not throw away what was typed.
          onInteractOutside={e => e.preventDefault()}
        >
          <DialogHeader className="pr-6 text-left">
            <DialogTitle>Нов продукт</DialogTitle>
            <DialogDescription>
              Попълнете го както в „Каталог“. Наличността идва с доставката.
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-4 -mb-4 min-h-0 overflow-y-auto px-4 sm:-mx-6 sm:-mb-6 sm:px-6">
            {error ? (
              // Saved but not added: no form to save it a second time.
              <div className="space-y-4 pb-6">
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Затвори</Button>
              </div>
            ) : <ProductForm
              key={formKey}
              categories={categories}
              suppliers={suppliers}
              inDelivery={{
                defaultSupplierId: supplierId ?? undefined,
                onSaved: saved,
                onCancel: () => setOpen(false),
              }}
            />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
