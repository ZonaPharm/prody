'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CircleHelp, FileDown, Printer, Save, Trash2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CALIBRATION_STEPS, SHEET_HELP, type HelpKey } from '@/lib/labels/sheet-help'
import { formatMoney } from '@/lib/deliveries/format'
import { Barcode } from '@/components/labels/barcode'
import type { SheetProfile } from '@/lib/labels/profiles'
import { A4, DEFAULT_LAYOUT, DEFAULT_PRESET, LINE_HEIGHT, SHEET_PRESETS, correctSpread, labelMetrics, layoutError, paginate, perSheet, type SheetLayout } from '@/lib/labels/sheet'

export type PrintLabel = {
  key: string
  name: string
  description: string
  price: number | null
  /** Factory barcode, else the internal code (else SKU); empty for no barcode. */
  code: string
  /** Where the line comes from, e.g. "Д-000029". */
  source: string
  count: number
}

const STORAGE_KEY = 'prody_label_sheet_v2'
const MAX_LABELS = 2000

/** What this browser remembers: the chosen sheet and its numbers as last used. */
type Remembered = { selected: string; layout: SheetLayout }

const presetKey = (id: string) => `preset:${id}`
const profileKey = (id: string) => `profile:${id}`
const DEFAULT_SELECTED = presetKey(DEFAULT_PRESET.id)

function loadRemembered(): Remembered | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as Remembered
    const selected = String(r.selected ?? '')
    // A built-in sheet comes back with its numbers as they are in the code now (they can
    // be corrected, like 65 a sheet on 27.11.2026); only this computer's offsets are kept.
    // Other numbers of one's own belong in a saved profile.
    const preset = SHEET_PRESETS.find(p => presetKey(p.id) === selected)
    const layout = preset
      ? { ...preset.layout, offsetX: Number(r.layout?.offsetX) || 0, offsetY: Number(r.layout?.offsetY) || 0 }
      : { ...DEFAULT_LAYOUT, ...r.layout }
    return layoutError(layout) ? null : { selected, layout }
  } catch {
    return null
  }
}

function remember(r: Remembered) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(r))
  } catch {
    // Private window or blocked storage: the choice just is not remembered.
  }
}

type Field = { key: keyof SheetLayout & HelpKey; label: string; step: number; min: number }

const FIELDS: Field[] = [
  { key: 'cols', label: 'Колони', step: 1, min: 1 },
  { key: 'rows', label: 'Редове', step: 1, min: 1 },
  { key: 'width', label: 'Ширина, мм', step: 0.1, min: 0 },
  { key: 'height', label: 'Височина, мм', step: 0.1, min: 0 },
  { key: 'top', label: 'Горе, мм', step: 0.1, min: 0 },
  { key: 'left', label: 'Ляво, мм', step: 0.1, min: 0 },
  { key: 'gapX', label: 'Между колоните, мм', step: 0.1, min: 0 },
  { key: 'gapY', label: 'Между редовете, мм', step: 0.1, min: 0 },
]
const OFFSET_FIELDS: Field[] = [
  { key: 'offsetX', label: 'Надясно, мм', step: 0.1, min: -20 },
  { key: 'offsetY', label: 'Надолу, мм', step: 0.1, min: -20 },
]
const ALL_FIELDS = [...FIELDS, ...OFFSET_FIELDS]

const draftOf = (l: SheetLayout) => Object.fromEntries(ALL_FIELDS.map(f => [f.key, String(l[f.key] ?? 0)]))
const sameLayout = (a: SheetLayout, b: SheetLayout) => ALL_FIELDS.every(f => Math.abs((a[f.key] ?? 0) - (b[f.key] ?? 0)) < 0.005)

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Не стана, опитай пак')
  return data as T
}

/**
 * The print screen of the labels: settings on the left (hidden when printing), the
 * A4 sheets at real size beside them. Prints with the browser's own dialog; the
 * sheets are drawn in mm, so it has to print at 100 % with no margins.
 * Sheets: the built-in Office1 ones, then the profiles people saved (shared by all
 * computers), e.g. the same paper moved a millimetre for one printer.
 */
