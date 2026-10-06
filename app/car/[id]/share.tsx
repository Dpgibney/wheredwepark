import { useEffect, useState } from 'react';
import {
  View,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useHeaderHeight } from '@react-navigation/elements';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { supabase } from '@/lib/supabase';
import { Text, TextInput } from '@/components/ui/text';
import { text } from '@/constants/typography';
import { shared } from '@/styles/shared';
import { colors } from '@/constants/colors';

type Share = {
  id: string;
  shared_with_user_id: string;
  status: 'pending' | 'accepted';
  // The address the owner typed (set by invite_to_car). Null on invites
  // created before the column existed.
  invited_email: string | null;
  profiles: {
    display_name: string | null;
    email: string;
  } | null;
};

export default function ShareScreen() {
  const { id: carId } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const headerHeight = useHeaderHeight();

  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchShares();
  }, [carId]);

  async function fetchShares() {
    const { data, error } = await supabase
      .from('car_shares')
      .select('id, shared_with_user_id, status, invited_email, profiles(display_name, email)')
      .eq('car_id', carId)
      .order('created_at', { ascending: true });

    if (error) {
      Alert.alert(t('common.error'), error.message);
    } else {
      setShares((data ?? []) as unknown as Share[]);
    }
    setLoading(false);
  }

  async function handleAdd() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    // "Already invited" is detected against the existing shares list so the
    // server-side RPC stays opaque about whether an arbitrary email is
    // registered. shares already contains the email of everyone the owner
    // has invited, so no extra lookup is needed.
    const alreadyShared = shares.some(s => (s.invited_email ?? s.profiles?.email)?.toLowerCase() === trimmed);
    if (alreadyShared) {
      Alert.alert(t('share.alreadyInvited'), t('share.alreadyInvitedMessage'));
      return;
    }

    setAdding(true);
    const { error } = await supabase.rpc('invite_to_car', {
      p_car_id: carId,
      p_email: trimmed,
    });
    setAdding(false);

    if (error) {
      Alert.alert(t('common.error'), error.message);
    } else {
      setEmail('');
      Alert.alert(t('share.inviteSent'), t('share.inviteSentMessage'));
      fetchShares();
    }
  }

  async function handleRemove(share: Share) {
    const profile = share.profiles;
    const isPending = share.status === 'pending';
    const name = (isPending ? share.invited_email : profile?.display_name) ?? profile?.email ?? 'this user';
    Alert.alert(
      isPending ? t('share.cancelInvite') : t('share.removeAccess'),
      isPending
        ? t('share.cancelInviteConfirm', { name })
        : t('share.removeAccessConfirm', { name }),
      [
        { text: t('share.cancel'), style: 'cancel' },
        {
          text: isPending ? t('share.cancelInvite') : t('share.remove'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('car_shares')
              .delete()
              .eq('id', share.id);
            if (error) {
              Alert.alert(t('common.error'), error.message);
            } else {
              setShares(prev => prev.filter(s => s.id !== share.id));
            }
          },
        },
      ]
    );
  }

  const pendingShares = shares.filter(s => s.status === 'pending');
  const acceptedShares = shares.filter(s => s.status === 'accepted');

  return (
    <KeyboardAvoidingView
      style={shared.container}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      {/* Add by email */}
      <View style={styles.addSection}>
        <Text style={shared.sectionLabel}>{t('share.sendInvite')}</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder={t('share.emailPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          <TouchableOpacity
            style={[styles.addButton, adding && shared.buttonDisabled]}
            onPress={handleAdd}
            disabled={adding}
          >
            {adding
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.addButtonText}>{t('share.send')}</Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      {loading
        ? <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />
        : (
          <FlatList
            data={[...pendingShares, ...acceptedShares]}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <>
                {pendingShares.length > 0 && (
                  <Text style={shared.sectionLabel}>{t('share.pending')}</Text>
                )}
              </>
            }
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item, index }) => {
              const profile = item.profiles;
              const isPending = item.status === 'pending';
              // Pending invites show the address that was typed rather than the
              // invitee's profile, so this keeps working once the server stops
              // revealing pending invitees' profiles (security_fixes_5.sql).
              const pendingEmail = item.invited_email ?? profile?.email;
              const showAcceptedHeader =
                index === pendingShares.length && acceptedShares.length > 0;

              return (
                <>
                  {showAcceptedHeader && (
                    <Text style={[shared.sectionLabel, { marginTop: pendingShares.length > 0 ? 20 : 0 }]}>
                      {t('share.hasAccess')}
                    </Text>
                  )}
                  <View style={[styles.shareRow, isPending && styles.shareRowPending]}>
                    <View style={styles.shareInfo}>
                      <View style={styles.nameRow}>
                        <Text style={styles.shareName}>
                          {isPending ? pendingEmail : (profile?.display_name ?? '—')}
                        </Text>
                        {isPending && (
                          <View style={styles.pendingBadge}>
                            <Text style={styles.pendingBadgeText}>{t('share.pending')}</Text>
                          </View>
                        )}
                      </View>
                      {!isPending && <Text style={styles.shareEmail}>{profile?.email}</Text>}
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemove(item)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Text style={styles.removeText}>
                        {isPending ? t('share.cancel') : t('share.remove')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>{t('share.noInvites')}</Text>
            }
          />
        )
      }
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  addSection: {
    backgroundColor: colors.surface,
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  listContent: {
    padding: 20,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...text.input,
    color: colors.textPrimary,
  },
  addButton: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    ...text.bodyStrong,
    color: colors.surface,
  },
  shareRow: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  shareRowPending: {
    borderWidth: 1,
    borderColor: colors.pendingBorder,
    backgroundColor: colors.pendingBg,
  },
  shareInfo: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareName: {
    ...text.bodyStrong,
    color: colors.textPrimary,
  },
  pendingBadge: {
    backgroundColor: colors.pendingBadge,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pendingBadgeText: {
    ...text.badge,
    color: colors.pendingText,
  },
  shareEmail: {
    ...text.caption,
    color: colors.textSecondary,
  },
  removeText: {
    ...text.smallMedium,
    color: colors.destructive,
  },
  emptyText: {
    ...text.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});
