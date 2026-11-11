'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Printer } from 'lucide-react'
import { formatMoney } from '@/lib/deliveries/format'
import { code128Bars } from '@/lib/labels/code128'
import { A4, DEFAULT_LAYOUT, SHEET_PRESETS, layoutError, paginate, perSheet, type SheetLayout } from '@/lib/labels/sheet'

export type PrintLabel = {
  key: string
  name: string
  description: string
  price: number | null
  /** Barcode, or SKU when the product has none; empty for no barcode. */
  code: string
  /** Where the line comes from, e.g. "Д-000029". */
  source: string
  count: number
}

const STORAGE_KEY = 'prody_label_sheet'
const MAX_LABELS = 2000

function loadLayout(): SheetLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const l = { ...DEFAULT_LAYOUT, ...JSON.parse(raw) } as SheetLayout
    return layoutError(l) ? DEFAULT_LAYOUT : l
  } catch {
    return DEFAULT_LAYOUT
  }
}

function saveLayout(l: SheetLayout) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(l))
  } catch {
    // Private window or blocked storage: the layout just is not remembered.
  }
}

const FIELDS: { key: keyof SheetLayout; label: string; step: number }[] = [
  { key: 'cols', label: 'Колони', step: 1 },
  { key: 'rows', label: 'Редове', step: 1 },
  { key: 'width', label: 'Ширина, мм', step: 0.1 },
  { key: 'height', label: 'Височина, мм', step: 0.1 },
  { key: 'top', label: 'Горе, мм', step: 0.1 },
  { key: 'left', label: 'Ляво, мм', step: 0.1 },
  { key: 'gapX', label: 'Между колоните, мм', step: 0.1 },
  { key: 'gapY', label: 'Между редовете, мм', step: 0.1 },
]

/**
 * The print screen of the labels: settings on the left (hidden when printing), the
 * A4 sheets at real size beside them. Prints with the browser's own dialog; the
 * sheets are drawn in mm, so it has to print at 100 % with no margins.
 */
