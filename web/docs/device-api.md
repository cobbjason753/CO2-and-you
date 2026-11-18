# Device API

Base URL: `https://app.cobsci.com`. HTTPS only; firmware validates the server certificate
with the ESP32 core's built-in root bundle.

## Identity

- `DEVICE_ID` = `esp32-` + the Wi-Fi MAC in upper-case hex, e.g. `esp32-A1B2C3D4E5F6`.
- Device secret = 32 random bytes from the hardware RNG, made on first boot and stored in NVS
  (namespace `device`, key `secret`) as 64 lower-case hex characters. Until enrolled, the
  firmware prints `PROVISION: <DEVICE_ID> <secret>` on the serial console at boot so the
  factory station can paste it into Admin › Provisioning (optional).

## `POST /api/device/enroll`

Sent once, until it succeeds.

```json
{ "device_id": "esp32-A1B2C3D4E5F6", "secret": "<64 hex>", "fw": 8, "legacy_location": "kitchen" }
```

| Status | Meaning |
|---|---|
| 200 `{"status":"enrolled"}` | Secret stored (or already the same). |
| 404 `unknown_device` | DEVICE_ID not registered. Logged under Admin › Fleet › Unknown devices. |
| 409 `secret_mismatch` | A different secret is already on file. Staff can reset it. |
| 403 `revoked` / `defective` | Blocked by staff. |
| 429 | Rate limited (20 / hour per device). |

`legacy_location` is the Location ID typed into the old on-device setup page, if any; the
portal uses it as the first room name.

## `POST /api/device/readings`

Headers:

```
X-Device-Id: esp32-A1B2C3D4E5F6
X-Timestamp: 1794940000                      (unix seconds, within ±15 min of server time)
X-Signature: hex(HMAC-SHA256(key = secret bytes, msg = DEVICE_ID + "\n" + X-Timestamp + "\n" + body))
Content-Type: application/json
```

Body (up to 300 readings, oldest first; temperature in °C):

```json
{ "fw": 8, "rssi": -61, "readings": [[1794939700, 712, 21.43, 44.2], [1794940000, 735, 21.47, 44.0]] }
```

Reply 200:

```json
{
  "accepted": 2,
  "received": 2,
  "claimed": true,
  "name": "Kitchen",
  "ota": { "version": 9, "url": "https://…/firmware-v9.bin", "sha256": "<64 hex>", "size": 1203456 }
}
```

- `claimed: false` — the unit isn't in any house yet (gift, retail, packing error). Readings
  are acknowledged but not stored; the device should treat them as sent.
- `name` — the room name set in the portal (`""` until named). Shown on the device screen.
- `ota` — `null` unless staff have a newer build for this device (pilot group, general
  release, or a forced version — which may be older, to roll back). The firmware downloads it,
  checks the SHA-256, installs it in trial mode and rolls back if it can't upload within 20 min.

Errors: `401 enroll` (secret was reset — enroll again), `401 bad_signature`,
`401 bad_timestamp` (re-sync NTP; reply includes `server_time`), `403 revoked|defective`,
`404 unknown_device`, `429 rate_limited` (120 / hour per device).

Duplicate readings (same device and timestamp) are ignored, so retrying a batch is safe.

## `GET /api/device/firmware/<version>`

Serves builds uploaded in Admin › Firmware. Builds added by URL (e.g. GitHub Release assets)
are downloaded from that URL directly.
