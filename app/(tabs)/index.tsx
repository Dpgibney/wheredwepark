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

type ParkingLocation = {
  latitude: number;
  longitude: number;
  updated_at: string;
};

type VehicleType = 'car' | 'bike' | 'motorcycle';

const VEHICLE_EMOJI: Record<VehicleType, string> = {
  car: '🚗',
  bike: '🚲',
  motorcycle: '🏍️',
};

type Car = {
  id: string;
  name: string;
  license_plate: string | null;
  owner_id: string;
  vehicle_type: VehicleType;
  parking_locations: ParkingLocation | null;
};

type PendingInvite = {
  id: string;
  car_id: string;
  cars: {
    name: string;
    vehicle_type: VehicleType;
    profiles: { display_name: string | null; email: string } | null;
  } | null;
};

export default function HomeScreen() {
  const [cars, setCars] = useState<Car[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
    });
  }, []);

  async function fetchAll() {
    await Promise.all([fetchCars(), fetchPendingInvites()]);
  }

  async function fetchCars() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('cars')
      .select('id, name, license_plate, owner_id, vehicle_type, parking_locations(latitude, longitude, updated_at)')
      .order('created_at', { ascending: false });

    if (error) Alert.alert('Error', error.message);
    else setCars(data ?? []);
  }

  async function fetchPendingInvites() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('car_shares')
      .select('id, car_id, cars(name, vehicle_type, profiles(display_name, email))')
      .eq('shared_with_user_id', user.id)
      .eq('status', 'pending');

    if (!error) setPendingInvites(data ?? []);
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchAll().finally(() => setLoading(false));
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }

  async function handleAcceptInvite(invite: PendingInvite) {
    const { error } = await supabase
      .from('car_shares')
      .update({ status: 'accepted' })
      .eq('id', invite.id);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setPendingInvites(prev => prev.filter(i => i.id !== invite.id));
      fetchCars(); // refresh car list to show newly accepted vehicle
    }
  }

  async function handleDeclineInvite(invite: PendingInvite) {
    Alert.alert(
      'Decline Invite',
      `Decline access to "${invite.cars?.[0]?.name ?? 'this vehicle'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('car_shares')
              .delete()
              .eq('id', invite.id);
            if (!error) {
              setPendingInvites(prev => prev.filter(i => i.id !== invite.id));
            }
          },
        },
      ]
    );
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
            if (error) Alert.alert('Error', error.message);
            else setCars(prev => prev.filter(c => c.id !== car.id));
          },
        },
      ]
    );
  }

  function formatLastParked(updatedAt: string) {
    const diffMs = Date.now() - new Date(updatedAt).getTime();
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
      data={cars.filter(car => !pendingInvites.some(i => i.car_id === car.id))}
      keyExtractor={item => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563EB" />}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        pendingInvites.length > 0 ? (
          <View style={styles.invitesSection}>
            <Text style={styles.sectionLabel}>Pending Invites</Text>
            {pendingInvites.map(invite => {
              const vehicle = invite.cars;
              const owner = vehicle?.profiles;
              const ownerName = owner?.display_name ?? owner?.email ?? 'Someone';
              return (
                <View key={invite.id} style={styles.inviteCard}>
                  <Text style={styles.inviteName}>
                    {VEHICLE_EMOJI[vehicle?.vehicle_type ?? 'car']} {vehicle?.name ?? 'A vehicle'}
                  </Text>
                  <Text style={styles.inviteSubtitle}>Shared by {ownerName}</Text>
                  <View style={styles.inviteActions}>
                    <TouchableOpacity
                      style={styles.declineButton}
                      onPress={() => handleDeclineInvite(invite)}
                    >
                      <Text style={styles.declineText}>Decline</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={() => handleAcceptInvite(invite)}
                    >
                      <Text style={styles.acceptText}>Accept</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null
      }
      ListEmptyComponent={
        pendingInvites.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No vehicles yet</Text>
            <Text style={styles.emptySubtitle}>Tap + to add your first vehicle.</Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const isOwner = item.owner_id === userId;
        const loc = item.parking_locations ?? null;
        return (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/car/${item.id}`)}
            activeOpacity={0.7}
          >
            <View style={styles.cardLeft}>
              <Text style={styles.carName}>
                {VEHICLE_EMOJI[item.vehicle_type] ?? '🚗'} {item.name}
              </Text>
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
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  invitesSection: {
    marginBottom: 8,
  },
  inviteCard: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    gap: 4,
  },
  inviteName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  inviteSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  declineButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  declineText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  acceptText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
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
