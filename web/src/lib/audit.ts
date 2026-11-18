import { q, type Db } from './db'

export type Actor = { id: string; email: string } | null

export async function audit(
  actor: Actor,
  action: string,
  target: { type: string; id: string } | null,
  details: Record<string, unknown> = {},
  ip = '',
  c?: Db,
) {
  await q(
    `INSERT INTO audit_log (actor_id, actor_email, action, target_type, target_id, details, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actor?.id ?? null, actor?.email ?? null, action, target?.type ?? null, target?.id ?? null, JSON.stringify(details), ip],
    c,
  )
}
