import { q, one, tx } from './db'
import { decrypt, encrypt, hmacHex, safeEqualHex } from './crypto'
import { normalizeDeviceId, DEVICE_ID_RE } from './devices'
import { rateLimit } from './ratelimit'
import { otaOfferFor, type OtaOffer } from './firmware'
import { evaluateCo2, resolveOffline } from './alerts'

export type ApiResult = { status: number; body: Record<string, unknown> }

const MAX_SKEW_SEC = 15 * 60
const MAX_READINGS = 300
const MAX_AGE_DAYS = 30

async function logUnknown(deviceId: string, ip: string, fw: number | null, legacy: string | null) {
  if (!DEVICE_ID_RE.test(deviceId)) return
  await q(
    `INSERT INTO unknown_devices (device_id, fw_version, last_ip, legacy_location) VALUES ($1,$2,$3,$4)
     ON CONFLICT (device_id) DO UPDATE SET last_seen_at = now(), attempts = unknown_devices.attempts + 1,
       fw_version = coalesce($2, unknown_devices.fw_version), last_ip = $3,
       legacy_location = coalesce($4, unknown_devices.legacy_location)`,
    [deviceId, fw, ip, legacy],
  )
}

async function recordError(deviceId: string, msg: string) {
  await q(`UPDATE devices SET ingest_errors = ingest_errors + 1, last_error = $2, last_error_at = now() WHERE id = $1`, [deviceId, msg])
}

const cleanLegacy = (s: unknown) =>
  typeof s === 'string' && s && s !== 'unassigned' ? s.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || null : null

/**
 * POST /api/device/enroll — the device generated its own secret on first boot and sends it once,
 * over HTTPS. Staff can also paste it at provisioning, in which case it must match.
 * A device that already has a different secret on file is refused (staff can reset it).
 */
export async function handleEnroll(raw: string, ip: string): Promise<ApiResult> {
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return { status: 400, body: { error: 'bad_json' } }
  }
  const id = normalizeDeviceId(String(body.device_id ?? ''))
  const secret = String(body.secret ?? '').toLowerCase()
  const fw = Number.isInteger(body.fw) ? body.fw : null
  if (!DEVICE_ID_RE.test(id) || !/^[0-9a-f]{64}$/.test(secret)) return { status: 400, body: { error: 'bad_request' } }
  if (!(await rateLimit(`enroll:${id}`, 20, 3600)) || !(await rateLimit(`enroll-ip:${ip}`, 200, 3600)))
    return { status: 429, body: { error: 'rate_limited' } }

  const d = await one<{ id: string; status: string; secret_enc: string | null }>('SELECT id, status, secret_enc FROM devices WHERE id = $1', [id])
  if (!d) {
    await logUnknown(id, ip, fw, cleanLegacy(body.legacy_location))
    return { status: 404, body: { error: 'unknown_device' } }
  }
  if (d.status === 'revoked' || d.status === 'defective') return { status: 403, body: { error: d.status } }
  if (d.secret_enc) {
    const stored = decrypt(d.secret_enc)
    if (safeEqualHex(stored, secret)) return { status: 200, body: { status: 'enrolled' } }
    await recordError(id, 'enroll with a different secret')
    return { status: 409, body: { error: 'secret_mismatch' } }
  }
  await q(
    `UPDATE devices SET secret_enc = $2, secret_set_at = now(), fw_version = coalesce($3, fw_version),
       legacy_location = coalesce(legacy_location, $4) WHERE id = $1 AND secret_enc IS NULL`,
    [id, encrypt(secret), fw, cleanLegacy(body.legacy_location)],
  )
  return { status: 200, body: { status: 'enrolled' } }
}

/**
 * POST /api/device/readings
 *   X-Device-Id: esp32-AABBCCDDEEFF
 *   X-Timestamp: unix seconds
 *   X-Signature: hex HMAC-SHA256(secret, "<device id>\n<timestamp>\n<raw body>")
 *   body: {"fw":7,"rssi":-61,"readings":[[unix_ts, co2_ppm, temp_c, humidity_pct], ...]}
 */
