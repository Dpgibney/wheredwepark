import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
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

  // Handle password-reset deep links (wheredwepark://reset-password#access_token=...&type=recovery)
  useEffect(() => {
    function handleUrl(url: string | null) {
      if (!url) return;
      const hash = url.split('#')[1];
      if (!hash) return;
      const params = new URLSearchParams(hash);
      if (params.get('type') !== 'recovery') return;
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (!accessToken || !refreshToken) return;
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (!error) router.replace('/reset-password' as any);
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
