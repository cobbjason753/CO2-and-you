# CobSci mobile apps

Where the CobSci customer app stands, the options for putting it in the App Store and Google
Play, and what each store requires.

*Written November 2026. Store rules change often — re-check the current Apple and Google
requirements before submitting.*

## Where we are now

The customer portal at https://app.cobsci.com is an **installable web app** (option 1 below), live since 22 Nov 2026:

- Installs from the browser: Android *Install app*; iPhone Safari › Share › *Add to Home Screen*. Opens full-screen with the CobSci icon.
- Push notifications for high-CO2 and sensor-offline alerts, per phone, alongside the alert emails. Tested end to end on an iPhone (iOS 16.4+ with the app on the home screen).
- Set up under Account › App & notifications; "Get the CobSci app" banner on Home for phones.
- Offline screen; private portal pages are never stored on the phone.
- Server keys: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in Vercel. **Do not change them** — every phone would have to turn notifications on again.

## The three options

| | 1. Installable web app (done) | 2. Store app wrapping the portal | 3. Fully native app |
|---|---|---|---|
| What | Portal installed from the browser | App Store / Google Play app showing the portal inside a native shell (Capacitor), plus native features | Separate app with its own screens (React Native / Expo) |
| Effort | 1–2 days | ~1–2 weeks | ~6–10 weeks, plus a JSON API with token sign-in |
| Cost | $0 | $99/yr Apple + $25 once Google | Same as 2 |
| Store listing | No | Yes | Yes |
| Updates | Every deploy, no review | Portal changes go live without review; app-shell changes go through review | Every change goes through review |
| Best for | Now | Store presence, widgets, native notifications | In-app Bluetooth sensor setup, rich widgets, offline charts |

Recommendation: option 2 when store presence is wanted; it reuses the portal. Option 3 only if we decide to set sensors up from the app over Bluetooth (which also needs firmware changes).

## Accounts (needed first, and the slowest part)

| | Apple App Store | Google Play |
|---|---|---|
| Developer account | Apple Developer Program, **$99/year** | Google Play Console, **$25 once** |
| Publish as CobSci (company) | Needs a **D-U-N-S number** for CobSci (free from Dun & Bradstreet, can take 1–2 weeks), a website on the company domain, and authority to sign for the company | Organization account; also uses the D-U-N-S number and an identity check |
| If published as an individual instead | The owner's personal name shows as the seller | New personal accounts must run a **closed test with at least 12 testers for 14 days** before going public; organization accounts skip this |

Register both as **CobSci the company**. Request the D-U-N-S number first; everything else waits on it.

## Building the apps

- **Approach:** a native shell around the existing portal (Capacitor). One codebase; portal updates reach the apps automatically.
- **Android:** Google Play also accepts installable web apps directly (a *Trusted Web Activity*). Ours qualifies almost as-is: it needs a verification file at `https://app.cobsci.com/.well-known/assetlinks.json`, and the existing web notifications keep working.
- **iPhone:** web notifications don't work inside an App Store app, so the iOS app needs Apple's native notification service (APNs): an Apple push key (`.p8`) from the developer account, plus a server change to send through Apple.
- **No Mac required:** cloud build services build and upload the iOS app (Codemagic, Expo EAS and GitHub macOS runners have free tiers).
- Suggested app ID: `com.cobsci.app`.

## Apple review rules that matter for us

- **No "website in a box"** (guideline 4.2, minimum functionality): the iOS app needs genuinely native features. Native notifications cover the main one; a home-screen widget showing current CO2, or Face ID sign-in, strengthens it.
- **Subscriptions:** selling a digital subscription inside an iPhone app normally requires Apple's in-app purchase (Apple takes 15–30%). Simplest compliant setup: keep buying and billing on cobsci.com and don't sell inside the app (hide "Manage billing" in the iOS app). US apps may now also link out to the company website for payment.
- **Account deletion inside the app:** required — already built (Account › Delete account).
- **Sign in with Apple:** not required; we only use email and password, no Google or Facebook sign-in.

## What both stores require from us

1. **Public privacy policy and terms pages** on cobsci.com (listed in the platform spec; not built yet).
2. **A support page or contact URL.**
3. **Data and privacy questionnaires** (Apple *App Privacy*, Google *Data safety*): we collect email, name and sensor readings tied to the account; we don't track users or sell data; how to delete an account. Google also wants a web link for account-deletion requests.
4. **A demo login for reviewers.** They won't have a sensor, so they need a demo account with realistic data — a demo house fed by the device simulator (`npm run simulate`).
5. **Store listing material:**
   - App name, short and long descriptions, keywords, category (Health & Fitness, or Utilities).
   - Icon: 1024×1024 (Apple), 512×512 (Google), plus a 1024×500 feature graphic (Google).
   - Screenshots in each store's required phone sizes (can be generated from the portal).
6. **Age rating questionnaires** in each store; ours is suitable for everyone.
7. **Export compliance (Apple):** only standard HTTPS encryption, so exempt — a yes/no question.

## Ongoing

- **Renewal:** Apple charges every year.
- **Android updates:** Google requires targeting a recent Android version each year — one small update a year.
- **Review time:** each store update is reviewed, typically 1–2 days. Changes to the portal itself go live without review.

## Timeline and cost

- **Cost:** about $124 the first year ($99 Apple + $25 Google), then $99 a year. Cloud build services: free tiers.
- **Time:**

| Step | Time |
|---|---|
| D-U-N-S number and accounts | 1–2 weeks |
| Building the apps, privacy and terms pages, demo account, listings | about 1–2 weeks of work |
| First review | 1–7 days |

## Next steps

1. **Get a D-U-N-S number for CobSci** (check first whether one already exists).
2. **Open an Apple Developer account and a Google Play Console account,** both as CobSci.
3. **Decide:** keep subscriptions and billing on the website only (recommended — avoids Apple's fee and in-app purchase complexity).
4. **Privacy policy and terms:** draft from the spec's privacy section for review (by a lawyer if possible).

While the accounts are being approved, the privacy and terms pages, the reviewer demo account and the Android build can be prepared so they're ready to submit when the Google account is.
