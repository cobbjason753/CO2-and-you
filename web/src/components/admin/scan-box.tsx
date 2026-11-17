'use client'

import { useActionState, useEffect, useRef } from 'react'
import type { FormAction } from '@/components/forms'

/** Barcode scanners type the DEVICE_ID then Enter; the field clears and refocuses after each scan. */
export function ScanBox({ action, order }: { action: FormAction; order: string }) {
  const [state, formAction, pending] = useActionState(action, null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (input.current) {
      input.current.value = ''
      input.current.focus()
    }
  }, [state])
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="order" value={order} />
      <label className="block text-sm font-medium" htmlFor="scan">Scan a unit (or type its DEVICE_ID and press Enter)</label>
      <input
        id="scan"
        ref={input}
        name="device"
        autoFocus
        autoComplete="off"
        disabled={pending}
        className="block w-full rounded-xl border-2 border-brand bg-surface px-3 py-3 font-mono text-lg outline-none"
        placeholder="esp32-…"
      />
      {state?.error && <p role="alert" className="rounded-lg bg-poor-soft px-3 py-2 text-sm font-semibold text-poor">✕ {state.error}</p>}
      {state?.ok && <p role="status" className="rounded-lg bg-good-soft px-3 py-2 text-sm font-semibold text-good">✓ {state.ok}</p>}
    </form>
  )
}
