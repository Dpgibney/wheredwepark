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
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  purchaseUpdatedListener,
  purchaseErrorListener,
  finishTransaction,
  type Product,
} from 'react-native-iap';
import { supabase } from '@/lib/supabase';
import { shared } from '@/styles/shared';
import { colors } from '@/constants/colors';

const DONATION_SKU = 'a1';

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

  // Donation
  const [donationProduct, setDonationProduct] = useState<Product | null>(null);
  const [donating, setDonating] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    let purchaseListener: ReturnType<typeof purchaseUpdatedListener>;
    let errorListener: ReturnType<typeof purchaseErrorListener>;

    initConnection().then(() => {
      fetchProducts({ skus: [DONATION_SKU] }).then(products => {
        const p = products?.[0];
        if (p) setDonationProduct(p as Product);
      });

      purchaseListener = purchaseUpdatedListener(async purchase => {
        if (purchase.transactionId) {
          await finishTransaction({ purchase, isConsumable: true });
          setDonating(false);
          Alert.alert(t('settings.donateThanksTitle'), t('settings.donateThanksMessage'));
        }
      });

      errorListener = purchaseErrorListener(error => {
        if ((error as any).code !== 'E_USER_CANCELLED') {
          Alert.alert(t('common.error'), error.message);
        }
        setDonating(false);
      });
    }).catch(() => setDonationProduct(null));

    return () => {
      purchaseListener?.remove();
      errorListener?.remove();
      endConnection();
    };
  }, []);

  async function handleDonate() {
    if (!donationProduct) {
      Alert.alert(t('common.error'), t('settings.donateUnavailable'));
      return;
    }
    setDonating(true);
    try {
      await requestPurchase({
        request: { apple: { sku: DONATION_SKU } },
        type: 'in-app',
      });
    } catch (err: any) {
      if (err?.code !== 'E_USER_CANCELLED') {
        Alert.alert(t('common.error'), err.message);
      }
      setDonating(false);
    }
  }

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
        <TouchableOpacity
          style={styles.rowButton}
          onPress={() => Linking.openURL('mailto:support@wheredwepark.com?subject=Where%27d%20We%20Park%20-%20Feedback')}
        >
          <Text style={styles.rowButtonText}>{t('settings.contactUs')}</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        {Platform.OS === 'ios' && (
          <>
            <TouchableOpacity
              style={styles.rowButton}
              onPress={handleDonate}
              disabled={donating}
            >
              {donating ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Text style={styles.rowButtonText}>
                  {donationProduct
                    ? t('settings.donateButton', { price: donationProduct.displayPrice })
                    : t('settings.donate')}
                </Text>
              )}
            </TouchableOpacity>
            <View style={styles.divider} />
          </>
        )}
        <TouchableOpacity style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
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
});