export function LabelSheets({ labels }: { labels: PrintLabel[] }) {
  const [layout, setLayout] = useState<SheetLayout>(DEFAULT_LAYOUT)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(labels.map(l => [l.key, l.count])))
  const [start, setStart] = useState(1)
  const [outline, setOutline] = useState(false)

  // The remembered sheet is in this browser only, so it is read after hydration.
  useEffect(() => {
    const l = loadLayout()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(l)
    setDraft(Object.fromEntries(FIELDS.map(f => [f.key, String(l[f.key])])))
  }, [])

  const candidate: SheetLayout = useMemo(() => {
    const out = { ...layout }
    for (const f of FIELDS) {
      const v = draft[f.key]
      if (v !== undefined) out[f.key] = Number(String(v).replace(',', '.'))
    }
    return out
  }, [layout, draft])
  const error = layoutError(candidate)
  const sheet = error ? layout : candidate

  useEffect(() => {
    if (!error) saveLayout(candidate)
  }, [candidate, error])

  const presetId = SHEET_PRESETS.find(p => FIELDS.every(f => p.layout[f.key] === sheet[f.key]))?.id ?? ''
  function pickPreset(id: string) {
    const p = SHEET_PRESETS.find(x => x.id === id)
    if (!p) return
    setLayout(p.layout)
    setDraft(Object.fromEntries(FIELDS.map(f => [f.key, String(p.layout[f.key])])))
    setStart(1)
  }

  const list = useMemo(() => {
    const out: PrintLabel[] = []
    for (const l of labels) {
      const n = Math.max(0, Math.min(MAX_LABELS, Math.floor(counts[l.key] ?? 0)))
      for (let i = 0; i < n && out.length < MAX_LABELS; i++) out.push(l)
    }
    return out
  }, [labels, counts])
  const n = perSheet(sheet)
  const pages = paginate(list, sheet, Math.min(start, n))

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <style>{`
        @page { size: A4; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .label-sheet { box-shadow: none !important; margin: 0 !important; }
        }
        .label-sheet { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>

      <div className="flex flex-col gap-6 p-4 lg:flex-row lg:items-start print:block print:p-0">
        <aside className="w-full shrink-0 space-y-4 rounded-lg border bg-white p-4 text-sm lg:sticky lg:top-4 lg:w-80 print:hidden">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base font-semibold">Печат на етикети</h1>
            <Button onClick={() => window.print()} disabled={list.length === 0}><Printer className="mr-2 h-4 w-4" />Печат</Button>
          </div>
          <p className="text-muted-foreground">
            {list.length} {list.length === 1 ? 'етикет' : 'етикета'} на {pages.length} {pages.length === 1 ? 'лист' : 'листа'}.
            При печат избери полета „Няма“ и мащаб 100 %.
          </p>

          <div className="space-y-2">
            <div className="font-medium">Етикети</div>
            <ul className="divide-y rounded-md border">
              {labels.map(l => (
                <li key={l.key} className="flex items-center gap-2 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" title={l.name}>{l.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.source}{l.code ? ` · ${l.code}` : ' · без баркод'} · {formatMoney(l.price)}
                    </div>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={MAX_LABELS}
                    className="h-8 w-20"
                    aria-label={`Брой етикети: ${l.name}`}
                    value={counts[l.key] ?? 0}
                    onChange={e => setCounts(c => ({ ...c, [l.key]: Math.max(0, Number(e.target.value) || 0) }))}
                  />
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <label className="block font-medium" htmlFor="sheet-preset">Лист</label>
            <select id="sheet-preset" className="h-9 w-full rounded-md border border-input bg-white px-2" value={presetId} onChange={e => pickPreset(e.target.value)}>
              {!presetId && <option value="">Мой размер</option>}
              {SHEET_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              {FIELDS.map(f => (
                <label key={f.key} className="text-xs text-muted-foreground">
                  {f.label}
                  <Input
                    type="number"
                    step={f.step}
                    min={0}
                    className="mt-0.5 h-8"
                    value={draft[f.key] ?? String(layout[f.key])}
                    onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>

          <label className="block text-xs text-muted-foreground">
            Започни от етикет № (1 до {n}), ако листът е започнат
            <Input type="number" min={1} max={n} className="mt-0.5 h-8 w-24" value={start} onChange={e => setStart(Math.max(1, Math.min(n, Number(e.target.value) || 1)))} />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={outline} onChange={e => setOutline(e.target.checked)} />
            Контур на етикетите и при печат (за проба на обикновен лист)
          </label>
        </aside>

        <div className="min-w-0 flex-1 overflow-x-auto print:overflow-visible">
          {pages.length === 0 && <p className="rounded-lg border bg-white p-6 text-sm text-muted-foreground print:hidden">Няма етикети за печат: сложи брой поне на един ред.</p>}
          {pages.map((cells, pi) => (
            <div
              key={pi}
              className="label-sheet relative mx-auto mb-6 bg-white shadow print:mb-0"
              style={{ width: `${A4.width}mm`, height: `${A4.height}mm`, overflow: 'hidden', breakAfter: pi < pages.length - 1 ? 'page' : 'auto' }}
            >
              {cells.map((l, ci) => {
                const r = Math.floor(ci / sheet.cols)
                const c = ci % sheet.cols
                return (
                  <div
                    key={ci}
                    className={outline ? 'outline outline-1 outline-slate-300' : 'outline outline-1 outline-dashed outline-slate-200 print:outline-none'}
                    style={{
                      position: 'absolute',
                      left: `${sheet.left + c * (sheet.width + sheet.gapX)}mm`,
                      top: `${sheet.top + r * (sheet.height + sheet.gapY)}mm`,
                      width: `${sheet.width}mm`,
                      height: `${sheet.height}mm`,
                    }}
                  >
                    {l && <LabelFace label={l} width={sheet.width} height={sheet.height} />}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** One label: the name in bold, the description right after it, price and barcode at the bottom. */
function LabelFace({ label, width, height }: { label: PrintLabel; width: number; height: number }) {
  // Sizes follow a 70 × 37 mm label, scaled to the sheet's label.
  const k = Math.max(0.55, Math.min(1.4, Math.min(width / 70, height / 37)))
  const pad = 1.8 * k
  const barH = Math.max(5, 8 * k)
  return (
    <div className="flex h-full w-full flex-col overflow-hidden text-black" style={{ padding: `${pad}mm`, fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div className="min-h-0 flex-1 overflow-hidden" style={{ lineHeight: 1.15 }}>
        <div className="font-bold" style={{ fontSize: `${9 * k}pt`, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {label.name}
        </div>
        {label.description && (
          <div style={{ fontSize: `${6.5 * k}pt`, marginTop: `${0.4 * k}mm` }}>{label.description}</div>
        )}
      </div>
      <div className="flex items-end justify-between gap-[1mm]" style={{ marginTop: `${0.8 * k}mm` }}>
        <div className="whitespace-nowrap font-bold" style={{ fontSize: `${11 * k}pt`, lineHeight: 1 }}>{formatMoney(label.price)}</div>
        {label.code && <Barcode code={label.code} height={barH} maxWidth={width - 2 * pad - 18 * k} k={k} />}
      </div>
    </div>
  )
}

function Barcode({ code, height, maxWidth, k }: { code: string; height: number; maxWidth: number; k: number }) {
  const bars = code128Bars(code)
  if (!bars) return <div style={{ fontSize: `${7 * k}pt` }}>{code}</div>
  const quiet = 6
  const total = bars.total + quiet * 2
  // About 0.33 mm a module reads well on any scanner; narrower only when the label is small.
  const width = Math.min(maxWidth, total * 0.33)
  return (
    <div className="flex flex-col items-center" style={{ width: `${width}mm` }}>
      <svg viewBox={`0 0 ${total} 10`} preserveAspectRatio="none" style={{ width: `${width}mm`, height: `${height}mm`, display: 'block' }} shapeRendering="crispEdges" aria-label={code}>
        {bars.bars.map(([x, w], i) => <rect key={i} x={x + quiet} y={0} width={w} height={10} fill="#000" />)}
      </svg>
      <div style={{ fontSize: `${6 * k}pt`, lineHeight: 1.1, letterSpacing: '0.04em', marginTop: `${0.4 * k}mm` }}>{code}</div>
    </div>
  )
}
