import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

// Push notifications: "someone shared a car with you" and, per car, "this car
// was parked" (opt-in, see car_notification_prefs). The server side lives in
// supabase/notifications.sql and supabase/functions/send-notifications.

// Show pushes as banners even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let currentToken: string | null = null;

async function getPushToken(): Promise<string | null> {
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return null;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

/**
 * Asks for notification permission if needed, then links this device's push
 * token to the signed-in user. Returns false if notifications aren't allowed
 * or the device can't receive pushes (e.g. a simulator).
 */
export async function registerForPushNotifications(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      // Android 13+ only shows the permission prompt once a channel exists.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return false;

    const token = await getPushToken();
    if (!token) return false;
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    if (error) return false;
    currentToken = token;
    return true;
  } catch {
    return false;
  }
}

/**
 * Unlinks this device from the signed-in user so the next person to use the
 * phone doesn't get their notifications. Call BEFORE signing out: the server
 * call needs the session.
 */
export async function unregisterPushToken() {
  try {
    const token = currentToken ?? (await getPushToken());
    if (token) await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {
    // Best effort; the server also drops tokens Expo reports as dead.
  }
  currentToken = null;
}

/**
 * Stops this device receiving pushes after any sign-out, including ones we
 * didn't initiate (e.g. the session was revoked because the password was
 * changed on another device). Needs no session; signing in registers again.
 */
export async function stopPushOnThisDevice() {
  currentToken = null;
  try {
    await Notifications.unregisterForNotificationsAsync();
  } catch {
    // Nothing to undo if the device was never registered.
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ALLOWED_PATH = new RegExp(`^/(car/${UUID})?$`);

/** The screen a tapped notification should open, or null. Only known routes are accepted. */
export function routeForNotification(response: Notifications.NotificationResponse): string | null {
  const path = response.notification.request.content.data?.path;
  return typeof path === 'string' && ALLOWED_PATH.test(path) ? path : null;
}
