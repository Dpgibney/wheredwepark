import { useState } from 'react';
import {
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { shared } from '@/styles/shared';

export default function RegisterScreen() {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!displayName || !email || !password) {
      Alert.alert(t('common.error'), t('register.fillAllFields'));
      return;
    }
    if (displayName.length > 100) {
      Alert.alert(t('common.error'), t('register.displayNameTooLong'));
      return;
    }
    if (password.length < 8) {
      Alert.alert(t('common.error'), t('register.passwordTooShort'));
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: 'wheredwepark://login',
      },
    });
    setLoading(false);

    if (error) {
      if (error.message.toLowerCase().includes('already registered')) {
        Alert.alert(t('common.error'), t('register.emailAlreadyRegistered'));
      } else {
        Alert.alert(t('register.registrationFailed'), error.message);
      }
      return;
    }

    if (data.user && !data.session) {
      if (data.user.identities?.length === 0) {
        Alert.alert(t('common.error'), t('register.emailAlreadyRegistered'));
      } else {
        Alert.alert(t('register.checkEmailTitle'), t('register.checkEmailMessage', { email }));
      }
    }
    // If session exists, onAuthStateChange in _layout.tsx redirects to app
  }

  return (
    <KeyboardAvoidingView
      style={shared.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={shared.title}>{t('register.title')}</Text>
        <Text style={shared.subtitle}>{t('register.subtitle')}</Text>

        <TextInput
          style={shared.input}
          placeholder={t('register.displayNamePlaceholder')}
          placeholderTextColor="#9CA3AF"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          textContentType="name"
        />

        <TextInput
          style={shared.input}
          placeholder={t('register.emailPlaceholder')}
          placeholderTextColor="#9CA3AF"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
        />

        <TextInput
          style={shared.input}
          placeholder={t('register.passwordPlaceholder')}
          placeholderTextColor="#9CA3AF"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
        />

        <TouchableOpacity
          style={[shared.button, loading && shared.buttonDisabled]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={shared.buttonText}>{t('register.createAccount')}</Text>
          }
        </TouchableOpacity>

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity style={shared.linkButton}>
            <Text style={shared.linkText}>
              {t('register.alreadyHaveAccount')}<Text style={shared.linkTextBold}>{t('register.signIn')}</Text>
            </Text>
          </TouchableOpacity>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
});
