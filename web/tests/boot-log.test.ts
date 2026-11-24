import { describe, it, expect } from 'vitest'
import { parseBootLog } from '../src/lib/boot-log'

const LOG = `ESP-ROM:esp32s3-20210327
CP1: Serial up
Device ID: esp32-A4CB8FDA3E5C
Firmware v11
PROVISION: esp32-A4CB8FDA3E5C ${'ab'.repeat(32)}
CP2: Wire up
I2C scan:
  found device at 0x3C
  found device at 0x62
I2C scan done
CP3: LED up
CP4: OLED found
CP5: past OLED block
E (1105) esp_littlefs: Failed to initialize LittleFS
*wm:AutoConnect `

describe('boot log parser', () => {
  it('reads ID, key, firmware and the factory test from a fresh board', () => {
    const b = parseBootLog(LOG)
    expect(b).toMatchObject({ deviceId: 'esp32-A4CB8FDA3E5C', secret: 'ab'.repeat(32), fw: 11, sensorFound: true, screenFound: true, complete: true })
    expect(b.i2c).toEqual([0x3c, 0x62])
  })

  it('fails the test when the CO2 sensor is missing', () => {
    const b = parseBootLog(LOG.replace('  found device at 0x62\n', ''))
    expect(b.sensorFound).toBe(false)
    expect(b.complete).toBe(true)
  })

  it('is incomplete until the screen check has been printed', () => {
    expect(parseBootLog(LOG.split('CP4')[0]).complete).toBe(false)
  })

  it('handles CRLF and a missing screen', () => {
    const b = parseBootLog(LOG.replace(/\n/g, '\r\n').replace('CP4: OLED found', 'CP4: OLED NOT found'))
    expect(b.screenFound).toBe(false)
    expect(b.deviceId).toBe('esp32-A4CB8FDA3E5C')
  })
})

describe('v12 sensor self-test', () => {
  const v12 = LOG.replace('Firmware v11', 'Firmware v12')
  it('waits for the SENSORTEST line on v12+', () => {
    const b = parseBootLog(v12)
    expect(b.complete).toBe(false)
    expect(b.sensorFound).toBe(false)
  })
  it('passes on a real, plausible measurement', () => {
    const b = parseBootLog(v12 + '\nCP6: LittleFS done\nSENSORTEST: ok co2=612 temp=21.3 hum=44.0 (5230 ms)\n')
    expect(b).toMatchObject({ complete: true, sensorFound: true, sensorTest: { ok: true, co2: 612 } })
  })
  it('fails when the sensor answers on I2C but never measures', () => {
    const b = parseBootLog(v12 + '\nSENSORTEST: fail (no measurement in 12 s)\n')
    expect(b.i2c).toContain(0x62)
    expect(b).toMatchObject({ complete: true, sensorFound: false, sensorTest: { ok: false, detail: '(no measurement in 12 s)' } })
  })
  it('keeps the I2C check for older firmware', () => {
    expect(parseBootLog(LOG)).toMatchObject({ complete: true, sensorFound: true, sensorTest: null })
  })
})
