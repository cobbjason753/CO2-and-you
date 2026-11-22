# CobSci · CO2 & You

CobSci is the company; CO2 & You is the sensor. Customers manage their sensors in the CobSci portal at https://app.cobsci.com.

| Folder | What |
|---|---|
| `Dsp_v1_Cloud/` | ESP32-S3 sensor firmware (SCD4x, OLED, Wi-Fi setup by QR code, OTA with rollback) |
| `web/` | Platform: device API, customer portal, admin & back office — see [web/README.md](web/README.md) |
| `.github/workflows/release.yml` | Tag `v<N>` → builds firmware, publishes it to GitHub Pages and a GitHub Release |
| `.github/workflows/web-ci.yml` | Type-check, tests and build for `web/` |
| `.github/workflows/platform-cron.yml` | Calls the platform's housekeeping endpoint every 15 minutes |
| `docs/mobile-apps.md` | CobSci phone app: current installable app, App Store / Google Play options and requirements |

## Firmware changes for the platform

The firmware no longer writes to InfluxDB with a shared token. Instead it:

- makes its own secret on first boot and enrolls it with the platform;
- uploads readings to `https://app.cobsci.com/api/device/readings`, HMAC-signed with that secret
  (protocol: [web/docs/device-api.md](web/docs/device-api.md));
- gets its **name from the portal** — the setup page now only asks for Wi-Fi, and the room name
  customers type in the portal is shown on the OLED;
- installs firmware the platform offers (pilot group first, then everyone), verifying the
  SHA-256 before switching, with the existing trial/rollback logic;
- needs no secrets at build time (`secrets.h` and the `INFLUX_TOKEN` repository secret are no longer used),
  but needs the `ArduinoJson` library (added to the release workflow).

## Moving existing prototypes onto the platform

Do these in order — a unit that updates before it's registered can't upload, so its 20-minute
trial fails and it rolls back to the old build (and won't retry that version).

1. Deploy the platform at `https://app.cobsci.com` (see `web/README.md`).
2. Register every existing unit in Admin › Provisioning. Their DEVICE_IDs are the `device_id`
   tag in your current InfluxDB data, on each unit's local web page, and on the serial console.
3. Tag a release higher than anything shipped so far (e.g. `git tag v8 && git push origin v8`).
   Units on the old firmware pick it up from GitHub Pages within 6 hours, enroll, and start uploading.
4. Link each unit to a house: claim it in the portal with the code from its printed label,
   or use Admin › Devices › Reassign with a HOUSE_ID. An old Location ID becomes the room name.
5. **Rotate the InfluxDB token.** The old builds embedded it, and those `.bin` files are
   publicly downloadable from GitHub Pages, so anyone can extract it. Delete it in InfluxDB
   Cloud once every unit is on the new firmware.

Future releases: tag `v<N>`, then in Admin › Firmware add the build by linking its GitHub
Release asset, start a pilot, and release to everyone.
