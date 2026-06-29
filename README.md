# Where'd We Park 🚗📍

A mobile app for saving where you parked, finding it again, and sharing a vehicle's parking spot with family or friends. Built with React Native + Expo, backed by Supabase.

**Support:** https://dpgibney.github.io/wheredwepark/ · **Privacy Policy:** https://dpgibney.github.io/wheredwepark/privacy.html

## Features

- **Save & find parking** — drop your current location, or place a pin to park a vehicle somewhere other than where you're standing. Open directions in Apple Maps, Google Maps, or Waze.
- **Notes & photos** — attach an optional note and one photo per vehicle to jog your memory (garage level, nearby landmark, etc.).
- **Multiple vehicles** — track each car separately with its own name, icon, and optional license plate.
- **Sharing** — invite someone by email; they accept before seeing the spot. Either side can stop sharing at any time, which immediately revokes access. Enforced server-side with Postgres RLS.
- **iOS Siri Shortcuts / App Intents** — park a vehicle by voice or from the Shortcuts app, without opening the app.
- **In-app support** — a Contact Us form that emails the support inbox (via a Supabase Edge Function + Resend).
- **Account & data deletion** — delete your account and all associated data from Settings.
- **Privacy-first ads** — banner ads via Google AdMob with a full UMP consent flow (EEA/UK/US) and iOS App Tracking Transparency.
- **Internationalization** — strings are localized via `i18next` (`locales/en.json`).

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | React Native `0.83` + Expo SDK `55`, React `19` |
| Language | TypeScript |
| Routing | Expo Router (file-based) |
| Backend | Supabase — Postgres, Auth, Storage, Edge Functions |
| Maps & location | `react-native-maps`, `expo-location` |
| Secure storage | `expo-secure-store` (encrypted auth tokens) |
| Ads | `react-native-google-mobile-ads` (AdMob) + UMP + ATT |
| i18n | `i18next` / `react-i18next` + `expo-localization` |
| Native (iOS) | Custom `park-bridge` module + `with-park-intent` config plugin (Swift App Intents) |
| Builds | EAS Build |

## Getting started

### Prerequisites

- Node.js (LTS) and npm
- A [Supabase](https://supabase.com) project (the database schema lives in `supabase/schema.sql`)
- For native builds: Xcode (iOS) and/or Android Studio
- This app uses native modules (maps, location, secure store, App Intents), so it **requires a development build** — the standard Expo Go client will not work.

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure environment variables — copy `.env.example` to `.env` and fill in:

   ```bash
   cp .env.example .env
   ```

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ```

3. Start the dev server (then open in a development build):

   ```bash
   npm start
   ```

### Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the Expo dev server (choose a target in the terminal) |
| `npm run ios` | Build & run the native iOS app (`expo run:ios`) |
| `npm run android` | Build & run the native Android app (`expo run:android`) |
| `npm run web` | Run in the browser |
| `npm run lint` | Lint with `expo lint` |

There are no automated tests in this project.

## Project structure

```
app/                     Screens & navigation (Expo Router, file-based)
  (auth)/                Login, register, forgot/reset password
  (tabs)/                Main tabs: My Vehicles + Settings
  add-car.tsx            Add-a-vehicle modal
  car/[id].tsx           Vehicle detail: map, save spot, note, photo
  car/[id]/share.tsx     Manage sharing for a vehicle (owner only)
lib/                     supabase client, ads, i18n, parking + native bridge
components/              Shared UI (AdBanner, themed views, etc.)
modules/park-bridge/     Custom Expo native module (Swift)
plugins/with-park-intent/  Config plugin adding iOS App Intents / Shortcuts (Swift)
locales/                 i18n string bundles
supabase/                schema.sql, edge functions, SQL migrations/fixes
```

### Routing & data

- The root layout (`app/_layout.tsx`) subscribes to `supabase.auth.onAuthStateChange` and redirects between the `(auth)` and `(tabs)` route groups based on session state.
- Supabase queries run directly in screen components (no separate data layer); `useFocusEffect` re-fetches on screen focus.
- The app scheme is `wheredwepark://`; a vehicle deep-links as `wheredwepark://car/{id}`.

## Backend (Supabase)

- **Tables:** `profiles`, `cars`, `parking_locations`, `car_shares`, `support_requests`. Full schema in `supabase/schema.sql`.
- **Access control:** Row Level Security throughout. The `user_has_car_access(car_id)` function grants access only to `accepted` shares.
- **Storage:** parking photos live in the `parking-images` bucket at `{car_id}/parking.jpg`, served via short-lived signed URLs.
- **Edge Functions:** `contact-support` (emails support requests via Resend), `delete-account`, and `delete-car-assets`.

> The Supabase project is administered through the Supabase Dashboard (no CLI workflow). Apply `schema.sql` and the `security_fixes*.sql` files via the SQL editor.

## Builds (EAS)

```bash
eas build --profile development   # dev client, internal distribution
eas build --profile preview       # internal distribution
eas build --profile production    # store builds, auto-incremented version
```

## License

© 2026 Daniel Gibney. All rights reserved. This source is published for transparency and is not licensed for redistribution or reuse.
