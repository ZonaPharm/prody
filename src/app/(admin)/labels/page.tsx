'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const SIZE_PRESETS = {
  '5x3': { w: 5, h: 3, label: '5x3 cm' },
  '7x4': { w: 7, h: 4, label: '7x4 cm' },
  '10x5': { w: 10, h: 5, label: '10x5 cm' },
} as const

type LabelSize = keyof typeof SIZE_PRESETS

export default function LabelsPage() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [size, setSize] = useState<LabelSize>('5x3')
  const [preview, setPreview] = useState(false)

  const dims = SIZE_PRESETS[size]

  function printLabel() {
    const win = window.open('', '_blank', 'width=400,height=300')
    if (!win) return
    win.document.write(`
      <html><head><style>
        @page { size: ${dims.w}cm ${dims.h}cm; margin: 0.3cm; }
        body { font-family: Arial, sans-serif; width: ${dims.w}cm; height: ${dims.h}cm; overflow: hidden; }
        .title { font-size: 16px; font-weight: bold; }
        .desc { font-size: 11px; margin-top: 4px; white-space: pre-wrap; }
      </style></head><body>
        <div class="title">${title.replace(/</g, '&lt;')}</div>
        <div class="desc">${description.replace(/</g, '&lt;')}</div>
      </body></html>
    `)
    win.document.close()
    setTimeout(() => win.print(), 300)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Генериране на етикети</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="label-title">Заглавие</Label>
            <Input
              id="label-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Име на продукта"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label-desc">Описание</Label>
            <Textarea
              id="label-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Цена, баркод, категория..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Размер</Label>
            <div className="flex gap-2">
              {(Object.keys(SIZE_PRESETS) as LabelSize[]).map(s => (
                <Button
                  key={s}
                  variant={size === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSize(s)}
                >
                  {SIZE_PRESETS[s].label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={() => setPreview(!preview)} variant="outline">
              {preview ? 'Скрий' : 'Преглед'}
            </Button>
            <Button onClick={printLabel} disabled={!title}>
              Печат
            </Button>
          </div>
        </div>

        {preview && (
          <Card>
            <CardHeader><CardTitle>Преглед</CardTitle></CardHeader>
            <CardContent>
              <div
                style={{
                  width: `${dims.w * 40}px`,
                  height: `${dims.h * 40}px`,
                  border: '1px dashed #ccc',
                  padding: '12px',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {title || 'Заглавие'}
                </div>
                <div style={{ fontSize: 10, marginTop: 4, whiteSpace: 'pre-wrap' }}>
                  {description || 'Описание...'}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
