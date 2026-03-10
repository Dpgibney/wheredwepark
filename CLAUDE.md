# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the dev server (choose platform in terminal output)
npm start

# Platform-specific dev servers
npm run android
npm run ios
npm run web

# Lint
npm run lint

# EAS builds
eas build --profile development
eas build --profile preview
eas build --profile production
```

There are no automated tests in this project.

## Environment Setup

Copy `.env.example` to `.env` and populate:
- `EXPO_PUBLIC_SUPABASE_URL` — your Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — your Supabase anon/public key

This is a development-only build (requires `expo-dev-client`). Run `expo start` then open using the Expo Go app or a development build, not the standard Expo Go client, since native modules (maps, location, secure store) are used.

## Architecture

**Stack:** React Native + Expo (SDK 55), Expo Router (file-based routing), Supabase (auth + database + storage), TypeScript.

**Auth flow:** `app/_layout.tsx` is the root layout. It subscribes to `supabase.auth.onAuthStateChange` and redirects between `/(auth)` and `/(tabs)` route groups based on session state.

**Route structure:**
- `(auth)/` — login and register screens (unauthenticated)
- `(tabs)/` — main tab navigator (My Vehicles + Settings)
- `add-car` — modal for adding a vehicle
- `car/[id]` — vehicle detail: map + save/update parking location + photo
- `car/[id]/share` — manage sharing for a vehicle (owner only)

**Supabase client:** `lib/supabase.ts` exports the singleton `supabase` client and the `Database` TypeScript interface. Auth tokens are stored encrypted via `expo-secure-store`. Use `Tables<'table_name'>` helper for typed row access.

**Database tables:** `profiles`, `cars`, `parking_locations`, `car_shares`. Schema is in `supabase/schema.sql`.

**Key data access patterns:**
- All Supabase queries are done directly inside screen components (no separate data layer/hooks).
- `useFocusEffect` (from `@react-navigation/native`) is used to re-fetch data on screen focus.
- `parking_locations` has a unique constraint on `car_id` — use `.upsert(..., { onConflict: 'car_id' })` to update.
- Parking photos are stored in the `parking-images` Supabase Storage bucket at path `{car_id}/parking.jpg`. Access via signed URLs (1-hour expiry).

**Sharing model:** A `car_shares` row starts with `status: 'pending'`. The recipient must accept on the home screen before they can view the car's location. The `user_has_car_access(car_id)` Postgres function (used in RLS policies) only grants access to `accepted` shares.

**Styling:** All styling uses `StyleSheet.create` inline per component — no shared theme or design system file. Primary brand color is `#2563EB` (blue). Background grey is `#F9FAFB`.

**Deep links:** The app scheme is `wheredwepark://`. The car detail screen can be linked via `wheredwepark://car/{id}`.
