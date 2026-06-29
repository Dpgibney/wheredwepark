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
import { adPrivacyOptionsRequired, showAdPrivacyOptions } from '@/lib/ads';
import { shared } from '@/styles/shared';
import { colors } from '@/constants/colors';

type ActiveSheet = 'password' | 'name' | 'deleteAccount' | 'contact' | null;

export default function SettingsScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const slideAnim = useRef(new Animated.Value(600)).current;

  // Google's UMP policy: users shown the GDPR consent form must be able to
  // revisit their choices, so surface the row only when the SDK requires it.
  const [showAdPrivacyRow, setShowAdPrivacyRow] = useState(false);

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Name fields
  const [nameInput, setNameInput] = useState('');
  const [changingName, setChangingName] = useState(false);

  // Delete account fields
  const [deleteEmailInput, setDeleteEmailInput] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Contact / report a problem fields
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [sendingContact, setSendingContact] = useState(false);

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
    adPrivacyOptionsRequired().then(setShowAdPrivacyRow);
  }, []);

  function openSheet(sheet: ActiveSheet) {
    if (sheet === 'name') setNameInput(displayName ?? '');
    if (sheet === 'contact') setContactEmail(email ?? '');
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
    setDeleteEmailInput('');
    setContactSubject('');
    setContactMessage('');
    setContactEmail('');
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
      // Revoke any other active sessions so a stolen refresh token can't
      // outlive the password change.
      await supabase.auth.signOut({ scope: 'others' });
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

  const emailMatches =
    !!email && deleteEmailInput.trim().toLowerCase() === email.toLowerCase();

  async function handleDeleteAccount() {
    if (!emailMatches) return;
    setDeletingAccount(true);
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) {
      setDeletingAccount(false);
      // supabase-js wraps the response in `error.context` — read the body so we
      // surface the actual server-side reason instead of the generic wrapper.
      let detail = error.message ?? t('deleteAccount.failed');
      const ctx = (error as any).context;
      if (ctx && typeof ctx.text === 'function') {
        try {
          const body = await ctx.text();
          if (body) detail = `${ctx.status}: ${body}`;
        } catch {}
      }
      Alert.alert(t('common.error'), detail);
      return;
    }
    // The auth.users row is gone server-side; signing out clears the local
    // session and triggers the redirect to the login screen in app/_layout.tsx.
    await supabase.auth.signOut();
  }

  async function handleSubmitContact() {
    const subject = contactSubject.trim();
    const message = contactMessage.trim();
    if (subject.length === 0 || message.length === 0) {
      Alert.alert(t('contact.required'));
      return;
    }
    setSendingContact(true);
    const { error } = await supabase.functions.invoke('contact-support', {
      method: 'POST',
      body: {
        subject,
        message,
        contactEmail: contactEmail.trim(),
        platform: `${Platform.OS} ${Platform.Version}`,
      },
    });
    setSendingContact(false);
    if (error) {
      // supabase-js exposes the HTTP response on error.context; a 429 means the
      // per-user hourly rate limit was hit (see the contact-support function).
      const ctx = (error as any).context;
      if (ctx?.status === 429) {
        Alert.alert(t('contact.rateLimitedTitle'), t('contact.rateLimited'));
        return;
      }
      // Surface the server-side reason (mirrors the delete-account handler) so
      // config/setup failures are diagnosable instead of a generic message.
      let detail = error.message ?? t('contact.failed');
      if (ctx && typeof ctx.text === 'function') {
        try {
          const body = await ctx.text();
          if (body) detail = `${ctx.status}: ${body}`;
        } catch {}
      }
      Alert.alert(t('common.error'), detail);
      return;
    }
    Alert.alert(t('contact.sent'), t('contact.sentMessage'));
    closeSheet();
  }

  const contactSendDisabled =
    sendingContact || contactSubject.trim().length === 0 || contactMessage.trim().length === 0;

  const passwordSaveDisabled =
    changingPassword ||
    currentPassword.length === 0 ||
    newPassword.length === 0 ||
    confirmPassword.length === 0;

  const nameSaveDisabled = changingName || nameInput.trim().length === 0;

  const deleteAccountDisabled = deletingAccount || !emailMatches;

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
          onPress={() => Linking.openURL('https://dpgibney.github.io/wheredwepark/privacy.html')}
        >
          <Text style={styles.rowButtonText}>{t('settings.privacyPolicy')}</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        {showAdPrivacyRow && (
          <>
            <TouchableOpacity
              style={styles.rowButton}
              onPress={() => showAdPrivacyOptions().catch(() => {})}
            >
              <Text style={styles.rowButtonText}>{t('settings.adPrivacy')}</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
          </>
        )}
        <TouchableOpacity style={styles.rowButton} onPress={() => openSheet('contact')}>
          <Text style={styles.rowButtonText}>{t('settings.contactUs')}</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.signOutButton} onPress={() => openSheet('deleteAccount')}>
          <Text style={styles.signOutText}>{t('settings.deleteAccount')}</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Sheet Modal */}
      <Modal visible={activeSheet !== null} transparent animationType="none">
        <KeyboardAvoidingView
          style={shared.editBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={closeSheet} />

          {activeSheet === 'password' && (
            <Animated.View style={[shared.editSheet, { transform: [{ translateY: slideAnim }] }]}>
              <Text style={shared.editTitle}>{t('settings.changePassword')}</Text>

              <Text style={shared.editLabel}>{t('settings.currentPassword')}</Text>
              <TextInput
                style={shared.editInput}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                placeholder={t('settings.currentPasswordPlaceholder')}
                autoCapitalize="none"
              />

              <Text style={shared.editLabel}>{t('settings.newPassword')}</Text>
              <TextInput
                style={shared.editInput}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder={t('settings.newPasswordPlaceholder')}
                autoCapitalize="none"
              />

              <Text style={shared.editLabel}>{t('settings.confirmNewPassword')}</Text>
              <TextInput
                style={shared.editInput}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                placeholder={t('settings.confirmNewPasswordPlaceholder')}
                autoCapitalize="none"
              />

              <TouchableOpacity
                style={[shared.button, passwordSaveDisabled && shared.buttonDisabled]}
                onPress={handleChangePassword}
                disabled={passwordSaveDisabled}
              >
                {changingPassword ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={shared.buttonText}>{t('settings.updatePassword')}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={closeSheet} style={styles.cancelLink}>
                <Text style={styles.cancelLinkText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {activeSheet === 'name' && (
            <Animated.View style={[shared.editSheet, { transform: [{ translateY: slideAnim }] }]}>
              <Text style={shared.editTitle}>{t('settings.changeName')}</Text>

              <Text style={shared.editLabel}>{t('settings.displayName')}</Text>
              <TextInput
                style={shared.editInput}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder={t('settings.displayNamePlaceholder')}
                autoCapitalize="words"
                autoFocus
              />

              <TouchableOpacity
                style={[shared.button, nameSaveDisabled && shared.buttonDisabled]}
                onPress={handleChangeName}
                disabled={nameSaveDisabled}
              >
                {changingName ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={shared.buttonText}>{t('settings.updateName')}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={closeSheet} style={styles.cancelLink}>
                <Text style={styles.cancelLinkText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {activeSheet === 'deleteAccount' && (
            <Animated.View style={[shared.editSheet, { transform: [{ translateY: slideAnim }] }]}>
              <Text style={shared.editTitle}>{t('deleteAccount.title')}</Text>

              <Text style={styles.deleteWarning}>{t('deleteAccount.warning')}</Text>

              <Text style={shared.editLabel}>{t('deleteAccount.emailLabel')}</Text>
              <TextInput
                style={shared.editInput}
                value={deleteEmailInput}
                onChangeText={setDeleteEmailInput}
                placeholder={t('deleteAccount.emailPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />

              <TouchableOpacity
                style={[
                  shared.button,
                  shared.buttonDestructive,
                  deleteAccountDisabled && shared.buttonDisabled,
                ]}
                onPress={handleDeleteAccount}
                disabled={deleteAccountDisabled}
              >
                {deletingAccount ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={shared.buttonText}>{t('deleteAccount.deleteButton')}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={closeSheet} style={styles.cancelLink}>
                <Text style={styles.cancelLinkText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {activeSheet === 'contact' && (
            <Animated.View style={[shared.editSheet, { transform: [{ translateY: slideAnim }] }]}>
              <Text style={shared.editTitle}>{t('contact.title')}</Text>

              <Text style={shared.editLabel}>{t('contact.subjectLabel')}</Text>
              <TextInput
                style={shared.editInput}
                value={contactSubject}
                onChangeText={setContactSubject}
                placeholder={t('contact.subjectPlaceholder')}
                maxLength={200}
              />

              <Text style={shared.editLabel}>{t('contact.messageLabel')}</Text>
              <TextInput
                style={[shared.editInput, styles.contactMessageInput]}
                value={contactMessage}
                onChangeText={setContactMessage}
                placeholder={t('contact.messagePlaceholder')}
                multiline
                textAlignVertical="top"
                maxLength={5000}
              />

              <Text style={shared.editLabel}>{t('contact.emailLabel')}</Text>
              <TextInput
                style={shared.editInput}
                value={contactEmail}
                onChangeText={setContactEmail}
                placeholder={t('contact.emailPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <TouchableOpacity
                style={[shared.button, contactSendDisabled && shared.buttonDisabled]}
                onPress={handleSubmitContact}
                disabled={contactSendDisabled}
              >
                {sendingContact ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={shared.buttonText}>{t('contact.send')}</Text>
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
    backgroundColor: colors.background,
    padding: 24,
  },
  profileCard: {
    backgroundColor: colors.surface,
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
    backgroundColor: colors.brand,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatarText: {
    color: colors.surface,
    fontSize: 26,
    fontWeight: '700',
  },
  displayName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  email: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  section: {
    backgroundColor: colors.surface,
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
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
  },
  signOutButton: {
    padding: 16,
    alignItems: 'center',
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.destructive,
  },
  cancelLink: {
    alignItems: 'center',
    padding: 8,
  },
  cancelLinkText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  deleteWarning: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  contactMessageInput: {
    minHeight: 110,
  },
});
