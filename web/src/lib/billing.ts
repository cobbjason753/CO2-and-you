import Stripe from 'stripe'
import { q, one } from './db'
import { env } from './env'

let client: Stripe | null = null
export function stripe(): Stripe | null {
  if (!env.stripeKey()) return null
  client ??= new Stripe(env.stripeKey())
  return client
}

export type SubRow = { id: string; status: string; plan: string; current_period_end: Date | null; canceled_at: Date | null }

/** Subscription that covers a house: the newest one held by any of its owners. */
export async function subscriptionForHouse(houseId: string): Promise<SubRow | null> {
  return one<SubRow>(
    `SELECT s.id, s.status, s.plan, s.current_period_end, s.canceled_at
       FROM subscriptions s JOIN house_members m ON m.user_id = s.user_id AND m.role = 'owner'
      WHERE m.house_id = $1
      ORDER BY (s.status IN ('active','trialing')) DESC, s.updated_at DESC LIMIT 1`,
    [houseId],
  )
}

export async function subscriptionForUser(userId: string): Promise<SubRow | null> {
  return one<SubRow>(
    `SELECT id, status, plan, current_period_end, canceled_at FROM subscriptions WHERE user_id = $1
      ORDER BY (status IN ('active','trialing')) DESC, updated_at DESC LIMIT 1`,
    [userId],
  )
}

export async function upsertSubscription(s: { id: string; userId: string | null; status: string; plan?: string; periodEnd?: Date | null; canceledAt?: Date | null }) {
  await q(
    `INSERT INTO subscriptions (id, user_id, status, plan, current_period_end, canceled_at)
     VALUES ($1,$2,$3,coalesce($4,'standard'),$5,$6)
     ON CONFLICT (id) DO UPDATE SET status = $3, user_id = coalesce($2, subscriptions.user_id),
       plan = coalesce($4, subscriptions.plan), current_period_end = coalesce($5, subscriptions.current_period_end),
       canceled_at = coalesce($6, subscriptions.canceled_at), updated_at = now()`,
    [s.id, s.userId, s.status, s.plan ?? null, s.periodEnd ?? null, s.canceledAt ?? null],
  )
}

/** Link to Stripe's hosted billing page (update card, invoices, cancel). */
export async function billingPortalUrl(stripeCustomerId: string): Promise<string | null> {
  const s = stripe()
  if (!s) return null
  const session = await s.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: `${env.appUrl()}/app/account` })
  return session.url
}
