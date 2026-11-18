/** Offset (ms) of a time zone from UTC at a given instant. */
function tzOffset(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return asUtc - at.getTime()
}

/** Midnight of YYYY-MM-DD in a time zone, as a Date. */
export function zonedMidnight(ymd: string, tz: string): Date | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const guess = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return new Date(guess.getTime() - tzOffset(tz, guess))
}

export function ymdIn(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export type RangeKey = 'day' | 'week' | 'month' | 'custom'

export function resolveRange(sp: { range?: string; from?: string; to?: string }, tz: string) {
  const now = new Date()
  const range = (['day', 'week', 'month', 'custom'].includes(sp.range ?? '') ? sp.range : 'day') as RangeKey
  if (range === 'custom') {
    const from = zonedMidnight(sp.from ?? '', tz)
    const toStart = zonedMidnight(sp.to ?? '', tz)
    if (from && toStart && toStart >= from) {
      const to = new Date(toStart.getTime() + 86400_000)
      const span = Math.min(to.getTime(), now.getTime() + 60_000) - from.getTime()
      if (span > 0 && span <= 400 * 86400_000) return { range, from, to: new Date(Math.min(to.getTime(), now.getTime() + 60_000)) }
    }
  }
  const days = range === 'month' ? 30 : range === 'week' ? 7 : 1
  return { range: range === 'custom' ? ('day' as RangeKey) : range, from: new Date(now.getTime() - days * 86400_000), to: new Date(now.getTime() + 60_000) }
}
