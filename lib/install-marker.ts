import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { parkBridge } from '@/lib/parkBridge';
import { supabase } from '@/lib/supabase';

const INSTALL_MARKER_KEY = 'install_marker';

/**
 * iOS keeps keychain items (the saved sign-in and the Siri Shortcut's copy of
 * it) after the app is deleted, so reinstalling would silently sign the
 * previous user back in. Remember when this copy of the app was installed; if
 * the keychain holds a marker from an earlier install, drop the old sign-in.
 *
 * The first launch of a version with this check finds no marker and only
 * records one, so existing users aren't signed out by the update itself.
 * Call before anything restores the session.
 */
export async function clearSignInFromPreviousInstall() {
  // Android deletes app data, including SecureStore, on uninstall.
  if (Platform.OS !== 'ios') return;

  try {
    const installedAt = (await Application.getInstallationTimeAsync()).toISOString();
    const marker = await SecureStore.getItemAsync(INSTALL_MARKER_KEY);
    if (marker === installedAt) return;

    if (marker) {
      parkBridge.clearAuth();
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      // Offline: keep the old marker so the next launch tries again.
      if (error) return;
    }
    await SecureStore.setItemAsync(INSTALL_MARKER_KEY, installedAt);
  } catch {
    // Never block launch on this check.
  }
}
