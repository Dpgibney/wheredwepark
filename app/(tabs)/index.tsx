import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/lib/supabase';

type Car = {
  id: string;
  name: string;
  license_plate: string | null;
  owner_id: string;
  parking_locations: {
    latitude: number;
    longitude: number;
    updated_at: string;
  } | null;
};

export default function HomeScreen() {
  const [cars, setCars] = useState<Car[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
    });
  }, []);

  async function fetchCars() {
    const { data, error } = await supabase
      .from('cars')
      .select('id, name, license_plate, owner_id, parking_locations(latitude, longitude, updated_at)')
      .order('created_at', { ascending: false });

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setCars((data ?? []) as Car[]);
    }
  }

  // Reload list every time this screen comes into focus (e.g. after adding a car)
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchCars().finally(() => setLoading(false));
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchCars();
    setRefreshing(false);
  }

  async function handleDelete(car: Car) {
    Alert.alert(
      'Remove Vehicle',
      `Remove "${car.name}" from your garage?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('cars').delete().eq('id', car.id);
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              setCars(prev => prev.filter(c => c.id !== car.id));
            }
          },
        },
      ]
    );
  }

  function formatLastParked(updatedAt: string) {
    const date = new Date(updatedAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={cars}
      keyExtractor={item => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563EB" />}
      contentContainerStyle={cars.length === 0 ? styles.emptyContainer : styles.listContent}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No vehicles yet</Text>
          <Text style={styles.emptySubtitle}>Tap + to add your first vehicle.</Text>
        </View>
      }
      renderItem={({ item }) => {
        const isOwner = item.owner_id === userId;
        const loc = item.parking_locations;
        return (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/car/${item.id}`)}
            activeOpacity={0.7}
          >
            <View style={styles.cardLeft}>
              <Text style={styles.carName}>{item.name}</Text>
              {item.license_plate && (
                <Text style={styles.plate}>{item.license_plate}</Text>
              )}
              {loc ? (
                <Text style={styles.parkedText}>
                  Last parked {formatLastParked(loc.updated_at)}
                </Text>
              ) : (
                <Text style={styles.noLocationText}>No location saved yet</Text>
              )}
              {!isOwner && (
                <Text style={styles.sharedBadge}>Shared with you</Text>
              )}
            </View>
            <View style={styles.cardRight}>
              {isOwner && (
                <TouchableOpacity
                  onPress={() => handleDelete(item)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.deleteIcon}>🗑</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.chevron}>›</Text>
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  emptyContainer: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardLeft: {
    flex: 1,
    gap: 3,
  },
  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  carName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
  },
  plate: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  parkedText: {
    fontSize: 13,
    color: '#2563EB',
    marginTop: 4,
  },
  noLocationText: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
  },
  sharedBadge: {
    fontSize: 11,
    color: '#7C3AED',
    fontWeight: '500',
    marginTop: 4,
  },
  deleteIcon: {
    fontSize: 16,
  },
  chevron: {
    fontSize: 22,
    color: '#D1D5DB',
    lineHeight: 26,
  },
});
