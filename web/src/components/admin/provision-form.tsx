'use client'

import { useActionState } from 'react'
import { Submit } from '@/components/forms'
import { buttonClass } from '@/components/ui'
import type { ProvisionState, Label } from '@/app/admin/actions'

export function LabelSheet({ labels }: { labels: Label[] }) {
  if (!labels.length) return null
  return (
    <div className="space-y-3">
      <div className="no-print flex items-center gap-3">
        <button type="button" onClick={() => window.print()} className={buttonClass('primary', 'sm')}>
          Print labels
        </button>
        <span className="text-xs text-muted">Claim codes are shown once and stored only as a hash. Print now, or reissue a code later from the device page.</span>
      </div>
      <div className="print-area grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-2">
        {labels.map((l) => (
          <div key={l.deviceId} className="flex break-inside-avoid gap-3 rounded-lg border border-dashed border-line bg-white p-3 text-black">
            <div className="w-20 shrink-0 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: l.qr }} />
            <div className="min-w-0 flex-1 text-[11px] leading-tight">
              <p className="font-bold">CO2 &amp; You</p>
              <p className="mt-1">Claim code</p>
              <p className="font-mono text-sm font-bold tracking-wide">{l.claimCode}</p>
              <div className="mt-1 [&_svg]:h-10 [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: l.barcode }} />
              {l.fw != null && <p className="text-[9px]">fw v{l.fw}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProvisionForm({ action, defaultDevices, children }: { action: (s: ProvisionState, d: FormData) => Promise<ProvisionState>; defaultDevices: string; children: React.ReactNode }) {
  const [state, formAction] = useActionState(action, null)
  return (
    <div className="space-y-4">
      <form action={formAction} className="no-print space-y-3">
        {children}
        <textarea
          name="devices"
          rows={5}
          defaultValue={defaultDevices}
          required
          placeholder={'esp32-AABBCCDDEEFF\nesp32-AABBCCDDEE00, fail\nesp32-AABBCCDDEE11, pass, <64-hex secret from serial>'}
          className="block w-full rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-sm"
          aria-label="Device IDs"
        />
        <Submit>Register and make labels</Submit>
      </form>
      {state?.error && <p className="text-sm font-medium text-danger">{state.error}</p>}
      {state?.ok && <p className="no-print text-sm font-medium text-good">{state.ok}</p>}
      {!!state?.failures?.length && (
        <ul className="no-print list-disc pl-5 text-sm text-danger">
          {state.failures.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
      <LabelSheet labels={state?.labels ?? []} />
    </div>
  )
}

export function ReissueForm({ action, device }: { action: (s: ProvisionState, d: FormData) => Promise<ProvisionState>; device: string }) {
  const [state, formAction] = useActionState(action, null)
  return (
    <div className="space-y-3">
      <form action={formAction} className="no-print">
        <input type="hidden" name="device" value={device} />
        <Submit kind="secondary" size="sm" confirm="Issue a new claim code? The current label will stop working.">Reissue claim code &amp; label</Submit>
      </form>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="no-print text-sm text-good">{state.ok}</p>}
      <LabelSheet labels={state?.labels ?? []} />
    </div>
  )
}
