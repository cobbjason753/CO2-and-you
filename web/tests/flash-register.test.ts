import { describe, it, expect } from 'vitest'
import { one, q } from '../src/lib/db'
import { registerFlashed } from '../src/lib/flash-register'
import { handleEnroll } from '../src/lib/ingest'
import { createOrder, scanUnit } from '../src/lib/orders'
import { fakeDevice, provisioned, upload, nowS } from './helpers'

const actor = { id: '00000000-0000-0000-0000-000000000000', email: 'bench@cobsci.com' }

describe('Flash & register', () => {
  it('registers a new board with its key pinned and a claim code when it passes', async () => {
    const d = fakeDevice()
    const r = await registerFlashed({ deviceId: d.id, secret: d.secret, fw: 11, sensorFound: true, screenFound: true, notes: 'batch 1' }, actor)
    expect(r).toMatchObject({ ok: true, isNew: true, testResult: 'pass' })
    expect(r.ok && r.claimCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
    const dev = await one('SELECT * FROM devices WHERE id = $1', [d.id])
    expect(dev).toMatchObject({ status: 'in_stock', test_result: 'pass', fw_provisioned: 11, notes: 'batch 1' })
    expect(dev.secret_enc).toBeTruthy()
    // The pinned key is the one the board will use: enrolling with it succeeds, any other is refused.
    expect((await handleEnroll(JSON.stringify({ device_id: d.id, secret: d.secret, fw: 11 }), '')).status).toBe(200)
    expect((await handleEnroll(JSON.stringify({ device_id: d.id, secret: 'cd'.repeat(32), fw: 11 }), '')).status).toBe(409)
  })

  it('fails the factory test without a CO2 sensor or screen', async () => {
    const d = fakeDevice()
    const r = await registerFlashed({ deviceId: d.id, secret: d.secret, fw: 11, sensorFound: false, screenFound: true }, actor)
    expect(r).toMatchObject({ ok: true, testResult: 'fail' })
    expect((await one('SELECT test_result FROM devices WHERE id = $1', [d.id])).test_result).toBe('fail')
  })

  it('re-flashing a registered board keeps its house and replaces its key', async () => {
    const order = await createOrder({ source: 'manual', email: 'reflash@example.com', deviceQty: 1 })
    const staff = await one(`INSERT INTO users (email, role) VALUES ('s-reflash@x.com', 'staff') RETURNING id`)
    const d = await provisioned()
    await scanUnit(order.orderId, d.id, staff.id)
    const before = await one('SELECT house_id, claim_code_hash FROM devices WHERE id = $1', [d.id])
    const newSecret = 'ef'.repeat(32)
    const r = await registerFlashed({ deviceId: d.id, secret: newSecret, fw: 11, sensorFound: true, screenFound: true }, actor)
    expect(r).toMatchObject({ ok: true, isNew: false })
    expect(r.ok && r.claimCode).toBeFalsy()
    const after = await one('SELECT house_id, claim_code_hash, status FROM devices WHERE id = $1', [d.id])
    expect(after.house_id).toBe(before.house_id)
    expect(after.claim_code_hash).toBe(before.claim_code_hash) // existing label still valid
    expect(after.status).toBe('assigned')
    // Uploads signed with the new key are accepted straight away (no enroll step needed).
    expect((await upload({ id: d.id, secret: newSecret }, [[nowS(), 600, 21, 40]])).status).toBe(200)
    expect((await q(`SELECT 1 FROM audit_log WHERE action = 'device.reflash' AND target_id = $1`, [d.id])).length).toBe(1)
  })

  it('rejects a missing or malformed key', async () => {
    expect(await registerFlashed({ deviceId: fakeDevice().id, secret: 'nope', fw: 11, sensorFound: true, screenFound: true }, actor)).toMatchObject({ ok: false })
  })
})
