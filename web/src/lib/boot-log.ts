// Parses the firmware's start-up log over USB serial (shared by the browser flasher and tests).
// Order the firmware prints things in: "Device ID: …", "Firmware vN", "PROVISION: <id> <key>",
// the I2C scan ("found device at 0x62" = SCD4x CO2 sensor, "0x3C" = OLED screen), "I2C scan done",
// then "CP4: OLED found" / "CP4: OLED NOT found", and (firmware v12+) a real CO2 measurement:
// "SENSORTEST: ok co2=612 temp=21.3 hum=44.0" or "SENSORTEST: fail (…)". All of it comes before
// Wi-Fi, so a freshly flashed board with no Wi-Fi saved still reports everything.

/** First firmware that prints SENSORTEST; older builds fall back to "the sensor answers on I2C". */
export const SENSORTEST_FROM_FW = 12

export const CO2_SENSOR_ADDR = 0x62
export const SCREEN_ADDR = 0x3c

export type BootInfo = {
  deviceId: string | null
  secret: string | null
  fw: number | null
  i2c: number[]
  scanDone: boolean
  screen: boolean | null // from "CP4: OLED (NOT) found"
  sensorTest: { ok: boolean; co2: number | null; detail: string } | null
  sensorFound: boolean // v12+: measured CO2; older: answers on I2C
  screenFound: boolean
  complete: boolean
}

export function parseBootLog(text: string): BootInfo {
  let deviceId: string | null = null
  let secret: string | null = null
  let fw: number | null = null
  const i2c = new Set<number>()
  let scanDone = false
  let screen: boolean | null = null
  let sensorTest: BootInfo['sensorTest'] = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    let m: RegExpMatchArray | null
    if ((m = line.match(/^Device ID:\s*(esp32-[0-9A-F]{12})\b/))) deviceId = m[1]
    else if ((m = line.match(/^Firmware v(\d+)\b/))) fw = Number(m[1])
    else if ((m = line.match(/^PROVISION:\s*(esp32-[0-9A-F]{12})\s+([0-9a-f]{64})\b/))) {
      deviceId = m[1]
      secret = m[2]
    } else if ((m = line.match(/found device at 0x([0-9A-Fa-f]{2})/))) i2c.add(parseInt(m[1], 16))
    else if (/^I2C scan done/.test(line)) scanDone = true
    else if ((m = line.match(/^SENSORTEST:\s*(ok|fail)\b\s*(.*)$/))) {
      const co2 = m[2].match(/co2=(\d+)/)
      sensorTest = { ok: m[1] === 'ok', co2: co2 ? Number(co2[1]) : null, detail: m[2].trim() }
    } else if (/^CP4: OLED NOT found/.test(line)) screen = false
    else if (/^CP4: OLED found/.test(line)) screen = true
  }
  const needsTest = (fw ?? 0) >= SENSORTEST_FROM_FW
  const sensorFound = sensorTest ? sensorTest.ok : !needsTest && i2c.has(CO2_SENSOR_ADDR)
  const screenFound = screen ?? i2c.has(SCREEN_ADDR)
  return {
    deviceId,
    secret,
    fw,
    i2c: [...i2c].sort((a, b) => a - b),
    scanDone,
    screen,
    sensorTest,
    sensorFound,
    screenFound,
    complete: !!deviceId && !!secret && scanDone && screen !== null && (!needsTest || sensorTest !== null),
  }
}