export async function handleReadings(raw: string, h: { deviceId: string | null; ts: string | null; sig: string | null }, ip: string): Promise<ApiResult> {
  const id = normalizeDeviceId(h.deviceId ?? '')
  if (!DEVICE_ID_RE.test(id) || !h.ts || !h.sig) return { status: 400, body: { error: 'missing_headers' } }
  if (!(await rateLimit(`ingest:${id}`, 120, 3600))) return { status: 429, body: { error: 'rate_limited' } }

  const dev = await one<any>(
    `SELECT d.*, r.name AS room_name FROM devices d LEFT JOIN rooms r ON r.id = d.room_id WHERE d.id = $1`,
    [id],
  )
  if (!dev) {
    await logUnknown(id, ip, null, null)
    return { status: 404, body: { error: 'unknown_device' } }
  }
  if (dev.status === 'revoked' || dev.status === 'defective') return { status: 403, body: { error: dev.status } }
  if (!dev.secret_enc) return { status: 401, body: { error: 'enroll' } }

  const ts = Number(h.ts)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SEC) {
    await recordError(id, 'clock skew')
    return { status: 401, body: { error: 'bad_timestamp', server_time: Math.floor(Date.now() / 1000) } }
  }
  const expected = hmacHex(decrypt(dev.secret_enc), `${id}\n${h.ts}\n${raw}`)
  if (!safeEqualHex(expected, h.sig.toLowerCase())) {
    await recordError(id, 'bad signature')
    return { status: 401, body: { error: 'bad_signature' } }
  }

  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return { status: 400, body: { error: 'bad_json' } }
  }
  const fw = Number.isInteger(body.fw) ? body.fw : null
  const rssi = Number.isInteger(body.rssi) ? body.rssi : null
  const list: unknown[] = Array.isArray(body.readings) ? body.readings.slice(0, MAX_READINGS) : []

  const now = Date.now() / 1000
  const rows = list
    .filter((r): r is number[] => Array.isArray(r) && r.length >= 4 && r.every((x) => typeof x === 'number' && Number.isFinite(x)))
    .filter(([t, co2, temp, hum]) => t <= now + 600 && t >= now - MAX_AGE_DAYS * 86400 && co2 >= 0 && co2 <= 40000 && temp > -40 && temp < 85 && hum >= 0 && hum <= 100)
    .sort((a, b) => a[0] - b[0])

  let accepted = 0
  let ota: OtaOffer | null = null
  await tx(async (c) => {
    const latest = rows[rows.length - 1]
    await q(
      `UPDATE devices SET last_seen_at = now(), fw_version = coalesce($2, fw_version), last_rssi = coalesce($3, last_rssi),
              ingest_errors = 0,
              last_reading_at = coalesce(to_timestamp($4), last_reading_at),
              last_co2 = coalesce($5, last_co2), last_temp_c = coalesce($6, last_temp_c), last_humidity = coalesce($7, last_humidity),
              target_fw = CASE WHEN target_fw = $2 THEN NULL ELSE target_fw END
        WHERE id = $1`,
      [id, fw, rssi, latest?.[0] ?? null, latest ? Math.round(latest[1]) : null, latest?.[2] ?? null, latest?.[3] ?? null],
      c,
    )
    // Unassigned devices are flagged (last_seen) but their readings don't go into any house.
    if (dev.house_id && rows.length) {
      const res = await c.query(
        `INSERT INTO readings (device_id, time, house_id, room_id, co2, temp_c, humidity)
         SELECT $1, to_timestamp(t), $2, $3, co2, temp, hum
           FROM unnest($4::float8[], $5::int[], $6::real[], $7::real[]) AS x(t, co2, temp, hum)
         ON CONFLICT DO NOTHING`,
        [id, dev.house_id, dev.room_id, rows.map((r) => r[0]), rows.map((r) => Math.round(r[1])), rows.map((r) => r[2]), rows.map((r) => r[3])],
      )
      accepted = res.rowCount ?? 0
      await resolveOffline(c, id)
      if (latest && now - latest[0] < 1800) await evaluateCo2(c, dev.house_id, id, dev.room_id, Math.round(latest[1]))
    }
    ota = await otaOfferFor({ id, fw_version: fw ?? dev.fw_version, pilot: dev.pilot, target_fw: dev.target_fw }, c)
  })

  return {
    status: 200,
    body: {
      accepted,
      received: list.length,
      claimed: !!dev.house_id,
      // Shown on the device's screen; renaming in the portal reaches the device on its next upload.
      name: dev.house_id ? (dev.room_name ?? '') : '',
      ota,
    },
  }
}
