import { ImageResponse } from 'next/og'
import crypto from 'node:crypto'
import { loadHouse, summarize, chartSig, CO2_FAIR } from '@/lib/daily-report'

export const dynamic = 'force-dynamic'

// Drawn at 2x for sharp email images (shown at 600 px wide).
const W = 1200
const H = 620
const INK = '#0b0b0b'
const INK_2 = '#52514e'
const MUTED = '#898781'
const GRID = '#e1e0d9'
const SURFACE = '#fcfcfb'

function niceStep(range: number) {
  const raw = range / 5
  return [100, 200, 250, 500, 1000, 2000, 5000].find((s) => s >= raw) ?? 10000
}

const hourLabel = (t: number, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' }).format(new Date(t)).replace(' ', ' ')

/**
 * CO2 chart for the daily report email: the 24 hours before `t` for one house.
 * The link is signed (h, t, s) so it can't be guessed for another house.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const houseId = url.searchParams.get('h') ?? ''
  const t = Number(url.searchParams.get('t'))
  const sig = url.searchParams.get('s') ?? ''
  const expected = chartSig(houseId, t)
  if (!Number.isFinite(t) || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return new Response('not found', { status: 404 })
  if (t > Date.now() + 5 * 60_000 || t < Date.now() - 400 * 86400_000) return new Response('not found', { status: 404 })

  const { house, readings, devices, roomNames } = await loadHouse(houseId, new Date(t)).catch(() => ({ house: null }) as any)
  if (!house) return new Response('not found', { status: 404 })
  const tz = house.timezone
  const rooms = summarize(readings, devices, roomNames, t, tz)
  const start = t - 24 * 3600_000
  const day = readings.filter((r: any) => r.t >= start)

  const many = rooms.filter((r) => r.readings > 0).length > 4
  const L = 110
  const R = many ? W - 40 : W - 250
  const T = 44
  const B = H - (rooms.filter((r) => r.readings > 0).length >= 2 ? 120 : 70)
  const ymin = 300
  const ymax = Math.max(1200, Math.max(0, ...day.map((r: any) => r.co2)) * 1.08)
  const X = (ts: number) => L + ((ts - start) / (t - start)) * (R - L)
  const Y = (v: number) => B - ((v - ymin) / (ymax - ymin)) * (B - T)

  const step = niceStep(ymax - ymin)
  const yTicks: number[] = []
  for (let v = Math.ceil(ymin / step) * step; v <= ymax; v += step) yTicks.push(v)

  // x ticks: every 4 local hours on the hour
  const xTicks: number[] = []
  for (let ts = Math.ceil(start / 3600_000) * 3600_000; ts <= t; ts += 3600_000) {
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(ts)))
    if (h % 4 === 0) xTicks.push(ts)
  }

  const series = rooms
    .map((r) => {
      const pts = day.filter((x: any) => `${x.room ?? 'none'}|${x.device}` === r.key)
      let d = ''
      pts.forEach((p: any, i: number) => {
        const gap = i > 0 && p.t - pts[i - 1].t > 20 * 60_000
        d += `${i === 0 || gap ? 'M' : 'L'}${X(p.t).toFixed(1)},${Y(Math.min(p.co2, ymax)).toFixed(1)} `
      })
      const last = pts[pts.length - 1]
      return { r, d, last }
    })
    .filter((s) => s.last)

  // Direct labels at line ends (up to 4), nudged apart like the original report.
  const ends = [...series].sort((a, b) => b.last.co2 - a.last.co2)
  const placed: { s: (typeof series)[number]; y: number }[] = []
  for (const s of ends) {
    let y = Y(s.last.co2)
    if (placed.length) y = Math.max(y, placed[placed.length - 1].y + 34)
    placed.push({ s, y })
  }

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: 'flex', position: 'relative', background: SURFACE, fontSize: 22, color: INK_2 }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', left: 0, top: 0 }}>
          {yTicks.map((v) => (
            <line key={v} x1={L} x2={R} y1={Y(v)} y2={Y(v)} stroke={GRID} strokeWidth={1.6} />
          ))}
          <line x1={L} x2={R} y1={B} y2={B} stroke={GRID} strokeWidth={1.6} />
          <line x1={L} x2={R} y1={Y(CO2_FAIR)} y2={Y(CO2_FAIR)} stroke={MUTED} strokeWidth={2} strokeDasharray="8 6" />
          {series.map((s) => (
            <path key={s.r.key} d={s.d} fill="none" stroke={s.r.color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
        {/* y labels */}
        {yTicks.map((v) => (
          <div key={v} style={{ position: 'absolute', left: 0, width: L - 14, top: Y(v) - 14, display: 'flex', justifyContent: 'flex-end', fontSize: 20 }}>
            {v.toLocaleString('en-US')}
          </div>
        ))}
        <div style={{ position: 'absolute', left: 0, width: L - 14, top: 0, display: 'flex', justifyContent: 'flex-end', fontSize: 18, color: INK_2 }}>CO2 (ppm)</div>
        {/* 1,000 ppm label */}
        <div style={{ position: 'absolute', left: L + 8, top: Y(CO2_FAIR) - 15, display: 'flex', fontSize: 18, padding: '2px 8px', background: SURFACE, color: INK_2, borderRadius: 6 }}>
          1,000 ppm
        </div>
        {/* x labels */}
        {xTicks.map((ts) => (
          <div key={ts} style={{ position: 'absolute', left: X(ts) - 40, width: 80, top: B + 10, display: 'flex', justifyContent: 'center', fontSize: 20 }}>
            {hourLabel(ts, tz)}
          </div>
        ))}
        {/* end labels */}
        {!many &&
          placed.map(({ s, y }) => (
            <div key={s.r.key} style={{ position: 'absolute', left: X(s.last.t) + 12, top: y - 14, display: 'flex', fontSize: 20, color: INK, maxWidth: W - X(s.last.t) - 16 }}>
              {s.r.label}
            </div>
          ))}
        {/* legend */}
        {series.length >= 2 && (
          <div style={{ position: 'absolute', left: L, right: 40, top: B + 52, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', fontSize: 20 }}>
            {series.map((s) => (
              <div key={s.r.key} style={{ display: 'flex', alignItems: 'center', marginRight: 26, marginBottom: 6 }}>
                <div style={{ width: 26, height: 5, background: s.r.color, borderRadius: 3, marginRight: 8, display: 'flex' }} />
                {s.r.label}
              </div>
            ))}
          </div>
        )}
        {!series.length && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: H / 2 - 20, display: 'flex', justifyContent: 'center', fontSize: 26, color: INK }}>
            No readings in the last 24 hours
          </div>
        )}
      </div>
    ),
    { width: W, height: H, headers: { 'Cache-Control': 'public, max-age=86400, immutable' } },
  )
}
