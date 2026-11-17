import { co2Band } from '@/lib/units'

/** Tiny server-rendered CO2 line for the last 24 h. */
export function Sparkline({ points, width = 260, height = 44 }: { points: { t: number; v: number }[]; width?: number; height?: number }) {
  if (points.length < 2) return <div style={{ height }} className="text-xs text-muted">Not enough data yet</div>
  const xs = points.map((p) => p.t)
  const ys = points.map((p) => p.v)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y0 = Math.min(400, ...ys), y1 = Math.max(1200, ...ys)
  const X = (t: number) => ((t - x0) / (x1 - x0 || 1)) * width
  const Y = (v: number) => height - 2 - ((v - y0) / (y1 - y0)) * (height - 4)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('')
  const band = co2Band(ys[ys.length - 1])
  const color = band === 'poor' ? 'var(--poor)' : band === 'fair' ? 'var(--fair)' : 'var(--brand)'
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="CO2 over the last 24 hours">
      <line x1="0" x2={width} y1={Y(1000)} y2={Y(1000)} stroke="var(--poor)" strokeOpacity="0.35" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}
