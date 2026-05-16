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

export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (newPassword.length < 8) {
      Alert.alert(t('resetPassword.tooShort'), t('resetPassword.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('resetPassword.mismatch'), t('resetPassword.passwordMismatch'));
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setLoading(false);
      Alert.alert(t('resetPassword.errorTitle'), error.message);
      return;
    }
    // Revoke any other active sessions so a stolen refresh token can't
    // outlive the password reset.
    await supabase.auth.signOut({ scope: 'others' });
    setLoading(false);
    Alert.alert(t('resetPassword.success'), t('resetPassword.successMessage'), [
      { text: 'OK', onPress: () => router.replace('/(tabs)') },
    ]);
  }

  const disabled = loading || newPassword.length === 0 || confirmPassword.length === 0;

  return (
    <KeyboardAvoidingView
      style={shared.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={shared.title}>{t('resetPassword.title')}</Text>
        <Text style={[shared.subtitle, styles.subtitleNarrow]}>{t('resetPassword.subtitle')}</Text>

        <Text style={shared.label}>{t('resetPassword.newPassword')}</Text>
        <TextInput
          style={shared.input}
          placeholder={t('resetPassword.newPasswordPlaceholder')}
          placeholderTextColor="#9CA3AF"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          textContentType="newPassword"
          autoFocus
        />

        <Text style={shared.label}>{t('resetPassword.confirmPassword')}</Text>
        <TextInput
          style={shared.input}
          placeholder={t('resetPassword.confirmPasswordPlaceholder')}
          placeholderTextColor="#9CA3AF"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />

        <TouchableOpacity
          style={[shared.button, disabled && shared.buttonDisabled]}
          onPress={handleSave}
          disabled={disabled}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={shared.buttonText}>{t('resetPassword.saveButton')}</Text>
          }
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
});
