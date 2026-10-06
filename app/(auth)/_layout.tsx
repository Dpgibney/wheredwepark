import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { stackScreenOptions } from '@/constants/navigation';

export default function AuthLayout() {
  const { t } = useTranslation();
  return (
    <Stack screenOptions={{ ...stackScreenOptions, headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen
        name="forgot-password"
        options={{
          headerShown: true,
          title: t('layout.forgotPassword'),
          headerBackTitle: '',
        }}
      />
    </Stack>
  );
}
