import 'server-only'
import { redirect } from 'next/navigation'
import { requireUser, type User, type Session } from './auth'
import { housesFor, type HouseRef } from './houses-core'

export * from './houses-core'

export type HouseCtx = { user: User; session: Session; houses: HouseRef[]; house: HouseRef | null }

/**
 * Every portal page goes through here: the house shown is always one the logged-in user
 * is a member of. A HOUSE_ID in a URL or form is never trusted on its own.
 */
export async function houseContext(): Promise<HouseCtx> {
  const { user, session } = await requireUser()
  const houses = await housesFor(user.id)
  const house = houses.find((h) => h.id === session.current_house_id) ?? houses[0] ?? null
  return { user, session, houses, house }
}

export async function requireHouse(opts: { owner?: boolean } = {}) {
  const ctx = await houseContext()
  if (!ctx.house) redirect('/app')
  if (opts.owner && ctx.house.role !== 'owner') throw new Error('Only house owners can do that.')
  return ctx as HouseCtx & { house: HouseRef }
}

