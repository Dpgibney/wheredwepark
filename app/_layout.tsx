import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Session } from '@supabase/supabase-js';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import '@/lib/i18n';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();
  const { t } = useTranslation();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Handle Supabase auth deep links. Tokens arrive in the URL hash
  // (#access_token=...&type=recovery|signup|magiclink|invite); errors from
  // already-used or expired links arrive as query params (?error=...).
  useEffect(() => {
    function handleUrl(url: string | null) {
      if (!url) return;

      const [beforeHash, hashPart] = url.split('#');
      const queryPart = beforeHash.includes('?') ? beforeHash.split('?')[1] : '';
      const hashParams = hashPart ? new URLSearchParams(hashPart) : null;
      const queryParams = queryPart ? new URLSearchParams(queryPart) : null;

      const errorCode =
        hashParams?.get('error_code') ?? queryParams?.get('error_code');
      const errorDescription =
        hashParams?.get('error_description') ?? queryParams?.get('error_description');
      if (errorCode || errorDescription) {
        const message = errorDescription
          ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
          : t('layout.linkExpiredMessage');
        Alert.alert(t('layout.linkInvalidTitle'), message);
        return;
      }

      if (!hashParams) return;
      const type = hashParams.get('type');
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      if (!accessToken || !refreshToken) return;

      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) return;
          if (type === 'recovery') {
            router.replace('/reset-password' as any);
          }
          // signup/magiclink/invite: onAuthStateChange picks up the new session
          // and the routing effect below sends the user to /(tabs).
        });
    }

    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

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
        <ActivityIndicator size="large" color="#2563EB" />
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="reset-password"
          options={{
            headerShown: true,
            headerTintColor: '#2563EB',
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
            headerTintColor: '#2563EB',
          }}
        />
        <Stack.Screen
          name="car/[id]"
          options={{
            headerShown: true,
            headerTintColor: '#2563EB',
            title: '',
            headerBackTitle: t('layout.vehicles'),
          }}
        />
        <Stack.Screen
          name="car/[id]/share"
          options={{
            headerShown: true,
            headerTintColor: '#2563EB',
            title: t('layout.manageSharing'),
          }}
        />
      </Stack>
      <StatusBar style="dark" />
    </>
  );
}
