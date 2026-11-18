export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="15" fill="currentColor" opacity="0.15" />
      <path d="M8 20c2-6 6-9 8-9s6 3 8 9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <circle cx="16" cy="11" r="2.5" fill="currentColor" />
    </svg>
  )
}
