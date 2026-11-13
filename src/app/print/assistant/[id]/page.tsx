import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { assistantAccess } from '@/lib/assistant/access'
import { ownAction } from '@/lib/assistant/store'
import { cellText as show, type FilePayload } from '@/lib/assistant/files'
import { sofiaDate } from '@/lib/date-utils'
import { PrintButton } from '@/components/deliveries/print-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Документ' }

/**
 * A document the AI assistant made, on paper or as PDF from the print dialog.
 * Text is shown as text, never as HTML. Outside the admin layout, so only the
 * document prints.
 */
export default async function AssistantDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await assistantAccess()
  if (!access.ok) notFound()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const action = await ownAction(createAdminClient(), access.user.id, id)
  if (!action || (action.kind !== 'document' && action.kind !== 'excel')) notFound()
  const doc = action.payload as FilePayload

  return (
    <div className="mx-auto max-w-4xl p-6 text-sm text-black print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <span className="text-muted-foreground">Документ от AI асистента</span>
        <PrintButton />
      </div>
      <div className="flex items-baseline justify-between gap-4 border-b-2 border-black pb-1">
        <h1 className="text-xl font-bold">{doc.title}</h1>
        <span className="shrink-0">{sofiaDate(new Date())}</span>
      </div>
      {doc.intro && <p className="mt-3 whitespace-pre-line">{doc.intro}</p>}
      {doc.sections.map((s, i) => (
        <section key={i} className="mt-5 break-inside-avoid-page">
          {s.heading && <h2 className="mb-1 text-base font-semibold">{s.heading}</h2>}
          {s.text && <p className="whitespace-pre-line">{s.text}</p>}
          {s.table && (
            <>
              <table className="mt-2 w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-black text-left">
                    {s.table.columns.map(c => <th key={c.key} className="px-1 py-1">{c.title}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {s.table.rows.map((r, j) => (
                    <tr key={j} className="border-b border-slate-300 align-top">
                      {s.table!.columns.map(c => (
                        <td key={c.key} className={`px-1 py-0.5 ${typeof r[c.key] === 'number' ? 'text-right tabular-nums' : ''}`}>{show(r[c.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[10px] text-slate-500">Данни: {s.table.source}. {s.table.rows.length} реда.</p>
            </>
          )}
        </section>
      ))}
    </div>
  )
}
