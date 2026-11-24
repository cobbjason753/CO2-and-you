import { q, one, tx } from './db'
import { encrypt } from './crypto'
import { provisionDevice, normalizeDeviceId, DEVICE_ID_RE } from './devices'
import { audit, type Actor } from './audit'

export type FlashInput = { deviceId: string; secret: string; fw: number | null; sensorFound: boolean; screenFound: boolean; notes?: string }

export type FlashResult =
  | {
      ok: true
      deviceId: string
      isNew: boolean
      testResult: 'pass' | 'fail'
      message: string
      claimCode?: string // new boards only; turned into a label by the caller, never stored
      label?: import('@/app/admin/actions').Label | null
    }
  | { ok: false; error: string }

/**
 * Registers a board right after the browser flasher wiped and flashed it and read its start-up log.
 * New board: registered with its key pinned (more secure than learning it on first contact).
 * Existing board (re-flash): keeps its house and room; gets the new key, because flashing erased the old one.
 * Factory test: the start-up I2C scan must find the CO2 sensor and the screen.
 */
export async function registerFlashed(input: FlashInput, actor: Actor, ip = ''): Promise<FlashResult> {
  const id = normalizeDeviceId(input.deviceId)
  const secret = (input.secret || '').toLowerCase()
  if (!DEVICE_ID_RE.test(id)) return { ok: false, error: `"${input.deviceId}" is not a DEVICE_ID` }
  if (!/^[0-9a-f]{64}$/.test(secret)) return { ok: false, error: 'The board did not report a valid key.' }
  const testResult: 'pass' | 'fail' = input.sensorFound && input.screenFound ? 'pass' : 'fail'
  const fw = Number.isInteger(input.fw) ? input.fw : null
  const details = { fw, test_result: testResult, sensor: input.sensorFound, screen: input.screenFound, via: 'browser flasher' }

  const existing = await one<{ house_id: string | null }>('SELECT house_id FROM devices WHERE id = $1', [id])
  if (existing) {
    await tx(async (c) => {
      await q(
        `UPDATE devices SET secret_enc = $2, secret_set_at = now(), fw_provisioned = coalesce($3, fw_provisioned),
                test_result = $4, ingest_errors = 0, last_error = NULL WHERE id = $1`,
        [id, encrypt(secret), fw, testResult],
        c,
      )
      await audit(actor, 'device.reflash', { type: 'device', id }, details, ip, c)
    })
    return {
      ok: true,
      deviceId: id,
      isNew: false,
      testResult,
      message:
        testResult === 'fail'
          ? 'Already registered; new key saved, but it FAILED the factory test. Check the sensor and screen connections.'
          : existing.house_id
            ? 'Already registered and linked to a house: its new key is saved and it stays in its house. It reconnects once it is back on its Wi-Fi.'
            : 'Already registered: its new key is saved. Its existing label still works.',
    }
  }
  const { claimCode } = await tx(async (c) => {
    const r = await provisionDevice(c, { deviceId: id, fw, testResult, secretHex: secret, notes: input.notes ?? '' })
    await audit(actor, 'device.provision', { type: 'device', id }, { ...details, secret_pinned: true }, ip, c)
    return r
  })
  return {
    ok: true,
    deviceId: id,
    isNew: true,
    testResult,
    claimCode,
    message:
      testResult === 'pass'
        ? 'Registered. Print its label.'
        : 'Registered as FAILED factory test — no label. Check the sensor and screen connections and flash it again.',
  }
}
