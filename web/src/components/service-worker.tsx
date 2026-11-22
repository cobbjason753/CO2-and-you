'use client'

import { useEffect } from 'react'

/** Registers /sw.js (offline screen + push notifications). Silent where unsupported. */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (location.hostname === 'localhost' && process.env.NODE_ENV !== 'production' && !location.search.includes('sw=1')) return
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
  }, [])
  return null
}
