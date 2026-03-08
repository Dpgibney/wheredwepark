import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function CarDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Car detail coming in Phase 4</Text>
      <Text style={styles.sub}>{id}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  text: { fontSize: 17, fontWeight: '600', color: '#374151' },
  sub: { fontSize: 13, color: '#9CA3AF', marginTop: 8 },
});
