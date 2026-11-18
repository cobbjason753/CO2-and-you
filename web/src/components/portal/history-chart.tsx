'use client'

import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

export type ChartSeries = { name: string; points: [number, number][] }

// Distinguishable in light and dark, colour-blind friendly order.
const PALETTE = ['#0f766e', '#7c3aed', '#ea580c', '#2563eb', '#db2777', '#65a30d', '#0891b2', '#a16207']

export function HistoryChart({ series, unit, tz, refLine }: { series: ChartSeries[]; unit: string; tz: string; refLine?: number }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!el.current || series.length === 0) return
    // uPlot wants one shared x axis: merge timestamps, null where a room has no bucket.
    const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b)
    const idx = new Map(xs.map((x, i) => [x, i]))
    const ys = series.map((s) => {
      const arr: (number | null)[] = new Array(xs.length).fill(null)
      for (const [t, v] of s.points) arr[idx.get(t)!] = v
      return arr
    })
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const axis = { stroke: dark ? '#94a3b8' : '#64748b', grid: { stroke: dark ? '#1e293b' : '#e2e8f0', width: 1 }, ticks: { show: false } }
    const opts: uPlot.Options = {
      width: el.current.clientWidth,
      height: Math.max(260, Math.min(420, el.current.clientWidth * 0.55)),
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), tz),
      scales: { x: { time: true } },
      legend: { live: true },
      cursor: { drag: { x: true, y: false } },
      axes: [axis, { ...axis, size: 52, values: (_u, vals) => vals.map((v) => `${v}`) }],
      series: [
        {},
        ...series.map((s, i) => ({
          label: s.name,
          stroke: PALETTE[i % PALETTE.length],
          width: 2,
          spanGaps: false,
          value: (_u: uPlot, v: number | null) => (v == null ? '—' : `${Math.round(v * 10) / 10} ${unit}`),
        })),
      ],
      hooks: refLine
        ? {
            draw: [
              (u: uPlot) => {
                const y = u.valToPos(refLine, 'y', true)
                if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) return
                const ctx = u.ctx
                ctx.save()
                ctx.strokeStyle = 'rgba(220,38,38,0.5)'
                ctx.setLineDash([6, 4])
                ctx.beginPath()
                ctx.moveTo(u.bbox.left, y)
                ctx.lineTo(u.bbox.left + u.bbox.width, y)
                ctx.stroke()
                ctx.restore()
              },
            ],
          }
        : {},
    }
    const plot = new uPlot(opts, [xs.map((x) => x / 1000), ...ys] as uPlot.AlignedData, el.current)
    const ro = new ResizeObserver(() => plot.setSize({ width: el.current!.clientWidth, height: Math.max(260, Math.min(420, el.current!.clientWidth * 0.55)) }))
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      plot.destroy()
    }
  }, [series, unit, tz, refLine])
  return <div ref={el} className="history-chart w-full [&_.u-legend]:text-sm [&_.u-legend]:text-ink" />
}
