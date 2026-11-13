import { Fragment } from 'react'
import { parseAnswer, type Span } from '@/lib/assistant/answer-format'

function Line({ spans }: { spans: Span[] }) {
  return <>{spans.map((s, i) => (s.bold ? <strong key={i} className="font-semibold">{s.text}</strong> : <Fragment key={i}>{s.text}</Fragment>))}</>
}

/** The assistant's answer as paragraphs and lists (text only, never HTML). */
export function Answer({ text }: { text: string }) {
  return (
    <div className="space-y-2 break-words">
      {parseAnswer(text).map((b, i) =>
        b.kind === 'ul' ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => <li key={j}><Line spans={it} /></li>)}
          </ul>
        ) : (
          <p key={i}>
            {b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Line spans={l} /></Fragment>)}
          </p>
        ),
      )}
    </div>
  )
}
