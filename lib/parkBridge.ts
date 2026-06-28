import type { Session } from '@supabase/supabase-js';
import ParkBridge from '@/modules/park-bridge';

/**
 * Thin, platform-safe wrapper over the native ParkBridge module. Every method is a
 * no-op off iOS (ParkBridge is null) so callers don't need their own guards.
 *
 * These methods feed the native "Park Car" App Intent (plugins/with-park-intent),
 * which runs in the background — even while the phone is locked — and therefore
 * can't reach the JS supabase client. We mirror the session, config, and car list
 * into shared on-device storage that the Swift intent reads.
 */
export const parkBridge = {
  syncAuth(session: Session | null) {
    if (!session) return;
    ParkBridge?.syncAuth(session.access_token, session.refresh_token, session.expires_at ?? 0);
  },
  syncConfig(url: string, anonKey: string) {
    ParkBridge?.syncConfig(url, anonKey);
  },
  syncCars(cars: { id: string; name: string }[]) {
    ParkBridge?.syncCars(JSON.stringify(cars));
  },
  clearAuth() {
    ParkBridge?.clearAuth();
  },
  /**
   * The background App Intent rotates the Supabase refresh token when it parks while
   * the app is closed, leaving the JS client's stored token stale. Call this on launch
   * to adopt whatever the intent last wrote, before the JS client tries to refresh
   * (a stale refresh would log the user out).
   */
  readAuth(): { access_token: string; refresh_token: string } | null {
    const json = ParkBridge?.readAuth();
    if (!json) return null;
    try {
      const parsed = JSON.parse(json);
      if (parsed?.access_token && parsed?.refresh_token) {
        return { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
      }
    } catch {
      // ignore malformed payloads
    }
    return null;
  },
  requestNotifications() {
    ParkBridge?.requestNotifications();
  },
};