export function LabelSheets({ labels, initialProfiles, profilesReady }: {
  labels: PrintLabel[]
  initialProfiles: SheetProfile[]
  /** False until the profiles table exists (migration not run yet). */
  profilesReady: boolean
}) {
  const [profiles, setProfiles] = useState<SheetProfile[]>(initialProfiles)
  const [selected, setSelected] = useState(DEFAULT_SELECTED)
  const [layout, setLayout] = useState<SheetLayout>(DEFAULT_LAYOUT)
  const [draft, setDraft] = useState<Record<string, string>>(() => draftOf(DEFAULT_LAYOUT))
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(labels.map(l => [l.key, l.count])))
  const [start, setStart] = useState(1)
  const [outline, setOutline] = useState(false)
  /** A test sheet: every cell numbered and marked, no products. */
  const [testSheet, setTestSheet] = useState(false)
  /** How far the outer columns / rows print off, mm (outward +, inward −). */
  const [spread, setSpread] = useState({ x: '', y: '' })
  const [pdfHint, setPdfHint] = useState(false)
  const [newName, setNewName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  // The remembered sheet is in this browser only, so it is read after hydration.
  useEffect(() => {
    const r = loadRemembered()
    if (!r) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelected(r.selected)
    setLayout(r.layout)
    setDraft(draftOf(r.layout))
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  const candidate: SheetLayout = useMemo(() => {
    const out = { ...layout }
    for (const f of ALL_FIELDS) {
      const v = draft[f.key]
      if (v !== undefined && v.trim() !== '' && v.trim() !== '-') out[f.key] = Number(String(v).replace(',', '.'))
    }
    return out
  }, [layout, draft])
  const error = layoutError(candidate)
  const sheet = error ? layout : candidate

  useEffect(() => {
    if (!error) remember({ selected, layout: candidate })
  }, [candidate, error, selected])

  const preset = SHEET_PRESETS.find(p => presetKey(p.id) === selected)
  const profile = profiles.find(p => profileKey(p.id) === selected)
  const source = preset?.layout ?? profile?.layout ?? null
  const changed = !source || !sameLayout(source, sheet)

  function choose(key: string) {
    const l = SHEET_PRESETS.find(p => presetKey(p.id) === key)?.layout ?? profiles.find(p => profileKey(p.id) === key)?.layout
    if (!l) return
    setSelected(key)
    setLayout(l)
    setDraft(draftOf(l))
    setStart(1)
    setMessage(null)
    setNewName(null)
  }

  async function run(work: () => Promise<string>) {
    setBusy(true)
    setMessage(null)
    try {
      setMessage({ ok: true, text: await work() })
    } catch (e: any) {
      setMessage({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const saveNew = () => run(async () => {
    const p = await send<SheetProfile>('/api/label-profiles', 'POST', { name: newName ?? '', layout: sheet })
    setProfiles(list => [...list, p].sort((a, b) => a.name.localeCompare(b.name, 'bg')))
    setSelected(profileKey(p.id))
    setLayout(p.layout)
    setDraft(draftOf(p.layout))
    setNewName(null)
    return `Профилът „${p.name}“ е запазен за всички компютри.`
  })

  const saveChanges = () => run(async () => {
    if (!profile) return ''
    const p = await send<SheetProfile>(`/api/label-profiles/${profile.id}`, 'PATCH', { layout: sheet })
    setProfiles(list => list.map(x => (x.id === p.id ? p : x)))
    setLayout(p.layout)
    setDraft(draftOf(p.layout))
    return `Промените в „${p.name}“ са запазени.`
  })

  const remove = () => {
    if (!profile || !window.confirm(`Да изтрия ли профила „${profile.name}“?`)) return
    run(async () => {
      await send(`/api/label-profiles/${profile.id}`, 'DELETE')
      setProfiles(list => list.filter(x => x.id !== profile.id))
      choose(DEFAULT_SELECTED)
      return `Профилът „${profile.name}“ е изтрит.`
    })
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
  const pages: (PrintLabel | null)[][] = testSheet ? [Array<null>(n).fill(null)] : paginate(list, sheet, Math.min(start, n))
  const canPrint = testSheet || list.length > 0

  const num = (v: string) => {
    const t = v.trim().replace(',', '.')
    return t === '' || t === '-' ? 0 : Number(t)
  }
  const spreadFix = correctSpread(sheet, num(spread.x), num(spread.y))
  const spreadNone = num(spread.x) === 0 && num(spread.y) === 0
  const spreadError = spreadNone ? null : layoutError(spreadFix)
  function applySpread() {
    if (spreadNone || spreadError) return
    setDraft(draftOf(spreadFix))
    setSpread({ x: '', y: '' })
    setMessage({ ok: true, text: 'Разстоянията са поправени. Пусни пробен лист и, ако е добре, запази като профил.' })
  }

  const input = (f: Field) => (
    <div key={f.key} className="text-xs text-muted-foreground">
      <FieldLabel htmlFor={`sheet-${f.key}`} help={f.key}>{f.label}</FieldLabel>
      <Input
        id={`sheet-${f.key}`}
        type="number"
        step={f.step}
        min={f.min}
        className="mt-0.5 h-8"
        value={draft[f.key] ?? String(layout[f.key] ?? 0)}
        onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
      />
    </div>
  )

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
          <h1 className="text-base font-semibold">Печат на етикети</h1>
          <p className="text-muted-foreground">
            {testSheet
              ? `Пробен лист: ${n} номерирани рамки с кръстче в средата.`
              : `${list.length} ${list.length === 1 ? 'етикет' : 'етикета'} на ${pages.length} ${pages.length === 1 ? 'лист' : 'листа'}.`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => { setPdfHint(false); window.print() }} disabled={!canPrint}><Printer className="mr-2 h-4 w-4" />Печат</Button>
            <Button variant="outline" onClick={() => { setPdfHint(true); window.print() }} disabled={!canPrint}><FileDown className="mr-2 h-4 w-4" />PDF</Button>
          </div>
          <p className={pdfHint ? 'rounded-md bg-amber-50 p-2 text-amber-900' : 'text-muted-foreground'}>
            {pdfHint
              ? 'В прозореца за печат избери принтер „Запази като PDF“ (Save as PDF), полета „Няма“ и мащаб 100 %. PDF-а печатай с „Действителен размер“, не „Побери“.'
              : 'В прозореца за печат избери полета „Няма“ и мащаб 100 % (не „Побери в страницата“). За PDF файл избери „Запази като PDF“.'}
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
            <details className="rounded-md border bg-slate-50 p-2 text-xs">
              <summary className="cursor-pointer font-medium">Как да нагласиш печата, ако бяга</summary>
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
                {CALIBRATION_STEPS.map(s => <li key={s}>{s}</li>)}
              </ol>
              <p className="mt-1 text-muted-foreground">Натисни <CircleHelp className="inline h-3.5 w-3.5" aria-hidden /> до всяка настройка за обяснение и пример.</p>
            </details>
            <FieldLabel htmlFor="sheet-profile" help="profile" className="font-medium text-foreground">Лист (профил на хартията)</FieldLabel>
            <select id="sheet-profile" className="h-9 w-full rounded-md border border-input bg-white px-2" value={source ? selected : ''} onChange={e => choose(e.target.value)}>
              {!source && <option value="">Мой размер</option>}
              <optgroup label="Office1">
                {SHEET_PRESETS.map(p => <option key={p.id} value={presetKey(p.id)}>{p.name}</option>)}
              </optgroup>
              {profiles.length > 0 && (
                <optgroup label="Запазени профили">
                  {profiles.map(p => <option key={p.id} value={profileKey(p.id)}>{p.name}</option>)}
                </optgroup>
              )}
            </select>
            {source && changed && <p className="text-xs text-amber-700">Числата са променени спрямо профила.</p>}
            <div className="grid grid-cols-2 gap-2">{FIELDS.map(input)}</div>

            <div className="pt-1 font-medium">Отместване на целия печат</div>
            <p className="text-xs text-muted-foreground">
              Ако принтерът печата разместено: плюс мести всичко надясно или надолу, минус наляво или нагоре.
            </p>
            <div className="grid grid-cols-2 gap-2">{OFFSET_FIELDS.map(input)}</div>

            <div className="pt-1 font-medium">Средата е на място, краищата бягат</div>
            <p className="text-xs text-muted-foreground">
              Ако средната колона е в етикета, а левите бягат наляво и десните надясно, напиши с колко мм бягат крайните (навътре: с минус) и натисни „Поправи“.
              Средата остава, а разстоянието между етикетите се сменя.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-xs text-muted-foreground">
                <FieldLabel htmlFor="sheet-spreadX" help="spreadX">Крайни колони навън, мм</FieldLabel>
                <Input id="sheet-spreadX" type="number" step={0.1} className="mt-0.5 h-8" placeholder="0" value={spread.x} disabled={sheet.cols < 2} onChange={e => setSpread(s => ({ ...s, x: e.target.value }))} />
              </div>
              <div className="text-xs text-muted-foreground">
                <FieldLabel htmlFor="sheet-spreadY" help="spreadY">Горен и долен ред навън, мм</FieldLabel>
                <Input id="sheet-spreadY" type="number" step={0.1} className="mt-0.5 h-8" placeholder="0" value={spread.y} disabled={sheet.rows < 2} onChange={e => setSpread(s => ({ ...s, y: e.target.value }))} />
              </div>
            </div>
            <Button size="sm" variant="outline" disabled={spreadNone || !!spreadError || !!error} onClick={applySpread}>Поправи</Button>
            {spreadError && <p className="text-xs text-red-600">{spreadError}</p>}
            {error && <p className="text-xs text-red-600">{error}</p>}

            {profilesReady ? (
              <div className="space-y-2 pt-1">
                {newName === null ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy || !!error} onClick={() => setNewName(profile ? `${profile.name} (2)` : preset ? `${preset.name.split(' (')[0]}, ` : '')}>
                      <Save className="mr-1 h-4 w-4" />Запази като нов профил
                    </Button>
                    {profile && changed && (
                      <Button size="sm" disabled={busy || !!error} onClick={saveChanges}>Запази промените</Button>
                    )}
                    {profile && (
                      <Button size="sm" variant="ghost" className="text-red-600" disabled={busy} onClick={remove}><Trash2 className="mr-1 h-4 w-4" />Изтрий</Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 rounded-md border p-2">
                    <label className="block text-xs text-muted-foreground">
                      Име на профила, например „24 на лист, принтер Офис“
                      <Input autoFocus className="mt-0.5 h-8" maxLength={60} value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveNew() }} />
                    </label>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy || !newName.trim() || !!error} onClick={saveNew}>Запази</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setNewName(null)}>Откажи</Button>
                    </div>
                  </div>
                )}
                {message && <p className={message.ok ? 'text-xs text-emerald-700' : 'text-xs text-red-600'}>{message.text}</p>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Запазването на профили ще стане достъпно след обновяване на базата. Дотогава числата се помнят само на този компютър.</p>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-md border border-dashed p-2 text-xs">
            <input id="sheet-test" type="checkbox" className="mt-0.5" checked={testSheet} onChange={e => setTestSheet(e.target.checked)} />
            <label htmlFor="sheet-test" className="flex-1">
              <span className="font-medium">Пробен лист</span>: само рамки, номера и кръстче в средата на всеки етикет, без продукти.
              Печата се на обикновен лист и се слага върху листа с етикети срещу светлото, за да се види накъде бяга.
            </label>
            <HelpButton help="testSheet" />
          </div>
          <div className="text-xs text-muted-foreground">
            <FieldLabel htmlFor="sheet-start" help="start">Започни от етикет № (1 до {n}), ако листът е започнат</FieldLabel>
            <Input id="sheet-start" type="number" min={1} max={n} className="mt-0.5 h-8 w-24" value={start} onChange={e => setStart(Math.max(1, Math.min(n, Number(e.target.value) || 1)))} />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <input id="sheet-outline" type="checkbox" checked={outline} onChange={e => setOutline(e.target.checked)} />
            <label htmlFor="sheet-outline" className="flex-1">Контур на етикетите и при печат (за проба на обикновен лист)</label>
            <HelpButton help="outline" />
          </div>
        </aside>

        <div className="min-w-0 flex-1 overflow-x-auto print:overflow-visible">
          {pages.length === 0 && !testSheet && <p className="rounded-lg border bg-white p-6 text-sm text-muted-foreground print:hidden">Няма етикети за печат: сложи брой поне на един ред.</p>}
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
                    className={testSheet ? 'outline outline-1 outline-black' : outline ? 'outline outline-1 outline-slate-300' : 'outline outline-1 outline-dashed outline-slate-200 print:outline-none'}
                    style={{
                      position: 'absolute',
                      left: `${sheet.left + (sheet.offsetX ?? 0) + c * (sheet.width + sheet.gapX)}mm`,
                      top: `${sheet.top + (sheet.offsetY ?? 0) + r * (sheet.height + sheet.gapY)}mm`,
                      width: `${sheet.width}mm`,
                      height: `${sheet.height}mm`,
                    }}
                  >
                    {testSheet ? <TestFace n={ci + 1} /> : l && <LabelFace label={l} width={sheet.width} height={sheet.height} />}
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

/** A "?" that opens what a setting does and an example. Opens on tap, so it works on a phone too. */
function HelpButton({ help }: { help: HelpKey }) {
  const h = SHEET_HELP[help]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label={`Какво е „${h.title}“`}>
          <CircleHelp className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-80 max-w-[calc(100vw-2rem)] space-y-2 text-sm">
        <div className="font-semibold">{h.title}</div>
        <p>{h.text}</p>
        <p className="rounded-md bg-slate-50 p-2 text-slate-700"><span className="font-medium">Пример: </span>{h.example}</p>
      </PopoverContent>
    </Popover>
  )
}

/** A field's label with its "?" beside it (the "?" sits outside the <label>, so a tap on it does not focus the field). */
function FieldLabel({ htmlFor, help, className, children }: { htmlFor: string; help: HelpKey; className?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <label htmlFor={htmlFor} className={className}>{children}</label>
      <HelpButton help={help} />
    </div>
  )
}

/** A cell of the test sheet: its number and a cross on its middle. */
function TestFace({ n }: { n: number }) {
  return (
    <div className="relative h-full w-full text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div className="absolute left-1/2 top-1/2 bg-black" style={{ width: '6mm', height: '0.2mm', transform: 'translate(-50%, -50%)' }} />
      <div className="absolute left-1/2 top-1/2 bg-black" style={{ width: '0.2mm', height: '6mm', transform: 'translate(-50%, -50%)' }} />
      <div className="absolute" style={{ left: '1mm', top: '0.8mm', fontSize: '7pt', lineHeight: 1 }}>{n}</div>
    </div>
  )
}

/**
 * One label, everything centred: the name in bold, the description under it,
 * then the barcode and the price under the barcode.
 */
function LabelFace({ label, width, height }: { label: PrintLabel; width: number; height: number }) {
  const m = labelMetrics(width, height, Boolean(label.code))
  const line = (pt: number) => `${pt}pt`
  return (
    <div
      className="flex h-full w-full flex-col items-center overflow-hidden text-center text-black"
      style={{ padding: `${m.pad}mm`, fontFamily: 'Arial, Helvetica, sans-serif', lineHeight: LINE_HEIGHT }}
    >
      <div className="w-full font-bold" style={{ fontSize: line(m.namePt), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {label.name}
      </div>
      <div className="min-h-0 w-full flex-1 overflow-hidden">
        {label.description && m.descLines > 0 && (
          <div style={{ fontSize: line(m.descPt), marginTop: `${m.gap}mm`, display: '-webkit-box', WebkitLineClamp: m.descLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {label.description}
          </div>
        )}
      </div>
      {label.code && <Barcode code={label.code} height={m.barH} maxWidth={width - 2 * m.pad} textPt={m.codePt} />}
      <div className="whitespace-nowrap font-bold" style={{ fontSize: line(m.pricePt), lineHeight: 1, marginTop: `${m.gap}mm` }}>{formatMoney(label.price)}</div>
    </div>
  )
}
