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

**Auth flow:** `app/_layout.tsx` is the root layout. It subscribes to `supabase.auth.onAuthStateChange` and redirects between `/(auth)` and `/(tabs)` route groups based on session state. The client uses the PKCE flow: email links (password reset, sign-up confirmation) return a one-time `?code=` that `handleUrl` exchanges with `exchangeCodeForSession`. Never call `setSession` with tokens from a URL; that lets anyone sign the phone into their own account.

**Route structure:**
- `(auth)/` — login, register and forgot-password screens (unauthenticated)
- `(tabs)/` — main tab navigator (My Vehicles + Settings)
- `add-car` — modal for adding a vehicle
- `car/[id]` — vehicle detail: map + save/update parking location + photo
- `car/[id]/share` — manage sharing for a vehicle (owner only)
- `reset-password` — set a new password after a reset link
- `about` — version/build and credits (artwork and icon by DoodlesByRay)
- `siri-shortcut` — iOS-only instructions for the "Park My Car" Siri Shortcut and automations

**Supabase client:** `lib/supabase.ts` exports the singleton `supabase` client and the `Database` TypeScript interface. Auth tokens are stored encrypted via `expo-secure-store`. Use `Tables<'table_name'>` helper for typed row access.

**Database tables:** `profiles`, `cars`, `parking_locations`, `car_shares`, `support_requests`, `push_tokens`, `car_notification_prefs`, `notification_log`, `app_min_versions`. The full schema is in `supabase/schema.sql`; changes to an existing project go in incremental, idempotent scripts alongside it (`security_fixes*.sql`, `notifications.sql`, `app_min_versions.sql`).

**Key data access patterns:**
- All Supabase queries are done directly inside screen components (no separate data layer/hooks).
- `useFocusEffect` (from `@react-navigation/native`) is used to re-fetch data on screen focus.
- `parking_locations` has a unique constraint on `car_id` — use `.upsert(..., { onConflict: 'car_id' })` to update.
- Parking photos are stored in the `parking-images` Supabase Storage bucket at path `{car_id}/parking.jpg`. Access via signed URLs (1-hour expiry).

**Sharing model:** A `car_shares` row starts with `status: 'pending'`. The recipient must accept on the home screen before they can view the car's location. The `user_has_car_access(car_id)` Postgres function (used in RLS policies) only grants access to `accepted` shares.

**Styling:** Components use `StyleSheet.create`, built from shared pieces:
- Colors: `constants/colors.ts`. Primary brand color is `#2563EB` (blue); background grey is `#F9FAFB`.
- Font sizes and weights: named roles in `constants/typography.ts` (e.g. `...text.body`). Don't hard-code `fontSize`/`fontWeight`.
- Common styles: `styles/shared.ts`.
- Header and tab bar options: `constants/navigation.ts`. Header actions use `components/ui/header-button.tsx`.

**Font scaling:** Import `Text`/`TextInput` from `@/components/ui/text`, not `react-native`. They follow the user's font-size setting up to `MAX_FONT_SCALE` (1.6×).
- Text in fixed-size spots (emoji buttons, badges) passes `maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}`.
- Fixed-size containers grow with `useScaledSize`.
- Headers and tab labels don't scale, like iOS's own bars.

**Keyboard:** `KeyboardProvider` (react-native-keyboard-controller) wraps the app.
- Forms use `KeyboardAwareScrollView`.
- A `KeyboardAvoidingView` under a navigation header needs `keyboardVerticalOffset={useHeaderHeight()}`, otherwise it stops short by the header's height.
- Sheets inside a React Native `Modal` keep React Native's own `KeyboardAvoidingView`, with a ScrollView for overflow.

**Notifications:** `lib/notifications.ts` registers the device's Expo push token after sign-in (`register_push_token` RPC) and unlinks it before sign-out.
- Sends "shared with you" notifications, plus per-car "was parked" notifications (opt-in via `car_notification_prefs`).
- Database webhooks call the `send-notifications` edge function, which only uses the service-role-only `claim_notifications`/`forget_push_tokens` functions; the service role has no access to the core tables.
- Never put coordinates in notification text.

**Minimum app version:** at launch and on return to the foreground, the app compares its build number with `app_min_versions.min_build` and shows a blocking update screen if it's older (`lib/app-version.ts`).

**Rolling out backend changes:** every installed app version uses the same Supabase project, and there is no staging project.
- Make server changes additive (new columns optional or defaulted; nothing an older version uses removed) and deploy them before the app release that needs them.
- Only tighten or remove old behavior once old versions are gone.
- The iOS Shortcut sends a hand-written PostgREST request (`plugins/with-park-intent/swift/SupabaseParkClient.swift`), so the `parking_locations` write shape must stay compatible.
- Edge functions are deployed manually (Supabase MCP or Dashboard). After deploying, check that the deployed source matches the repo.

**Deep links:** The app scheme is `wheredwepark://`. The car detail screen can be linked via `wheredwepark://car/{id}`.
