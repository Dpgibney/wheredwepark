import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { shared } from '@/styles/shared';
import { colors } from '@/constants/colors';

type Share = {
  id: string;
  shared_with_user_id: string;
  status: 'pending' | 'accepted';
  profiles: {
    display_name: string | null;
    email: string;
  } | null;
};

export default function ShareScreen() {
  const { id: carId } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();

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
      .select('id, shared_with_user_id, status, profiles(display_name, email)')
      .eq('car_id', carId)
      .order('created_at', { ascending: true });

    if (error) {
      Alert.alert(t('common.error'), error.message);
    } else {
      setShares(data ?? []);
    }
    setLoading(false);
  }

  async function handleAdd() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    const { data: lookup, error: lookupError } = await supabase
      .rpc('lookup_profile_for_share', { p_email: trimmed });

    const profile = Array.isArray(lookup) && lookup.length > 0 ? lookup[0] : null;

    if (lookupError || !profile) {
      setEmail('');
      Alert.alert(t('share.inviteSent'), t('share.inviteSentMessage'));
      return;
    }

    const alreadyShared = shares.some(s => s.shared_with_user_id === profile.id);
    if (alreadyShared) {
      Alert.alert(t('share.alreadyInvited'), t('share.alreadyInvitedMessage'));
      return;
    }

    setAdding(true);
    const { error } = await supabase
      .from('car_shares')
      .insert({ car_id: carId, shared_with_user_id: profile.id, status: 'pending' });
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
    const name = profile?.display_name ?? profile?.email ?? 'this user';
    const isPending = share.status === 'pending';
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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
                          {profile?.display_name ?? '—'}
                        </Text>
                        {isPending && (
                          <View style={styles.pendingBadge}>
                            <Text style={styles.pendingBadgeText}>{t('share.pending')}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.shareEmail}>{profile?.email}</Text>
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
    fontSize: 16,
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
    color: colors.surface,
    fontSize: 15,
    fontWeight: '600',
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
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  pendingBadge: {
    backgroundColor: colors.pendingBadge,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pendingBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.pendingText,
  },
  shareEmail: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  removeText: {
    fontSize: 14,
    color: colors.destructive,
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});
