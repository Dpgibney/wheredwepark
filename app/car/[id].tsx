import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';

type CarDetail = {
  id: string;
  name: string;
  license_plate: string | null;
  owner_id: string;
  parking_locations: {
    latitude: number;
    longitude: number;
    updated_at: string;
    profiles: { display_name: string | null } | null;
  } | null;
};

export default function CarDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [car, setCar] = useState<CarDetail | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingLocation, setSavingLocation] = useState(false);
  const [userRegion, setUserRegion] = useState<Region | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
    fetchCar();
    fetchUserLocation();
  }, [id]);

  async function fetchUserLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setUserRegion({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });
  }

  async function fetchCar() {
    const { data, error } = await supabase
      .from('cars')
      .select('id, name, license_plate, owner_id, parking_locations(latitude, longitude, updated_at, profiles(display_name))')
      .eq('id', id)
      .single();

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setCar(data as CarDetail);
    }
    setLoading(false);
  }

  async function handleSaveLocation() {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Location permission is required to save your parking spot.');
      return;
    }

    setSavingLocation(true);
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { error } = await supabase.from('parking_locations').upsert(
        {
          car_id: id,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          updated_by_user_id: userId!,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'car_id' }
      );

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        await fetchCar(); // refresh to show updated location on map
      }
    } catch {
      Alert.alert('Error', 'Could not get your current location. Make sure Location Services are enabled.');
    } finally {
      setSavingLocation(false);
    }
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  if (!car) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Vehicle not found.</Text>
      </View>
    );
  }

  const loc = car.parking_locations;
  const isOwner = car.owner_id === userId;
  const mapRegion: Region | undefined = loc
    ? { latitude: loc.latitude, longitude: loc.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }
    : userRegion ?? undefined;

  return (
    <View style={styles.container}>
      {/* Dynamically set the header title */}
      <Stack.Screen options={{ title: car.name }} />

      {/* Map */}
      <MapView style={styles.map} region={mapRegion} showsUserLocation>
        {loc && (
          <Marker
            coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
            title={car.name}
            description={car.license_plate ?? undefined}
          />
        )}
      </MapView>

      {/* Bottom info card */}
      <ScrollView style={styles.card} contentContainerStyle={styles.cardContent}>
        <View style={styles.carHeader}>
          <Text style={styles.carName}>{car.name}</Text>
          {car.license_plate && (
            <Text style={styles.plate}>{car.license_plate}</Text>
          )}
        </View>

        {loc ? (
          <View style={styles.locationInfo}>
            <Text style={styles.locationLabel}>Last parked</Text>
            <Text style={styles.locationDate}>{formatDate(loc.updated_at)}</Text>
            {loc.profiles?.display_name && (
              <Text style={styles.locationBy}>by {loc.profiles.display_name}</Text>
            )}
          </View>
        ) : (
          <View style={styles.locationInfo}>
            <Text style={styles.noLocation}>No parking location saved yet.</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, savingLocation && styles.buttonDisabled]}
          onPress={handleSaveLocation}
          disabled={savingLocation}
        >
          {savingLocation
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>
                {loc ? 'Update Parking Location' : 'Save Parking Location'}
              </Text>
          }
        </TouchableOpacity>

        {isOwner && (
          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => router.push(`/car/${id}/share`)}
          >
            <Text style={styles.shareButtonText}>Manage Sharing</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  map: {
    flex: 1,
  },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
    maxHeight: '45%',
  },
  cardContent: {
    padding: 24,
    gap: 16,
  },
  carHeader: {
    gap: 4,
  },
  carName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  plate: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  locationInfo: {
    gap: 2,
  },
  locationLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  locationDate: {
    fontSize: 15,
    color: '#111827',
    fontWeight: '500',
  },
  locationBy: {
    fontSize: 13,
    color: '#6B7280',
  },
  noLocation: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  button: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  shareButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  shareButtonText: {
    color: '#2563EB',
    fontSize: 15,
    fontWeight: '500',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  errorText: {
    fontSize: 16,
    color: '#6B7280',
  },
});
