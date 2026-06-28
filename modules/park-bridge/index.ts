import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type ParkBridgeNativeModule = {
  /** Persist the Supabase session for the background App Intent (keychain, after-first-unlock). */
  syncAuth(accessToken: string, refreshToken: string, expiresAt: number): void;
  /** Persist Supabase URL + anon key for the App Intent (UserDefaults). */
  syncConfig(url: string, anonKey: string): void;
  /** Persist the user's car list as JSON ([{ id, name }]) for the intent's car picker. */
  syncCars(carsJson: string): void;
  /** Remove the persisted session on sign-out. */
  clearAuth(): void;
  /** Read back the stored session JSON (the intent may have rotated the tokens). */
  readAuth(): string | null;
  /** Ask for local-notification permission so the App Intent can confirm parks. */
  requestNotifications(): void;
};

// requireOptionalNativeModule returns null (instead of throwing) when the native
// module isn't present — e.g. on Android/web, or before a native rebuild.
export default Platform.OS === 'ios'
  ? requireOptionalNativeModule<ParkBridgeNativeModule>('ParkBridge')
  : null;
