import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { shared } from '@/styles/shared';

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert(t('common.error'), t('login.missingFields'));
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      Alert.alert(t('login.loginFailed'), error.message);
    }
    // On success, the auth state change in _layout.tsx redirects automatically
  }

  return (
    <KeyboardAvoidingView
      style={shared.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={shared.title}>{t('login.title')}</Text>
        <Text style={shared.subtitle}>{t('login.subtitle')}</Text>

        <TextInput
          style={shared.input}
          placeholder={t('login.emailPlaceholder')}
          placeholderTextColor="#9CA3AF"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
        />

        <TextInput
          style={shared.input}
          placeholder={t('login.passwordPlaceholder')}
          placeholderTextColor="#9CA3AF"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
        />

        <TouchableOpacity
          style={[shared.button, loading && shared.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={shared.buttonText}>{t('login.signIn')}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={shared.linkButton}
          onPress={() => router.push('/(auth)/forgot-password' as any)}
        >
          <Text style={shared.linkText}>{t('login.forgotPassword')}</Text>
        </TouchableOpacity>

        <Link href="/(auth)/register" asChild>
          <TouchableOpacity style={shared.linkButton}>
            <Text style={shared.linkText}>
              {t('login.noAccount')}<Text style={shared.linkTextBold}>{t('login.signUp')}</Text>
            </Text>
          </TouchableOpacity>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});
