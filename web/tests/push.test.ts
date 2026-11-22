import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent: { endpoint: string; body: any }[] = []
let failWith: number | null = null
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (sub: any, body: string) => {
      if (failWith) throw Object.assign(new Error('gone'), { statusCode: failWith })
      sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) })
    }),
  },
}))

import { q, one } from '../src/lib/db'
import { saveSubscription, pushToUsers } from '../src/lib/push'
import { createOrder, scanUnit } from '../src/lib/orders'
import { provisioned, enroll, upload, nowS } from './helpers'

beforeEach(() => {
  sent.length = 0
  failWith = null
  process.env.VAPID_PUBLIC_KEY = 'test-public'
  process.env.VAPID_PRIVATE_KEY = 'test-private'
})

const sub = (n: string) => ({ endpoint: `https://push.example.com/${n}`, keys: { p256dh: 'p', auth: 'a' } })

describe('push notifications', () => {
  it('rejects non-https endpoints', async () => {
    const u = await one(`INSERT INTO users (email) VALUES ('push0@example.com') RETURNING id`)
    await expect(saveSubscription(u.id, { endpoint: 'http://x', keys: { p256dh: 'p', auth: 'a' } }, '')).rejects.toThrow()
  })

  it('sends a CO2 alert to household phones and drops unsubscribed ones', async () => {
    const order = await createOrder({ source: 'manual', email: 'push1@example.com', deviceQty: 1 })
    const o = await one('SELECT * FROM orders WHERE id = $1', [order.orderId])
    await q(`UPDATE users SET password_hash = 'x' WHERE id = $1`, [o.user_id])
    await saveSubscription(o.user_id, sub('phone-a'), 'iPhone')
    await saveSubscription(o.user_id, sub('phone-b'), 'Android')
    const staff = await one(`INSERT INTO users (email, role) VALUES ('s-push@x.com', 'staff') RETURNING id`)
    const d = await provisioned()
    await scanUnit(order.orderId, d.id, staff.id)
    await enroll(d)
    await upload(d, [[nowS(), 1600, 21, 40]])
    expect(sent.map((s) => s.endpoint).sort()).toEqual(['https://push.example.com/phone-a', 'https://push.example.com/phone-b'])
    expect(sent[0].body.title).toMatch(/CO2 is 1600 ppm/)
    expect(sent[0].body.url).toBe('/app')

    failWith = 410
    expect(await pushToUsers([o.user_id], { title: 't', body: 'b' })).toBe(0)
    expect((await q('SELECT * FROM push_subscriptions WHERE user_id = $1', [o.user_id])).length).toBe(0)
  })

  it('is a no-op without server keys', async () => {
    delete process.env.VAPID_PRIVATE_KEY
    const u = await one(`INSERT INTO users (email) VALUES ('push2@example.com') RETURNING id`)
    await saveSubscription(u.id, sub('phone-c'), '')
    expect(await pushToUsers([u.id], { title: 't', body: 'b' })).toBe(0)
  })
})
