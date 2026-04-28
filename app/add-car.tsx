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
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { shared } from '@/styles/shared';
import { colors } from '@/constants/colors';

const VEHICLE_EMOJIS = [
  '🚗','🚙','🚕','🏎️','🚓','🚑','🚒','🚐','🛻','🚌','🚎','🚚','🚛','🚜',
  '🚲','🛴','🏍️','🛵',
];

export default function AddCarScreen() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [emoji, setEmoji] = useState(VEHICLE_EMOJIS[0]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleAdd() {
    if (!name.trim()) {
      Alert.alert(t('addCar.required'), t('addCar.nameEmpty'));
      return;
    }
    if (name.trim().length > 100) {
      Alert.alert(t('addCar.tooLong'), t('addCar.vehicleNameTooLong'));
      return;
    }
    if (licensePlate.trim().length > 20) {
      Alert.alert(t('addCar.tooLong'), t('addCar.licensePlateTooLong'));
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
      Alert.alert(t('addCar.limitReached'), t('addCar.vehicleLimit'));
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
      Alert.alert(t('common.error'), error.message);
    } else {
      router.back();
    }
  }

  return (
    <KeyboardAvoidingView
      style={shared.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={shared.label}>{t('addCar.icon')}</Text>
        <View style={[shared.emojiGrid, styles.emojiGridSpacing]}>
          {VEHICLE_EMOJIS.map(e => (
            <TouchableOpacity
              key={e}
              style={[shared.emojiButton, emoji === e && shared.emojiButtonSelected]}
              onPress={() => setEmoji(e)}
            >
              <Text style={shared.emojiChar}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={shared.label}>{t('addCar.vehicleName')}</Text>
        <TextInput
          style={[shared.input, styles.inputSpacing]}
          placeholder={t('addCar.vehicleNamePlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
          autoFocus
          returnKeyType="next"
        />

        <Text style={shared.label}>{t('addCar.licensePlate')}</Text>
        <TextInput
          style={[shared.input, styles.inputSpacing]}
          placeholder={t('addCar.licensePlatePlaceholder')}
          placeholderTextColor={colors.textMuted}
          value={licensePlate}
          onChangeText={setLicensePlate}
          autoCapitalize="characters"
          returnKeyType="done"
          onSubmitEditing={handleAdd}
        />

        <TouchableOpacity
          style={[shared.button, loading && shared.buttonDisabled]}
          onPress={handleAdd}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={shared.buttonText}>{t('addCar.addVehicle')}</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  inner: {
    padding: 24,
    paddingTop: 32,
  },
  emojiGridSpacing: {
    marginBottom: 20,
  },
  inputSpacing: {
    marginBottom: 20,
  },
});
