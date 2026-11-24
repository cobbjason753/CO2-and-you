# CobSci platform for CO2 & You sensors (customer portal + admin)

The backend API, the customer portal and the staff admin area from the *Website & Platform
Spec*, as one Next.js app. Devices, browsers and staff all go through it; nothing else
touches the database.

```
 sensors ──signed HTTPS──▶ /api/device/*  ┐
 customers ─────────────▶ /app/*          ├─ Next.js app (Vercel) ── Postgres (Neon)
 staff (2FA) ───────────▶ /admin/*        │                      └─ Resend (email)
 Stripe ──webhooks──────▶ /api/webhooks/* ┘
 GitHub Actions ── every 15 min ──▶ /api/cron  (offline alerts, email retries, weekly reports)
```

## What's built

**Customer portal (`/app`, phone-first)**
- Dashboard: current CO2 / temperature / humidity per room with a good / fair / poor band, last-seen time, 24-hour sparkline, prompt to name new sensors.
- History: 24 h / 7 d / 30 d / custom, rooms overlaid on one chart, CO2 / temperature / humidity, CSV export.
- Devices: **name or rename a sensor's location in the portal** (this replaces the House ID / Location ID fields on the device's setup page — the new name reaches the sensor's screen within 5 minutes), move a sensor to another room, signal strength and firmware version, claim a sensor by its label code (or by scanning the label's QR code), remove a sensor.
- Alerts: house CO2 level plus per-room overrides, sensor offline after N hours, email delivery, alert history.
- Reports: **daily report** every morning after 7 am house time (the format from the CO2-and-you-reports repo: what to do, a 24-hour CO2 chart, each room against its past week), plus the weekly summary on Mondays. Each can be turned off; both can be previewed or emailed on demand.
- Household: invite viewers by email, owner/viewer roles, rename house, time zone, several houses with a switcher.
- Account: profile, °F/°C, password, optional two-step verification (authenticator app), subscription status and link to Stripe's billing page, download my data (ZIP), delete my account.
- Help: CO2 explainer, setup, calibration, privacy summary, contact support (house and device status attached automatically).

**Phone app (installable web app)**
- Customers install CobSci from the browser (Android: *Install app*; iPhone: Share › *Add to Home Screen*); it opens full-screen with its own icon. Set up under Account › App & notifications, with a dismissible "Get the app" banner on Home.
- Push notifications for CO2 and offline alerts on each phone that turns them on (iPhone needs iOS 16.4+ and the app installed), alongside the alert emails. Needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (generate once with `npx web-push generate-vapid-keys`; changing them means every phone has to turn notifications on again).
- Offline screen when there's no connection. Portal pages are never cached on the phone, so private data isn't left behind.

**Admin and back office (`/admin`, staff only, two-step verification required, every action audited)**
- Provisioning: register flashed boards (DEVICE_ID, firmware, test result, optional device secret), print labels (QR of claim link + claim code + DEVICE_ID barcode), unknown devices trying to connect.
- Packing station: paid unshipped orders, scan units (rejects unknown / failed test / already assigned), count check, address label unlocks when the count matches, mark shipped → welcome or "new sensors" email. Manual orders for testing or phone orders.
- Customer lookup by email, name, order number, HOUSE_ID or DEVICE_ID: houses, members, devices, subscription, orders, alerts, support requests; send a password link.
- Device actions: unassign, reassign to a HOUSE_ID, mark returned / defective, restock, reset or revoke its credential, reissue claim code and label, force a firmware version, pilot group.
- Fleet health: offline, failing uploads, outdated firmware, weak signal, unclaimed but reporting, unknown.
- Firmware releases: upload a `.bin` or link a GitHub Release asset, draft → pilot → general → retired.
- Business metrics: active subscriptions, past due, 30-day churn, devices shipped (by month), devices reporting.
- Support inbox, audit log, email outbox, staff roles.

**Device API** — see [docs/device-api.md](docs/device-api.md).

## Run it locally

Needs Node 22 and Postgres 14+.

```bash
cd web
cp .env.example .env.local      # then set DATABASE_URL and APP_SECRET
npm install
npm run seed                    # creates tables + demo data
npm run dev                     # http://localhost:3000
```

Demo logins (from `npm run seed`):

