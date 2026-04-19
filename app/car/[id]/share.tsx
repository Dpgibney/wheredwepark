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
import { supabase } from '@/lib/supabase';

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
      Alert.alert('Error', error.message);
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
      Alert.alert('Invite Sent', 'An invite has been sent to that user if they have an account.');
      return;
    }

    const alreadyShared = shares.some(s => s.shared_with_user_id === profile.id);
    if (alreadyShared) {
      Alert.alert('Already Invited', 'This vehicle has already been shared with that user.');
      return;
    }

    setAdding(true);
    const { error } = await supabase
      .from('car_shares')
      .insert({ car_id: carId, shared_with_user_id: profile.id, status: 'pending' });
    setAdding(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setEmail('');
      Alert.alert('Invite Sent', 'An invite has been sent to that user if they have an account.');
      fetchShares();
    }
  }

  async function handleRemove(share: Share) {
    const profile = share.profiles;
    const name = profile?.display_name ?? profile?.email ?? 'this user';
    const isPending = share.status === 'pending';
    Alert.alert(
      isPending ? 'Cancel Invite' : 'Remove Access',
      isPending
        ? `Cancel the invite for ${name}?`
        : `Remove ${name}'s access to this vehicle?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isPending ? 'Cancel Invite' : 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('car_shares')
              .delete()
              .eq('id', share.id);
            if (error) {
              Alert.alert('Error', error.message);
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
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Add by email */}
      <View style={styles.addSection}>
        <Text style={styles.sectionTitle}>Send Invite</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Email address"
            placeholderTextColor="#9CA3AF"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          <TouchableOpacity
            style={[styles.addButton, adding && styles.addButtonDisabled]}
            onPress={handleAdd}
            disabled={adding}
          >
            {adding
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.addButtonText}>Send</Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      {loading
        ? <ActivityIndicator color="#2563EB" style={{ marginTop: 24 }} />
        : (
          <FlatList
            data={[...pendingShares, ...acceptedShares]}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <>
                {pendingShares.length > 0 && (
                  <Text style={styles.sectionTitle}>Pending</Text>
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
                    <Text style={[styles.sectionTitle, { marginTop: pendingShares.length > 0 ? 20 : 0 }]}>
                      Has Access
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
                            <Text style={styles.pendingBadgeText}>Pending</Text>
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
                        {isPending ? 'Cancel' : 'Remove'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No invites sent yet.</Text>
            }
          />
        )
      }
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  addSection: {
    backgroundColor: '#fff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  listContent: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  addButton: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonDisabled: {
    opacity: 0.6,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  shareRow: {
    backgroundColor: '#fff',
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
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
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
    color: '#111827',
  },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pendingBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#92400E',
  },
  shareEmail: {
    fontSize: 13,
    color: '#6B7280',
  },
  removeText: {
    fontSize: 14,
    color: '#DC2626',
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 8,
  },
});
