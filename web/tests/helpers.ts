import crypto from 'node:crypto'
import { tx } from '../src/lib/db'
import { provisionDevice } from '../src/lib/devices'
import { handleEnroll, handleReadings } from '../src/lib/ingest'
import { hmacHex } from '../src/lib/crypto'

export function fakeDevice() {
  const id = 'esp32-' + crypto.randomBytes(6).toString('hex').toUpperCase()
  const secret = crypto.randomBytes(32).toString('hex')
  return { id, secret }
}

export async function provisioned(opts: { test?: 'pass' | 'fail' } = {}) {
  const d = fakeDevice()
  const { claimCode } = await tx((c) => provisionDevice(c, { deviceId: d.id, fw: 1, testResult: opts.test ?? 'pass' }))
  return { ...d, claimCode }
}

export async function enroll(d: { id: string; secret: string }) {
  return handleEnroll(JSON.stringify({ device_id: d.id, secret: d.secret, fw: 1 }), '1.2.3.4')
}

export async function upload(d: { id: string; secret: string }, readings: number[][], opts: { fw?: number; ts?: number; badSig?: boolean } = {}) {
  const body = JSON.stringify({ fw: opts.fw ?? 1, rssi: -60, readings })
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000))
  let sig = hmacHex(d.secret, `${d.id}\n${ts}\n${body}`)
  if (opts.badSig) sig = sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a')
  return handleReadings(body, { deviceId: d.id, ts, sig }, '1.2.3.4')
}

export const nowS = () => Math.floor(Date.now() / 1000)
