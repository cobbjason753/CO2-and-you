import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export type FormState = { ok?: string; error?: string } | null

/** Thrown for messages that are safe to show the user. */
export class UserError extends Error {}

/**
 * Wraps a server action body: known errors become { error }, redirects pass through,
 * anything unexpected is logged and shown generically.
 */
export async function run(fn: () => Promise<string | void>, revalidate: string | string[] = []): Promise<FormState> {
  try {
    const ok = await fn()
    for (const p of [revalidate].flat()) revalidatePath(p, 'layout')
    return { ok: ok || 'Saved.' }
  } catch (e) {
    unstable_rethrow(e)
    if (e instanceof UserError || (e instanceof Error && /^(Only|That|Choose|Scanned|Order|Room|Device|Too many)/.test(e.message)))
      return { error: e.message }
    console.error(e)
    return { error: 'Something went wrong. Please try again.' }
  }
}

export const str = (d: FormData, k: string) => String(d.get(k) ?? '').trim()
export const int = (d: FormData, k: string) => {
  const n = parseInt(str(d, k), 10)
  return Number.isFinite(n) ? n : null
}
