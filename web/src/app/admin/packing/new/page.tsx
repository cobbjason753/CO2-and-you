import { Card, PageHeader, Field, Input } from '@/components/ui'
import { ActionForm } from '@/components/forms'
import { createTestOrder } from '../../actions'

export const metadata = { title: 'Manual order' }

export default function NewOrderPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Manual order" sub="For phone orders, replacements, or testing before the store is connected. Goes through the same path as a store order." />
      <Card>
        <ActionForm action={createTestOrder} submit="Create order">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Buyer email"><Input name="email" type="email" required /></Field>
            <Field label="Buyer name"><Input name="name" /></Field>
            <Field label="Number of sensors"><Input name="qty" type="number" min={1} max={50} defaultValue={1} required /></Field>
            <label className="flex items-center gap-2 self-end pb-3 text-sm">
              <input type="checkbox" name="subscription" defaultChecked className="size-4 accent-[var(--brand)]" /> Give an active subscription
            </label>
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-4">
            <legend className="mb-1 text-sm font-medium">Ship to</legend>
            <div className="sm:col-span-4"><Input name="line1" placeholder="Street" aria-label="Street" /></div>
            <div className="sm:col-span-2"><Input name="city" placeholder="City" aria-label="City" /></div>
            <Input name="state" placeholder="State" aria-label="State" />
            <Input name="zip" placeholder="ZIP" aria-label="ZIP" />
          </fieldset>
          <details>
            <summary className="cursor-pointer text-sm font-medium">This is a gift</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="gift" className="size-4" /> Gift — welcome email goes to the recipient</label>
              <Field label="Recipient email"><Input name="gift_email" type="email" /></Field>
              <Field label="Recipient name"><Input name="gift_name" /></Field>
            </div>
          </details>
        </ActionForm>
      </Card>
    </div>
  )
}
