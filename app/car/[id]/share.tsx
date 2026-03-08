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
  profiles: {
    display_name: string | null;
    email: string;
  } | null;
};

export default function ShareScreen() {
  const { id: carId } = useLocalSearchParams<{ id: string }>();

  const [shares, setShares] = useState<Share[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
    fetchShares();
  }, [carId]);

  async function fetchShares() {
    const { data, error } = await supabase
      .from('car_shares')
      .select('id, shared_with_user_id, profiles(display_name, email)')
      .eq('car_id', carId)
      .order('created_at', { ascending: true });

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setShares((data ?? []) as Share[]);
    }
    setLoading(false);
  }

  async function handleAdd() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    // Look up the user by email
    const { data: profile, error: lookupError } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .eq('email', trimmed)
      .single();

    // If no account exists we silently succeed to avoid revealing registered emails
    if (lookupError || !profile || profile.id === userId) {
      setEmail('');
      Alert.alert('Invite Sent', 'Vehicle shared with that user if they have an account.');
      return;
    }

    const alreadyShared = shares.some(s => s.shared_with_user_id === profile.id);
    if (alreadyShared) {
      Alert.alert('Already Shared', 'This vehicle is already shared with that user.');
      return;
    }

    setAdding(true);
    const { error } = await supabase
      .from('car_shares')
      .insert({ car_id: carId, shared_with_user_id: profile.id });
    setAdding(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setEmail('');
      Alert.alert('Invite Sent', 'Vehicle shared with that user if they have an account.');
      fetchShares();
    }
  }

  async function handleRemove(share: Share) {
    const name = share.profiles?.display_name ?? share.profiles?.email ?? 'this user';
    Alert.alert(
      'Remove Access',
      `Remove ${name}'s access to this vehicle?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Add by email */}
      <View style={styles.addSection}>
        <Text style={styles.sectionTitle}>Add Person</Text>
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
              : <Text style={styles.addButtonText}>Add</Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      {/* Current shares */}
      <View style={styles.listSection}>
        <Text style={styles.sectionTitle}>
          {shares.length > 0 ? 'Shared With' : 'Not shared with anyone yet'}
        </Text>

        {loading
          ? <ActivityIndicator color="#2563EB" style={{ marginTop: 16 }} />
          : (
            <FlatList
              data={shares}
              keyExtractor={item => item.id}
              contentContainerStyle={{ gap: 8 }}
              renderItem={({ item }) => (
                <View style={styles.shareRow}>
                  <View style={styles.shareInfo}>
                    <Text style={styles.shareName}>
                      {item.profiles?.display_name ?? '—'}
                    </Text>
                    <Text style={styles.shareEmail}>
                      {item.profiles?.email}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRemove(item)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )
        }
      </View>
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
  listSection: {
    flex: 1,
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
  shareInfo: {
    flex: 1,
    gap: 2,
  },
  shareName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
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
});
