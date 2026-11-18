import { q, type Db } from './db'
import { newHouseId } from './crypto'

export type HouseRef = { id: string; name: string; timezone: string; role: 'owner' | 'viewer' }

export async function housesFor(userId: string, c?: Db): Promise<HouseRef[]> {
  return q<HouseRef>(
    `SELECT h.id, h.name, h.timezone, m.role
       FROM house_members m JOIN houses h ON h.id = m.house_id
      WHERE m.user_id = $1 ORDER BY m.created_at, h.name`,
    [userId],
    c,
  )
}

export async function createHouse(c: Db, ownerId: string, name = 'My home', timezone = 'America/New_York') {
  const id = newHouseId()
  await q('INSERT INTO houses (id, name, timezone) VALUES ($1,$2,$3)', [id, name, timezone], c)
  await q(`INSERT INTO house_members (house_id, user_id, role) VALUES ($1,$2,'owner')`, [id, ownerId], c)
  await q(`INSERT INTO alert_rules (house_id, kind, threshold) VALUES ($1,'co2',1200), ($1,'offline',6)`, [id], c)
  return id
}
