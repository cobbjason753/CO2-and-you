// Shared by server and client code.

export type Band = 'good' | 'fair' | 'poor'

/** Same thresholds as the device LED: green < 800, amber < 1000, red otherwise. */
export function co2Band(ppm: number | null | undefined): Band | null {
  if (ppm == null) return null
  if (ppm < 800) return 'good'
  if (ppm < 1000) return 'fair'
  return 'poor'
}

export const BAND_LABEL: Record<Band, string> = { good: 'Good', fair: 'Fair', poor: 'Poor' }

export const cToF = (c: number) => (c * 9) / 5 + 32

export function fmtTemp(c: number | null | undefined, unit: 'F' | 'C') {
  if (c == null) return '—'
  return unit === 'F' ? `${cToF(c).toFixed(1)}°F` : `${c.toFixed(1)}°C`
}

export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return 'never'
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

/** RSSI to 0–4 bars. */
export function signalBars(rssi: number | null | undefined): number {
  if (rssi == null) return 0
  if (rssi >= -55) return 4
  if (rssi >= -65) return 3
  if (rssi >= -75) return 2
  if (rssi >= -85) return 1
  return 0
}

export const OFFLINE_AFTER_MIN = 20 // device reports every 5 minutes
export const isOnline = (lastSeen: Date | string | null | undefined) =>
  !!lastSeen && Date.now() - new Date(lastSeen).getTime() < OFFLINE_AFTER_MIN * 60_000
