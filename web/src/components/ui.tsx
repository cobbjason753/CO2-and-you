import Link from 'next/link'
import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { co2Band, BAND_LABEL, type Band } from '@/lib/units'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-surface p-4 sm:p-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

const btn = {
  primary: 'bg-brand text-brand-ink hover:opacity-90',
  secondary: 'border border-line bg-surface hover:bg-surface-2',
  danger: 'border border-danger/40 text-danger hover:bg-poor-soft',
  ghost: 'text-brand hover:bg-brand-soft/50',
}

export type BtnKind = keyof typeof btn

export const buttonClass = (kind: BtnKind = 'primary', size: 'md' | 'sm' = 'md') =>
  cx(
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed',
    size === 'md' ? 'min-h-11 px-4 text-sm' : 'min-h-9 px-3 text-sm',
    btn[kind],
  )

export function LinkButton({ href, kind = 'primary', size = 'md', children, className }: { href: string; kind?: BtnKind; size?: 'md' | 'sm'; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx(buttonClass(kind, size), className)}>
      {children}
    </Link>
  )
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

const inputCls = 'block w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30'

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, p.className)} />

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'fair' | 'poor' | 'brand' }) {
  const t = {
    neutral: 'bg-surface-2 text-muted border border-line',
    good: 'bg-good-soft text-good',
    fair: 'bg-fair-soft text-fair',
    poor: 'bg-poor-soft text-poor',
    brand: 'bg-brand-soft text-brand',
  }[tone]
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', t)}>{children}</span>
}

export function BandBadge({ ppm }: { ppm: number | null | undefined }) {
  const b = co2Band(ppm)
  if (!b) return <Badge>No data</Badge>
  return <Badge tone={b}>{BAND_LABEL[b]}</Badge>
}

export const bandText: Record<Band, string> = { good: 'text-good', fair: 'text-fair', poor: 'text-poor' }

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const t = {
    info: 'bg-brand-soft/60 border-brand/30',
    warn: 'bg-fair-soft border-fair/30',
    error: 'bg-poor-soft border-poor/30 text-poor',
    ok: 'bg-good-soft border-good/30',
  }[tone]
  return <div className={cx('rounded-xl border px-4 py-3 text-sm', t)}>{children}</div>
}

export function SignalBars({ bars }: { bars: number }) {
  return (
    <span className="inline-flex items-end gap-0.5" aria-label={`Signal ${bars} of 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cx('w-1 rounded-sm', i <= bars ? 'bg-brand' : 'bg-line')} style={{ height: 3 + i * 3 }} />
      ))}
    </span>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  )
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line [&_td]:px-3 [&_td]:py-2.5">{children}</tbody>
      </table>
    </div>
  )
}
