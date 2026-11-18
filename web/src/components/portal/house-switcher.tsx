'use client'

import { usePathname } from 'next/navigation'
import { useRef } from 'react'

export function HouseSwitcher({ houses, current, action }: { houses: { id: string; name: string }[]; current: string; action: (d: FormData) => Promise<void> }) {
  const ref = useRef<HTMLFormElement>(null)
  const path = usePathname()
  if (houses.length < 2) return <span className="truncate text-sm font-semibold">{houses.find((h) => h.id === current)?.name}</span>
  return (
    <form ref={ref} action={action}>
      <input type="hidden" name="back" value={path} />
      <label className="sr-only" htmlFor="house-switch">House</label>
      <select
        id="house-switch"
        name="house"
        defaultValue={current}
        onChange={() => ref.current?.requestSubmit()}
        className="max-w-44 truncate rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-semibold"
      >
        {houses.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </select>
    </form>
  )
}
