import { code128Bars } from '@/lib/labels/code128'

/**
 * A Code 128 barcode drawn as SVG, sized in millimetres for print, with the code under
 * it. Shared by the label sheets and the barcode card at the till.
 */
export function Barcode({ code, height, maxWidth, textPt }: { code: string; height: number; maxWidth: number; textPt: number }) {
  const bars = code128Bars(code)
  if (!bars) return <div style={{ fontSize: `${Math.max(textPt, 6)}pt` }}>{code}</div>
  const quiet = 6
  const total = bars.total + quiet * 2
  // About 0.33 mm a module reads well on any scanner; narrower only when the label is small.
  const width = Math.min(maxWidth, total * 0.33)
  return (
    <div className="flex shrink-0 flex-col items-center" style={{ width: `${width}mm` }}>
      <svg viewBox={`0 0 ${total} 10`} preserveAspectRatio="none" style={{ width: `${width}mm`, height: `${height}mm`, display: 'block' }} shapeRendering="crispEdges" aria-label={code}>
        {bars.bars.map(([x, w], i) => <rect key={i} x={x + quiet} y={0} width={w} height={10} fill="#000" />)}
      </svg>
      {textPt > 0 && <div style={{ fontSize: `${textPt}pt`, lineHeight: 1.1, letterSpacing: '0.04em', marginTop: '0.3mm' }}>{code}</div>}
    </div>
  )
}
