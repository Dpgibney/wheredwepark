import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

const VEHICLE_EMOJIS = [
  '🚗','🚙','🚕','🏎️','🚓','🚑','🚒','🚐','🛻','🚌','🚎','🚚','🚛','🚜',
  '🚲','🛴','🏍️','🛵',
];

export default function AddCarScreen() {
  const [name, setName] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [emoji, setEmoji] = useState(VEHICLE_EMOJIS[0]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleAdd() {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter a vehicle name.');
      return;
    }
    if (name.trim().length > 100) {
      Alert.alert('Too Long', 'Vehicle name must be 100 characters or fewer.');
      return;
    }
    if (licensePlate.trim().length > 20) {
      Alert.alert('Too Long', 'License plate must be 20 characters or fewer.');
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { count } = await supabase
      .from('cars')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', user.id);

    if ((count ?? 0) >= 10) {
      setLoading(false);
      Alert.alert('Limit Reached', 'You can only add up to 10 vehicles.');
      return;
    }

    const { error } = await supabase.from('cars').insert({
      owner_id: user.id,
      name: name.trim(),
      license_plate: licensePlate.trim() || null,
      emoji,
    });

    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      router.back();
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Icon</Text>
        <View style={styles.emojiGrid}>
          {VEHICLE_EMOJIS.map(e => (
            <TouchableOpacity
              key={e}
              style={[styles.emojiButton, emoji === e && styles.emojiButtonSelected]}
              onPress={() => setEmoji(e)}
            >
              <Text style={styles.emojiChar}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Vehicle Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Honda Civic, Dad's Truck"
          placeholderTextColor="#9CA3AF"
          value={name}
          onChangeText={setName}
          autoFocus
          returnKeyType="next"
        />

        <Text style={styles.label}>License Plate</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. ABC 1234 (optional)"
          placeholderTextColor="#9CA3AF"
          value={licensePlate}
          onChangeText={setLicensePlate}
          autoCapitalize="characters"
          returnKeyType="done"
          onSubmitEditing={handleAdd}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleAdd}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Add Vehicle</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  inner: {
    padding: 24,
    paddingTop: 32,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  emojiButton: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiButtonSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  emojiChar: {
    fontSize: 24,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
