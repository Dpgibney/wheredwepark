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
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { shared } from '@/styles/shared';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert(t('common.error'), t('forgotPassword.missingEmail'));
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: 'wheredwepark://reset-password',
    });
    setLoading(false);
    if (error) {
      Alert.alert(t('forgotPassword.errorTitle'), error.message);
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <View style={shared.container}>
        <View style={styles.inner}>
          <Text style={shared.title}>{t('forgotPassword.successTitle')}</Text>
          <Text style={[shared.subtitle, styles.subtitleNarrow]}>{t('forgotPassword.successMessage')}</Text>
          <TouchableOpacity style={shared.button} onPress={() => router.back()}>
            <Text style={shared.buttonText}>{t('forgotPassword.backToLogin')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={shared.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={shared.title}>{t('forgotPassword.title')}</Text>
        <Text style={[shared.subtitle, styles.subtitleNarrow]}>{t('forgotPassword.subtitle')}</Text>

        <TextInput
          style={shared.input}
          placeholder={t('forgotPassword.emailPlaceholder')}
          placeholderTextColor="#9CA3AF"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          autoFocus
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />

        <TouchableOpacity
          style={[shared.button, loading && shared.buttonDisabled]}
          onPress={handleSend}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={shared.buttonText}>{t('forgotPassword.sendButton')}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={shared.linkButton} onPress={() => router.back()}>
          <Text style={styles.backLink}>{t('forgotPassword.backToLogin')}</Text>
        </TouchableOpacity>
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
  subtitleNarrow: {
    fontSize: 15,
    lineHeight: 22,
  },
  backLink: {
    color: '#2563EB',
    fontSize: 15,
    fontWeight: '500',
  },
});
