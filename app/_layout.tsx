import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { Session } from '@supabase/supabase-js';
import { useTranslation } from 'react-i18next';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { parkBridge } from '@/lib/parkBridge';
import { checkAppVersion, VersionStatus } from '@/lib/app-version';
import { clearSignInFromPreviousInstall } from '@/lib/install-marker';
import { registerForPushNotifications, routeForNotification, stopPushOnThisDevice } from '@/lib/notifications';
import { UpdateRequired } from '@/components/update-required';
import { colors } from '@/constants/colors';
import { stackScreenOptions } from '@/constants/navigation';
import '@/lib/i18n';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState<VersionStatus>({ updateRequired: false });
  const router = useRouter();
  const segments = useSegments();
  const { t } = useTranslation();
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  const handledNotificationId = useRef<string | null>(null);
  // A link can be handled before the navigator mounts (cold start from an
  // email link); hold its navigation until loading finishes.
  const loadingRef = useRef(true);
  loadingRef.current = loading;
  const pendingRoute = useRef<string | null>(null);

  useEffect(() => {
    // Give the native Park Car App Intent the Supabase config + notification
    // permission it needs to run in the background (no-op off iOS).
    parkBridge.syncConfig(supabaseUrl, supabaseAnonKey);
    parkBridge.requestNotifications();

    async function init() {
      // Must run before anything restores a session: on iOS the keychain
      // survives an uninstall, and a reinstall shouldn't sign the previous
      // user back in.
      await clearSignInFromPreviousInstall();

      // The background intent rotates the refresh token when it parks while the app
      // is closed. Adopt its latest tokens BEFORE getSession() so the JS client
      // doesn't refresh with a now-stale token (which would log the user out).
      const adopted = parkBridge.readAuth();
      if (adopted) {
        try {
          await supabase.auth.setSession(adopted);
        } catch {
          // stale/invalid copy — fall through to the stored JS session
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      setLoading(false);
      parkBridge.syncAuth(session);
    }
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'SIGNED_OUT') {
        // Drop everything this device keeps for the signed-out account: the
        // Shortcut's session and car list, and its push registration.
        parkBridge.clearAuth();
        parkBridge.syncCars([]);
        stopPushOnThisDevice();
      } else {
        // Keep the background App Intent's copy of the session current.
        parkBridge.syncAuth(session);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Link this device's push token to whoever is signed in.
  const userId = session?.user.id;
  useEffect(() => {
    if (userId) registerForPushNotifications();
  }, [userId]);

  // Block builds older than the server's minimum (lib/app-version.ts). Re-check
  // on return to the foreground so a raised minimum applies without a relaunch.
  useEffect(() => {
    const refresh = () => {
      checkAppVersion().then(setVersion).catch(() => {});
    };
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!loading && pendingRoute.current) {
      router.replace(pendingRoute.current as any);
      pendingRoute.current = null;
    }
  }, [loading, router]);

  // Handle Supabase auth email links (password reset, sign-up confirmation).
  // With the PKCE flow they arrive as ?code=..., redeemable only with the code
  // verifier this install saved when it requested the email. A link made on
  // another device, or crafted by someone else, can't sign this phone in.
  useEffect(() => {
    function navigate(route: string) {
      if (loadingRef.current) {
        pendingRoute.current = route;
      } else {
        router.replace(route as any);
      }
    }

    async function handleUrl(url: string | null) {
      if (!url) return;

      const [beforeHash, hashPart] = url.split('#');
      const queryPart = beforeHash.includes('?') ? beforeHash.split('?')[1] : '';
      const query = new URLSearchParams(queryPart);
      const hash = new URLSearchParams(hashPart ?? '');

      // Already-used or expired links come back with ?error=. Show our own
      // message, never the error text from the URL, which anyone can write.
      if (query.has('error') || query.has('error_code') || hash.has('error') || hash.has('error_code')) {
        Alert.alert(t('layout.linkInvalidTitle'), t('layout.linkExpiredMessage'));
        return;
      }

      // Session tokens in a URL come from links emailed to older app versions,
      // or from someone trying to sign this phone into their own account.
      // Never adopt them.
      if (hash.has('access_token') || hash.has('refresh_token')) {
        Alert.alert(t('layout.linkInvalidTitle'), t('layout.linkOutdatedMessage'));
        return;
      }

      const code = query.get('code');
      if (!code) return;

      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        Alert.alert(t('layout.linkInvalidTitle'), t('layout.linkExpiredMessage'));
        // Don't leave someone on the reset-password screen without a session.
        const { data: { session } } = await supabase.auth.getSession();
        navigate(session ? '/(tabs)' : '/(auth)/login');
        return;
      }
      // auth-js returns redirectType at runtime (it's saved with the code
      // verifier when this install requested a reset) but leaves it off the type.
      const { redirectType } = data as typeof data & { redirectType?: string | null };
      if (redirectType === 'PASSWORD_RECOVERY') {
        navigate('/reset-password');
      }
      // Sign-up confirmation: onAuthStateChange picks up the new session and
      // the routing effect below sends the user to /(tabs).
    }

    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  // Open the screen a tapped notification points to, including a tap that
  // launched the app. Waits for the session so the auth redirect doesn't win.
  useEffect(() => {
    if (loading || !session || !lastNotificationResponse) return;
    if (lastNotificationResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = lastNotificationResponse.notification.request.identifier;
    if (handledNotificationId.current === id) return;
    handledNotificationId.current = id;
    const path = routeForNotification(lastNotificationResponse);
    if (path) router.push(path as any);
  }, [loading, session, lastNotificationResponse, router]);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const onResetPassword = (segments[0] as string) === 'reset-password';

    // Never redirect away from the reset-password screen — it manages its own navigation
    if (onResetPassword) return;

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.brand} />
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <KeyboardProvider>
      <Stack screenOptions={{ ...stackScreenOptions, headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="reset-password"
          options={{
            headerShown: true,
            title: t('layout.resetPassword'),
            headerBackVisible: false,
          }}
        />
        <Stack.Screen
          name="add-car"
          options={{
            presentation: 'modal',
            headerShown: true,
            title: t('layout.addVehicle'),
          }}
        />
        <Stack.Screen
          name="car/[id]"
          options={{
            headerShown: true,
            title: '',
            headerBackTitle: t('layout.vehicles'),
          }}
        />
        <Stack.Screen
          name="car/[id]/share"
          options={{
            headerShown: true,
            title: t('layout.manageSharing'),
          }}
        />
        <Stack.Screen
          name="about"
          options={{
            headerShown: true,
            title: t('layout.about'),
          }}
        />
        <Stack.Screen
          name="siri-shortcut"
          options={{
            headerShown: true,
            title: t('layout.siriShortcut'),
          }}
        />
      </Stack>
      {/* Overlay rather than replace the navigator, so routing keeps working. */}
      {version.updateRequired && (
        <View style={StyleSheet.absoluteFill}>
          <UpdateRequired storeUrl={version.storeUrl} />
        </View>
      )}
      <StatusBar style="dark" />
    </KeyboardProvider>
  );
}
