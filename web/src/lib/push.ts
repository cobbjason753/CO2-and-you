import webpush from 'web-push'
import { q } from './db'

/**
 * Web push (installed portal app on Android and iPhone, and desktop browsers).
 * Needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys) and
 * VAPID_SUBJECT (mailto: or https: contact). Without them push is simply off.
 */
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || ''

let configured = false
export function pushEnabled(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@cobsci.com', pub, priv)
    configured = true
  }
  return true
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string }

export type SubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } }

export async function saveSubscription(userId: string, sub: SubscriptionJSON, userAgent: string) {
  if (!/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Invalid subscription')
  // An endpoint belongs to one browser; if someone else signs in on it, it moves to them.
  await q(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, p256dh = $3, auth = $4, user_agent = $5, failures = 0`,
    [sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth, userAgent.slice(0, 300)],
  )
}

export async function removeSubscription(userId: string, endpoint: string) {
  await q('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, userId])
}

/** Sends to every registered phone/browser of these users. Returns how many were delivered. */
export async function pushToUsers(userIds: string[], payload: PushPayload): Promise<number> {
  if (!userIds.length || !pushEnabled()) return 0
  const subs = await q<{ endpoint: string; p256dh: string; auth: string }>(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1)',
    [userIds],
  )
  const body = JSON.stringify(payload)
  let delivered = 0
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 6 * 3600, urgency: 'high' })
        delivered++
        await q('UPDATE push_subscriptions SET last_success_at = now(), failures = 0 WHERE endpoint = $1', [s.endpoint])
      } catch (e: any) {
        // 404/410: the user turned notifications off or uninstalled the app.
        if (e?.statusCode === 404 || e?.statusCode === 410) await q('DELETE FROM push_subscriptions WHERE endpoint = $1', [s.endpoint])
        else await q('UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = $1', [s.endpoint])
      }
    }),
  )
  return delivered
}
