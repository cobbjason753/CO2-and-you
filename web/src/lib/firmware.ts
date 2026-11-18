import { one, type Db } from './db'
import { env } from './env'

export type OtaOffer = { version: number; url: string; sha256: string; size: number | null }

/**
 * Which build should this device run?
 *  1. a version staff forced for this device, else
 *  2. newest 'pilot' or 'general' release for pilot-group devices, else
 *  3. newest 'general' release.
 * Only offered when it is newer than what the device runs (forced versions may be older: a rollback).
 */
export async function otaOfferFor(
  device: { id: string; fw_version: number | null; pilot: boolean; target_fw: number | null },
  c?: Db,
): Promise<OtaOffer | null> {
  const current = device.fw_version ?? 0
  let rel: any = null
  if (device.target_fw != null) {
    if (device.target_fw === current) return null
    rel = await one(`SELECT version, url, sha256, size_bytes FROM firmware_releases WHERE version = $1 AND stage <> 'retired'`, [device.target_fw], c)
  } else {
    const stages = device.pilot ? ['pilot', 'general'] : ['general']
    rel = await one(
      `SELECT version, url, sha256, size_bytes FROM firmware_releases WHERE stage = ANY($1) ORDER BY version DESC LIMIT 1`,
      [stages],
      c,
    )
    if (rel && rel.version <= current) rel = null
  }
  if (!rel) return null
  return {
    version: rel.version,
    url: rel.url || `${env.appUrl()}/api/device/firmware/${rel.version}`,
    sha256: rel.sha256,
    size: rel.size_bytes,
  }
}

export async function latestGeneralVersion(c?: Db): Promise<number | null> {
  const r = await one<{ v: number | null }>(`SELECT max(version) AS v FROM firmware_releases WHERE stage = 'general'`, [], c)
  return r?.v ?? null
}