| | Email | Password |
|---|---|---|
| Customer | demo@cobsci.com | demo-password-1 |
| Admin | admin@cobsci.com | demo-password-1 + authenticator secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` |

Pretend to be a sensor (enrolls, then uploads signed readings like the firmware does):

```bash
npm run simulate -- --device esp32-AABBCCDDEEFF --backfill-hours 24
```

Register that DEVICE_ID in Admin › Provisioning first, otherwise it shows up under "Unknown devices".

Tests: `npm test` (backend logic against a `cobsci_test` database) and
`node scripts/e2e-smoke.mjs` (the whole lifecycle in a real browser; needs the dev server, seed data and Playwright).

## Deploy (all free tiers)

| Piece | Service | Free tier |
|---|---|---|
| App + API | **Vercel** Hobby | Fine for a proof of concept. Hobby is for non-commercial use, so move to Pro ($20/mo) before selling. |
| Database | **Neon** Postgres | 0.5 GB — roughly 4 million readings (≈ 40 sensors for a year). |
| Email | **Resend** | 3,000 emails / month, 100 / day. |
| Payments | **Stripe** | Test mode is free; live mode is per-transaction only. |
| Every-15-minute jobs | **GitHub Actions** | Free on public repositories. |
| Domain | cobsci.com | Already owned. |

1. **Neon**: project `co2-and-you` (`cold-rice-78953830`, AWS US East 1) is created and its tables are in place.
   Its connection strings are in `web/.env` (not committed): `DATABASE_URL` is the pooled one the app uses,
   `DATABASE_URL_UNPOOLED` the direct one migrations use. You can also copy them from the Neon console › Connect.
2. **Vercel**: import this GitHub repo, set **Root Directory = `web`**, and add environment variables:
   `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `APP_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`),
   `APP_URL=https://app.cobsci.com`, `CRON_SECRET` (another random string), `SUPPORT_EMAIL`, `EMAIL_FROM`.
3. Create the tables and your admin account from your machine:
   ```bash
   DATABASE_URL='<neon url>' APP_URL=https://app.cobsci.com npm run create-admin -- you@cobsci.com "Your Name"
   ```
   Open the printed link, set a password, then set up two-step verification when prompted.
4. **Domain**: in Vercel › Domains add `app.cobsci.com`; at your DNS provider add the CNAME it shows.
   (`cobsci.com` itself is left for the marketing site and store.)
5. **Resend**: add the domain `cobsci.com`, add the DNS records it shows, set `RESEND_API_KEY`.
   Until then every email is still visible in Admin › Emails.
6. **Cron**: in GitHub › Settings › Secrets › Actions add `APP_URL` and `CRON_SECRET`
   (the workflow `.github/workflows/platform-cron.yml` then runs every 15 minutes).
7. **Stripe** (when the store is ready): set `STRIPE_SECRET_KEY`, add a webhook to
   `https://app.cobsci.com/api/webhooks/stripe` for `checkout.session.completed`, `charge.refunded`,
   `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, and set `STRIPE_WEBHOOK_SECRET`.
   Give each Stripe Product a metadata key `devices` (sensors per unit: 1, 3, or 0 for a power supply).
   Turn on the Stripe customer portal so "Manage billing" works.

## Decisions made for the proof of concept

- **Readings are stored in Postgres, not InfluxDB.** One database, one free account, and full history (Influx Cloud's free plan keeps only 30 days). Queries are isolated in `src/lib/readings.ts` so moving to Influx or Timescale later is contained. Readings are tagged with the house and room they were recorded in, so moving or transferring a sensor never rewrites history.
- **Sensor names live in the portal.** Rooms belong to a house; a sensor sits in a room. Renaming a sensor that's alone in its room renames the room (history follows); moving it starts a new series. The name is sent back to the sensor with each upload and shown on its screen.
- **Per-device secrets, trust on first use.** Each sensor makes its own random secret on first boot and enrolls it once over HTTPS; staff can instead pin it at provisioning. Uploads are HMAC-signed with a timestamp. Unknown, revoked, defective and returned units are refused; unassigned units are flagged but their readings aren't stored.
- **Server-directed OTA.** The upload reply tells each sensor which build to run (forced version › pilot › general) with its SHA-256, which the firmware checks before switching. The existing rollback-on-failure logic is kept.
- **Lapsed subscriptions** (open question in the spec): currently only a warning banner; ingest and history continue. Change in one place when the policy is decided.
- **Shipping labels**: the packing station prints an address label/packing slip. Carrier labels with postage need Shippo or EasyPost (both have free test modes).
