'use client'

import { useActionState, useEffect, useRef, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { buttonClass, cx, type BtnKind } from './ui'

export type FormState = { ok?: string; error?: string } | null
export type FormAction = (prev: FormState, data: FormData) => Promise<FormState>

export function Submit({ children, kind = 'primary', size = 'md', className, confirm }: { children: ReactNode; kind?: BtnKind; size?: 'md' | 'sm'; className?: string; confirm?: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={cx(buttonClass(kind, size), className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault()
      }}
    >
      {pending ? 'Working…' : children}
    </button>
  )
}

/**
 * Form bound to a server action that returns { ok } or { error }.
 * Shows the message under the form; optionally resets fields on success.
 */
export function ActionForm({
  action,
  children,
  submit,
  kind = 'primary',
  size = 'md',
  className,
  resetOnOk,
  confirm,
  inline,
}: {
  action: FormAction
  children?: ReactNode
  submit: ReactNode
  kind?: BtnKind
  size?: 'md' | 'sm'
  className?: string
  resetOnOk?: boolean
  confirm?: string
  inline?: boolean
}) {
  const [state, formAction] = useActionState(action, null)
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state?.ok && resetOnOk) ref.current?.reset()
  }, [state, resetOnOk])
  return (
    <form ref={ref} action={formAction} className={cx(inline ? 'flex flex-wrap items-end gap-2' : 'space-y-3', className)}>
      {children}
      <div className={inline ? '' : 'pt-1'}>
        <Submit kind={kind} size={size} confirm={confirm}>
          {submit}
        </Submit>
      </div>
      {state?.error && (
        <p role="alert" className="w-full text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="w-full text-sm font-medium text-good">
          {state.ok}
        </p>
      )}
    </form>
  )
}
