import type Stripe from 'stripe'
import { stripe, upsertSubscription } from '@/lib/billing'
import { createOrder, findOrCreateUser } from '@/lib/orders'
import { q, one, tx, pool } from '@/lib/db'
import { unassignDevice } from '@/lib/devices'
import { audit } from '@/lib/audit'
import { sendEmail } from '@/lib/email'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Stripe events we consume: order paid, refunded, subscription created / renewed /
 * failed payment / cancelled. Set the webhook endpoint in Stripe to /api/webhooks/stripe.
 *
 * Product setup in Stripe: give each Product a metadata key "devices" with the number of
 * sensors it contains (single = 1, 3-pack = 3, power supply = 0).
 */
export async function POST(req: Request) {
  const s = stripe()
  const secret = env.stripeWebhookSecret()
  if (!s || !secret) return new Response('stripe not configured', { status: 503 })
  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = s.webhooks.constructEvent(raw, req.headers.get('stripe-signature') ?? '', secret)
  } catch {
    return new Response('bad signature', { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const cs = event.data.object as Stripe.Checkout.Session
      if (cs.payment_status !== 'paid' && cs.payment_status !== 'no_payment_required') break
      const items = await s.checkout.sessions.listLineItems(cs.id, { expand: ['data.price.product'], limit: 100 })
      let deviceQty = 0
      const lines = items.data.map((li) => {
        const product = li.price?.product as Stripe.Product | undefined
        const per = parseInt(product?.metadata?.devices ?? '0', 10) || 0
        deviceQty += per * (li.quantity ?? 1)
        return { name: li.description, qty: li.quantity, devices_each: per, amount: li.amount_total }
      })
      const md = cs.metadata ?? {}
      const custom = Object.fromEntries((cs.custom_fields ?? []).map((f) => [f.key, f.text?.value ?? f.dropdown?.value ?? '']))
      const isGift = md.is_gift === 'true' || custom.is_gift === 'yes'
      const email = cs.customer_details?.email ?? cs.customer_email ?? ''
      if (!email) break
      const shipping = (cs as any).collected_information?.shipping_details ?? (cs as any).shipping_details ?? null
      const order = await createOrder({
        source: 'stripe',
        externalId: cs.id,
        email,
        name: cs.customer_details?.name ?? '',
        deviceQty,
        items: lines,
        isGift,
        giftEmail: md.gift_email || custom.gift_email || null,
        giftName: md.gift_name || custom.gift_name || null,
        shipTo: shipping ? { name: shipping.name, ...shipping.address } : {},
        userId: md.user_id || null,
        houseId: md.house_id || null,
      })
      if (!order.duplicate) {
        await q('UPDATE orders SET payment_intent = $2 WHERE id = $1', [order.orderId, typeof cs.payment_intent === 'string' ? cs.payment_intent : null])
        await audit(null, 'order.paid', { type: 'order', id: order.orderId }, { stripe_session: cs.id, deviceQty })
      }
      // The subscription and Stripe customer belong to the buyer.
      if (typeof cs.customer === 'string') {
        const buyer = await findOrCreateUser(pool(), email, cs.customer_details?.name ?? '')
        await q('UPDATE users SET stripe_customer_id = coalesce(stripe_customer_id, $2) WHERE id = $1', [buyer.id, cs.customer])
        if (typeof cs.subscription === 'string') await upsertSubscription({ id: cs.subscription, userId: buyer.id, status: 'active' })
      }
      break
    }

    case 'charge.refunded': {
      const ch = event.data.object as Stripe.Charge
      if (!ch.refunded || typeof ch.payment_intent !== 'string') break
      const order = await one<{ id: string; status: string }>('SELECT id, status FROM orders WHERE payment_intent = $1', [ch.payment_intent])
      if (!order) break
      await tx(async (c) => {
        if (order.status === 'paid') {
          // Not shipped yet: put any scanned units back on the shelf.
          const units = await q<{ device_id: string }>('SELECT device_id FROM order_units WHERE order_id = $1', [order.id], c)
          for (const u of units) await unassignDevice(c, u.device_id, 'in_stock')
          await q('DELETE FROM order_units WHERE order_id = $1', [order.id], c)
        }
        await q(`UPDATE orders SET status = 'refunded' WHERE id = $1`, [order.id], c)
        await audit(null, 'order.refunded', { type: 'order', id: order.id }, { was: order.status }, '', c)
      })
      break
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
      const user = await one<{ id: string }>('SELECT id FROM users WHERE stripe_customer_id = $1', [customerId])
      const periodEnd = (sub as any).current_period_end ?? sub.items?.data?.[0]?.current_period_end
      await upsertSubscription({
        id: sub.id,
        userId: user?.id ?? null,
        status: sub.status,
        plan: sub.items?.data?.[0]?.price?.nickname || sub.items?.data?.[0]?.price?.lookup_key || undefined,
        periodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      })
      break
    }

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice
      const subId = (inv as any).subscription ?? (inv as any).parent?.subscription_details?.subscription
      if (typeof subId !== 'string') break
      if (event.type === 'invoice.paid') {
        const end = inv.lines?.data?.[0]?.period?.end
        await upsertSubscription({ id: subId, userId: null, status: 'active', periodEnd: end ? new Date(end * 1000) : null })
      } else {
        await upsertSubscription({ id: subId, userId: null, status: 'past_due' })
        const u = await one<{ email: string }>('SELECT u.email FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.id = $1', [subId])
        if (u)
          await sendEmail(u.email, 'Your CO2 & You payment didn’t go through', 'Payment problem', [
            { p: "We couldn't charge your card for your CO2 & You subscription. Your sensors keep working while you update it." },
            { button: { label: 'Update payment method', url: `${env.appUrl()}/app/account#billing` } },
          ], 'billing')
      }
      break
    }
  }
  return Response.json({ received: true })
}
