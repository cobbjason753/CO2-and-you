'use client'

import { useActionState, useOptimistic, startTransition } from 'react'
import type { FormAction } from '@/components/forms'
import { cx } from '@/components/ui'

/** On/off switch bound to a server action. Sends hidden fields plus on=true|false. */
export function ToggleSwitch({
  action,
  fields,
  checked,
  label,
  hint,
  disabled,
}: {
  action: FormAction
  fields: Record<string, string>
  checked: boolean
  label: string
  hint?: string
  disabled?: boolean
}) {
  const [state, formAction, pending] = useActionState(action, null)
  const [on, setOn] = useOptimistic(checked)
  const toggle = () => {
    const next = !on
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.set(k, v)
    fd.set('on', String(next))
    startTransition(() => {
      setOn(next)
      formAction(fd)
    })
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          disabled={disabled || pending}
          onClick={toggle}
          className={cx(
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-60',
            on ? 'bg-brand' : 'bg-line',
          )}
        >
          <span className={cx('inline-block size-5 rounded-full bg-white shadow transition', on ? 'translate-x-6' : 'translate-x-1')} />
        </button>
      </div>
      {state?.error && <p role="alert" className="mt-1 text-xs font-medium text-danger">{state.error}</p>}
      {state?.ok && <p role="status" className="mt-1 text-xs text-good">{state.ok}</p>}
    </div>
  )
}
