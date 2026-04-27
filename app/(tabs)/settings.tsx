import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Animated,
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';

type ActiveSheet = 'password' | 'name' | null;

export default function SettingsScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const slideAnim = useRef(new Animated.Value(600)).current;

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Name fields
  const [nameInput, setNameInput] = useState('');
  const [changingName, setChangingName] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setEmail(user.email ?? null);
      setUserId(user.id);
      supabase
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single()
        .then(({ data }) => setDisplayName(data?.display_name ?? null));
    });
  }, []);

  function openSheet(sheet: ActiveSheet) {
    if (sheet === 'name') setNameInput(displayName ?? '');
    setActiveSheet(sheet);
    slideAnim.setValue(600);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  }

  function closeSheet() {
    Animated.timing(slideAnim, { toValue: 600, duration: 250, useNativeDriver: true }).start(() => {
      setActiveSheet(null);
    });
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setNameInput('');
  }

  async function handleChangePassword() {
    if (newPassword.length < 8) {
      Alert.alert(t('settings.tooShort'), t('settings.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('settings.mismatch'), t('settings.passwordMismatch'));
      return;
    }
    setChangingPassword(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email!,
      password: currentPassword,
    });
    if (signInError) {
      Alert.alert(t('settings.incorrectPassword'), t('settings.incorrectPasswordMessage'));
      setChangingPassword(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (error) {
      Alert.alert(t('common.error'), error.message);
    } else {
      Alert.alert(t('settings.success'), t('settings.passwordUpdated'));
      closeSheet();
    }
  }

  async function handleChangeName() {
    const trimmed = nameInput.trim();
    if (trimmed.length === 0) {
      Alert.alert(t('settings.required'), t('settings.nameEmpty'));
      return;
    }
    setChangingName(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', userId!);
    setChangingName(false);
    if (error) {
      Alert.alert(t('common.error'), error.message);
    } else {
      setDisplayName(trimmed);
      Alert.alert(t('settings.success'), t('settings.nameUpdated'));
      closeSheet();
    }
  }

  const passwordSaveDisabled =
    changingPassword ||
    currentPassword.length === 0 ||
    newPassword.length === 0 ||
    confirmPassword.length === 0;

  const nameSaveDisabled = changingName || nameInput.trim().length === 0;

  return (
    <View style={styles.container}>
      {/* Profile info */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(displayName ?? email ?? '?')[0].toUpperCase()}
          </Text>
        </View>
        {displayName && <Text style={styles.displayName}>{displayName}</Text>}
        {email && <Text style={styles.email}>{email}</Text>}
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.rowButton} onPress={() => openSheet('name')}>
          <Text style={styles.rowButtonText}>{t('settings.changeName')}</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.rowButton} onPress={() => openSheet('password')}>
          <Text style={styles.rowButtonText}>{t('settings.changePassword')}</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.rowButton}
          onPress={() => Linking.openURL('https://doc-hosting.flycricket.io/wheredwepark-privacy-policy/84cadd06-966f-4e6c-bd3e-1eb6bd0c8a5d/privacy')}
        >
          <Text style={styles.rowButtonText}>{t('settings.privacyPolicy')}</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Sheet Modal */}
      <Modal visible={activeSheet !== null} transparent animationType="none">
        <KeyboardAvoidingView
          style={styles.editBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={closeSheet} />

          {activeSheet === 'password' && (
            <Animated.View style={[styles.editSheet, { transform: [{ translateY: slideAnim }] }]}>
              <Text style={styles.editTitle}>{t('settings.changePassword')}</Text>

              <Text style={styles.editLabel}>{t('settings.currentPassword')}</Text>
              <TextInput
                style={styles.editInput}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                placeholder={t('settings.currentPasswordPlaceholder')}
                autoCapitalize="none"
              />

              <Text style={styles.editLabel}>{t('settings.newPassword')}</Text>
              <TextInput
                style={styles.editInput}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder={t('settings.newPasswordPlaceholder')}
                autoCapitalize="none"
              />

              <Text style={styles.editLabel}>{t('settings.confirmNewPassword')}</Text>
              <TextInput
                style={styles.editInput}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                placeholder={t('settings.confirmNewPasswordPlaceholder')}
                autoCapitalize="none"
              />

              <TouchableOpacity
                style={[styles.saveButton, passwordSaveDisabled && styles.saveButtonDisabled]}
                onPress={handleChangePassword}
                disabled={passwordSaveDisabled}
              >
                {changingPassword ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>{t('settings.updatePassword')}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={closeSheet} style={styles.cancelLink}>
                <Text style={styles.cancelLinkText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {activeSheet === 'name' && (
            <Animated.View style={[styles.editSheet, { transform: [{ translateY: slideAnim }] }]}>
              <Text style={styles.editTitle}>{t('settings.changeName')}</Text>

              <Text style={styles.editLabel}>{t('settings.displayName')}</Text>
              <TextInput
                style={styles.editInput}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder={t('settings.displayNamePlaceholder')}
                autoCapitalize="words"
                autoFocus
              />

              <TouchableOpacity
                style={[styles.saveButton, nameSaveDisabled && styles.saveButtonDisabled]}
                onPress={handleChangeName}
                disabled={nameSaveDisabled}
              >
                {changingName ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>{t('settings.updateName')}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={closeSheet} style={styles.cancelLink}>
                <Text style={styles.cancelLinkText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    padding: 24,
  },
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 24,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatarText: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
  },
  displayName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  email: {
    fontSize: 14,
    color: '#6B7280',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  rowButton: {
    padding: 16,
    alignItems: 'center',
  },
  rowButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
  },
  signOutButton: {
    padding: 16,
    alignItems: 'center',
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#DC2626',
  },
  editBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  editSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 8,
  },
  editTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  editLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 4,
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#111827',
  },
  saveButton: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  cancelLink: {
    alignItems: 'center',
    padding: 8,
  },
  cancelLinkText: {
    fontSize: 14,
    color: '#6B7280',
  },
});
