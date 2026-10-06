import { useEffect, useState, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { upsertParkingLocation } from '@/lib/parking';
import { parkBridge } from '@/lib/parkBridge';
import { Text } from '@/components/ui/text';
import { useScaledSize } from '@/hooks/use-scaled-size';
import { MAX_FONT_SCALE_TIGHT, text } from '@/constants/typography';
import { shared } from '@/styles/shared';
import { colors } from '@/constants/colors';

type ParkingLocation = {
  latitude: number;
  longitude: number;
  updated_at: string;
};

type Car = {
  id: string;
  name: string;
  license_plate: string | null;
  owner_id: string;
  emoji: string | null;
  parking_locations: ParkingLocation | null;
};

type PendingInvite = {
  id: string;
  car_id: string;
  cars: {
    name: string;
    emoji: string | null;
    profiles: { display_name: string | null; email: string } | null;
  } | null;
};

export default function HomeScreen() {
  const [cars, setCars] = useState<Car[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingLocationId, setSavingLocationId] = useState<string | null>(null);
  const router = useRouter();
  const { t } = useTranslation();
  const quickParkSize = useScaledSize(36);

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

    const [{ data, error }, { data: pending }] = await Promise.all([
      supabase
        .from('cars')
        .select('id, name, license_plate, owner_id, emoji, parking_locations(latitude, longitude, updated_at)')
        .order('created_at', { ascending: false }),
      supabase
        .from('car_shares')
        .select('car_id')
        .eq('shared_with_user_id', user.id)
        .eq('status', 'pending'),
    ]);

    if (error) {
      Alert.alert(t('common.error'), error.message);
    } else {
      const fetched = (data ?? []) as unknown as Car[];
      setCars(fetched);
      // Keep the native Park Car App Intent's car picker in sync. Cars from
      // invites not yet accepted are readable (for the invite card) but can't
      // be parked, so leave them out of Siri's list.
      const pendingIds = new Set((pending ?? []).map(p => p.car_id));
      parkBridge.syncCars(
        fetched.filter(c => !pendingIds.has(c.id)).map(c => ({ id: c.id, name: c.name }))
      );
    }
  }

  async function fetchPendingInvites() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('car_shares')
      .select('id, car_id, cars(name, emoji, profiles(display_name, email))')
      .eq('shared_with_user_id', user.id)
      .eq('status', 'pending');

    if (!error) setPendingInvites((data ?? []) as unknown as PendingInvite[]);
  }

  useFocusEffect(
    useCallback(() => {
      fetchAll().finally(() => setHasLoadedOnce(true));
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
      t('home.declineInvite'),
      t('home.declineConfirm', { name: invite.cars?.name ?? 'this vehicle' }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('home.decline'),
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


  async function handleQuickUpdateLocation(carId: string) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('home.permissionDenied'), t('home.locationPermissionRequired'));
      return;
    }

    setSavingLocationId(carId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });

      const { error } = await upsertParkingLocation({
        carId,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        userId: user!.id,
      });

      if (error) {
        Alert.alert(t('common.error'), error.message);
      } else {
        await fetchCars();
      }
    } catch {
      Alert.alert(t('common.error'), t('home.locationError'));
    } finally {
      setSavingLocationId(null);
    }
  }

  function formatLastParked(updatedAt: string) {
    const diffMs = Date.now() - new Date(updatedAt).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return t('home.timeAgoMinutes', { count: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t('home.timeAgoHours', { count: diffHours });
    return t('home.timeAgoDays', { count: Math.floor(diffHours / 24) });
  }

  if (!hasLoadedOnce) {
    return (
      <View style={shared.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={cars.filter(car => !pendingInvites.some(i => i.car_id === car.id))}
      keyExtractor={item => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        pendingInvites.length > 0 ? (
          <View style={styles.invitesSection}>
            <Text style={shared.sectionLabel}>{t('home.pendingInvites')}</Text>
            {pendingInvites.map(invite => {
              const vehicle = invite.cars;
              const owner = vehicle?.profiles;
              const ownerName = owner?.display_name ?? 'Someone';
              return (
                <View key={invite.id} style={styles.inviteCard}>
                  <Text style={styles.inviteName}>
                    {vehicle?.emoji ?? '🚗'} {vehicle?.name ?? 'A vehicle'}
                  </Text>
                  <Text style={styles.inviteSubtitle}>{t('home.sharedBy', { name: ownerName })}</Text>
                  {/* Anyone can pick any display name; the email is verified,
                      so show it to make an impersonated invite obvious. */}
                  {owner?.email && <Text style={styles.inviteEmail}>{owner.email}</Text>}
                  <View style={styles.inviteActions}>
                    <TouchableOpacity
                      style={styles.declineButton}
                      onPress={() => handleDeclineInvite(invite)}
                    >
                      <Text style={styles.declineText}>{t('home.decline')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={() => handleAcceptInvite(invite)}
                    >
                      <Text style={styles.acceptText}>{t('home.accept')}</Text>
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
            <Text style={styles.emptyTitle}>{t('home.noVehiclesYet')}</Text>
            <Text style={styles.emptySubtitle}>{t('home.tapToAdd')}</Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const isOwner = item.owner_id === userId;
        const loc = item.parking_locations ?? null;
        return (
          <TouchableOpacity
            style={styles.vehicleCard}
            onPress={() => router.push(`/car/${item.id}`)}
            activeOpacity={0.7}
          >
            <View style={styles.cardLeft}>
              <Text style={styles.carName}>
                {item.emoji ?? '🚗'} {item.name}
              </Text>
              {item.license_plate && (
                <Text style={styles.plate}>{item.license_plate}</Text>
              )}
              {loc ? (
                <Text style={styles.parkedText}>
                  {t('home.lastParked', { time: formatLastParked(loc.updated_at) })}
                </Text>
              ) : (
                <Text style={styles.noLocationText}>{t('home.noLocationSaved')}</Text>
              )}
              {!isOwner && (
                <Text style={styles.sharedBadge}>{t('home.sharedWithYou')}</Text>
              )}
            </View>
            <View style={styles.cardRight}>
              <TouchableOpacity
                style={[
                  styles.updateLocationButton,
                  { width: quickParkSize, height: quickParkSize, borderRadius: quickParkSize / 2 },
                ]}
                onPress={() => handleQuickUpdateLocation(item.id)}
                disabled={savingLocationId === item.id}
              >
                {savingLocationId === item.id ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : (
                  <Text style={styles.updateLocationText} maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}>📍</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.chevron} maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}>›</Text>
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
    backgroundColor: colors.background,
  },
  listContent: {
    padding: 16,
    gap: 12,
    flexGrow: 1,
  },
  vehicleCard: {
    backgroundColor: colors.surface,
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
  invitesSection: {
    marginBottom: 8,
  },
  inviteCard: {
    backgroundColor: colors.brandLight,
    borderWidth: 1,
    borderColor: colors.brandLightBorder,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    gap: 4,
  },
  inviteName: {
    ...text.bodyLargeStrong,
    color: colors.textPrimary,
  },
  inviteSubtitle: {
    ...text.caption,
    color: colors.textSecondary,
  },
  inviteEmail: {
    ...text.caption,
    color: colors.textSecondary,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  declineButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  declineText: {
    ...text.smallMedium,
    color: colors.textSecondary,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  acceptText: {
    ...text.smallStrong,
    color: colors.surface,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    ...text.sectionTitle,
    color: colors.textDark,
    marginBottom: 8,
  },
  emptySubtitle: {
    ...text.body,
    color: colors.textMuted,
    textAlign: 'center',
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
    ...text.cardTitle,
    color: colors.textPrimary,
  },
  plate: {
    ...text.captionMedium,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  parkedText: {
    ...text.caption,
    color: colors.brand,
    marginTop: 4,
  },
  noLocationText: {
    ...text.caption,
    color: colors.textMuted,
    marginTop: 4,
  },
  sharedBadge: {
    ...text.badgeMedium,
    color: colors.purple,
    marginTop: 4,
  },
  chevron: {
    ...text.chevron,
    color: colors.border,
    lineHeight: 26,
  },
  updateLocationButton: {
    backgroundColor: colors.brandLight,
    borderWidth: 1,
    borderColor: colors.brandLightBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateLocationText: {
    ...text.emojiSmall,
  },
});
