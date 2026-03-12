import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Share,
  Platform,
  Linking,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
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
    notes: string | null;
    image_path: string | null;
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
  const [uploadingImage, setUploadingImage] = useState(false);
  const [userRegion, setUserRegion] = useState<Region | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageFullscreen, setImageFullscreen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPlate, setEditPlate] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const savedNoteRef = useRef('');
  const noteTextRef = useRef('');
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
    fetchCar();
    fetchUserLocation();
  }, [id]);

  // Keep ref in sync so the unmount handler always sees the latest value
  noteTextRef.current = noteText;

  useEffect(() => {
    const timer = setTimeout(() => handleSaveNote(noteText), 800);
    return () => clearTimeout(timer);
  }, [noteText]);

  // Fire-and-forget save when navigating away (debounce timer would be cancelled otherwise)
  useEffect(() => {
    return () => {
      if (noteTextRef.current !== savedNoteRef.current) {
        supabase
          .from('parking_locations')
          .update({ notes: noteTextRef.current || null })
          .eq('car_id', id);
      }
    };
  }, []);

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
      .select('id, name, license_plate, owner_id, parking_locations(latitude, longitude, updated_at, notes, image_path, profiles(display_name))')
      .eq('id', id)
      .single();

    if (error) {
      Alert.alert('Error', error.message);
      setLoading(false);
      return;
    }

    const carData = data as unknown as CarDetail;
    setCar(carData);
    const fetchedNote = carData.parking_locations?.notes ?? '';
    // Only reset the text field if there are no unsaved local changes
    if (noteTextRef.current === savedNoteRef.current) {
      setNoteText(fetchedNote);
    }
    savedNoteRef.current = fetchedNote;

    // Generate a signed URL for the parking image (valid 1 hour)
    const imagePath = carData.parking_locations?.image_path;
    if (imagePath) {
      const { data: signed } = await supabase.storage
        .from('parking-images')
        .createSignedUrl(imagePath, 3600);
      setImageUrl(signed?.signedUrl ?? null);
    } else {
      setImageUrl(null);
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
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });

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
        await fetchCar();
      }
    } catch {
      Alert.alert('Error', 'Could not get your current location. Make sure Location Services are enabled.');
    } finally {
      setSavingLocation(false);
    }
  }

  async function handleLeaveVehicle() {
    Alert.alert(
      'Leave Vehicle',
      `Remove yourself from ${car?.name ?? 'this vehicle'}? You will lose access.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            // Get user fresh to avoid relying on potentially-null state
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { error, count } = await supabase
              .from('car_shares')
              .delete({ count: 'exact' })
              .eq('car_id', id)
              .eq('shared_with_user_id', user.id);

            if (error) {
              Alert.alert('Error', error.message);
            } else if (!count || count === 0) {
              Alert.alert('Error', 'Could not remove access. Make sure the required database policy has been applied.');
            } else {
              router.replace('/(tabs)');
            }
          },
        },
      ]
    );
  }

  async function handlePickImage() {
    Alert.alert('Add Photo', 'Choose a source', [
      {
        text: 'Camera',
        onPress: () => launchPicker('camera'),
      },
      {
        text: 'Photo Library',
        onPress: () => launchPicker('library'),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function launchPicker(source: 'camera' | 'library') {
    let result: ImagePicker.ImagePickerResult;

    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Camera access is required to take a photo.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.5 });
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Photo library access is required.');
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, quality: 0.5 });
    }

    if (result.canceled) return;
    await uploadImage(result.assets[0].uri);
  }

  async function uploadImage(uri: string) {
    setUploadingImage(true);
    try {
      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();

      // Path: {car_id}/parking.jpg — one file per car, upsert replaces it
      const path = `${id}/parking.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('parking-images')
        .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from('parking_locations')
        .update({ image_path: path })
        .eq('car_id', id);

      if (dbError) throw dbError;

      await fetchCar();
    } catch (e: any) {
      Alert.alert('Upload Failed', e?.message ?? 'Could not upload the photo.');
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSaveNote(text: string) {
    if (text === savedNoteRef.current) return;
    setSavingNote(true);
    const { error } = await supabase
      .from('parking_locations')
      .update({ notes: text || null })
      .eq('car_id', id);
    if (!error) savedNoteRef.current = text;
    else Alert.alert('Error', error.message);
    setSavingNote(false);
  }

  function openEditModal() {
    setEditName(car!.name);
    setEditPlate(car!.license_plate ?? '');
    setEditModalVisible(true);
  }

  async function handleSaveEdit() {
    const trimmedName = editName.trim();
    if (!trimmedName) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from('cars')
      .update({ name: trimmedName, license_plate: editPlate.trim() || null })
      .eq('id', id);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setCar(prev => prev ? { ...prev, name: trimmedName, license_plate: editPlate.trim() || null } : prev);
      setEditModalVisible(false);
    }
    setSavingEdit(false);
  }

  async function handleDirections() {
    if (!loc) return;
    const { latitude, longitude } = loc;

    if (Platform.OS === 'android') {
      try {
        await Linking.openURL(`geo:${latitude},${longitude}?q=${latitude},${longitude}`);
      } catch {
        Alert.alert('Error', 'Could not open a maps app.');
      }
      return;
    }

    // iOS: detect installed map apps and offer a choice
    const candidates = [
      { text: 'Apple Maps', url: `maps://?daddr=${latitude},${longitude}` },
      { text: 'Google Maps', url: `comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving` },
      { text: 'Waze', url: `waze://?ll=${latitude},${longitude}&navigate=yes` },
    ];

    const available: { text: string; url: string }[] = [];
    for (const app of candidates) {
      if (await Linking.canOpenURL(app.url)) available.push(app);
    }
    // Web fallback always works
    available.push({ text: 'Google Maps (Web)', url: `https://maps.google.com/?daddr=${latitude},${longitude}` });

    const openMap = async (url: string) => {
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert('Error', 'Could not open that maps app.');
      }
    };

    Alert.alert(
      'Get Directions',
      'Open in:',
      [
        ...available.map(app => ({ text: app.text, onPress: () => openMap(app.url) })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function handleShareShortcut() {
    const link = `wheredwepark://car/${id}`;
    await Share.share(
      Platform.OS === 'ios'
        ? { url: link, title: `Open ${car?.name ?? 'vehicle'} in Where'd We Park` }
        : { message: link, title: `Open ${car?.name ?? 'vehicle'} in Where'd We Park` }
    );
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString(undefined, {
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
      <Stack.Screen
        options={{
          title: car.name,
          headerRight: isOwner ? () => (
            <TouchableOpacity onPress={openEditModal} style={{ marginRight: 16 }}>
              <Text style={{ color: '#2563EB', fontSize: 22, fontWeight: '400' }}>Edit</Text>
            </TouchableOpacity>
          ) : undefined,
        }}
      />

      <MapView style={styles.map} region={mapRegion} showsUserLocation>
        {loc && (
          <Marker
            coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
            title={car.name}
            description={car.license_plate ?? undefined}
          />
        )}
      </MapView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.card}>
        <ScrollView ref={scrollViewRef} style={styles.cardScroll} contentContainerStyle={styles.cardContent}>
          {car.license_plate && (
            <Text style={styles.plate}>License plate: {car.license_plate}</Text>
          )}

          {loc ? (
            <View style={styles.locationInfo}>
              <View style={styles.locationRow}>
                <View style={styles.locationText}>
                  <Text style={styles.locationLabel}>Last parked</Text>
                  <Text style={styles.locationDate}>{formatDate(loc.updated_at)}</Text>
                  {loc.profiles?.display_name && (
                    <Text style={styles.locationBy}>by {loc.profiles.display_name}</Text>
                  )}
                </View>
                <TouchableOpacity style={styles.directionsButton} onPress={handleDirections}>
                  <Text style={styles.directionsButtonText}>Directions</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text style={styles.noLocation}>No parking location saved yet.</Text>
          )}

          {/* Photo + note section — only shown once a location exists */}
          {loc && (
            <View style={styles.photoSection}>
              {imageUrl ? (
                <>
                  <TouchableOpacity onPress={() => setImageFullscreen(true)} activeOpacity={0.9}>
                    <Image source={{ uri: imageUrl }} style={styles.parkingImage} resizeMode="cover" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.photoButton}
                    onPress={handlePickImage}
                    disabled={uploadingImage}
                  >
                    {uploadingImage
                      ? <ActivityIndicator color="#2563EB" size="small" />
                      : <Text style={styles.photoButtonText}>Change Photo</Text>
                    }
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.addPhotoButton, uploadingImage && styles.buttonDisabled]}
                  onPress={handlePickImage}
                  disabled={uploadingImage}
                >
                  {uploadingImage
                    ? <ActivityIndicator color="#6B7280" size="small" />
                    : <Text style={styles.addPhotoText}>+ Add Parking Photo</Text>
                  }
                </TouchableOpacity>
              )}

              <View style={styles.noteRow}>
                <TextInput
                  style={styles.noteInput}
                  value={noteText}
                  onChangeText={setNoteText}
                  onFocus={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
                  placeholder="Add a note about this parking spot…"
                  placeholderTextColor="#9CA3AF"
                  multiline
                  maxLength={500}
                />
                {savingNote && <ActivityIndicator size="small" color="#2563EB" style={styles.noteSpinner} />}
              </View>
            </View>
          )}
        </ScrollView>

        <View style={styles.buttonSection}>
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

          {isOwner ? (
            <TouchableOpacity
              style={styles.shareButton}
              onPress={() => router.push(`/car/${id}/share`)}
            >
              <Text style={styles.shareButtonText}>Manage Sharing</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.shareButton}
              onPress={handleLeaveVehicle}
            >
              <Text style={styles.leaveButtonText}>Leave Vehicle</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.shareButton}
            onPress={handleShareShortcut}
          >
            <Text style={styles.shareButtonText}>Add Home Screen Shortcut</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={editModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.editBackdrop}
        >
          <View style={styles.editSheet}>
            <Text style={styles.editTitle}>Edit Vehicle</Text>

            <Text style={styles.editLabel}>Name</Text>
            <TextInput
              style={styles.editInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Vehicle name"
              placeholderTextColor="#9CA3AF"
              maxLength={100}
              autoFocus
            />

            <Text style={styles.editLabel}>License Plate</Text>
            <TextInput
              style={styles.editInput}
              value={editPlate}
              onChangeText={setEditPlate}
              placeholder="Optional"
              placeholderTextColor="#9CA3AF"
              maxLength={20}
              autoCapitalize="characters"
            />

            <TouchableOpacity
              style={[styles.button, (!editName.trim() || savingEdit) && styles.buttonDisabled]}
              onPress={handleSaveEdit}
              disabled={!editName.trim() || savingEdit}
            >
              {savingEdit
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>Save</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareButton}
              onPress={() => setEditModalVisible(false)}
              disabled={savingEdit}
            >
              <Text style={styles.shareButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={imageFullscreen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.fullscreenBackdrop}
          activeOpacity={1}
          onPress={() => setImageFullscreen(false)}
        >
          <Image source={{ uri: imageUrl! }} style={styles.fullscreenImage} resizeMode="contain" />
        </TouchableOpacity>
      </Modal>
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
  },
  cardScroll: {
    maxHeight: 260,
  },
  cardContent: {
    padding: 24,
    paddingBottom: 8,
    gap: 16,
  },
  buttonSection: {
    padding: 24,
    paddingTop: 8,
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
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locationText: {
    gap: 2,
    flex: 1,
  },
  directionsButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  directionsButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
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
  photoSection: {
    gap: 8,
  },
  parkingImage: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  photoButton: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
  },
  photoButtonText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '500',
  },
  addPhotoButton: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addPhotoText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '500',
  },
  noteRow: {
    position: 'relative',
  },
  noteInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    paddingRight: 32,
    fontSize: 14,
    color: '#111827',
    minHeight: 72,
    textAlignVertical: 'top',
  },
  noteSpinner: {
    position: 'absolute',
    bottom: 8,
    right: 8,
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
  leaveButtonText: {
    color: '#DC2626',
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
  editBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  editSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 8,
  },
  editTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  editLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 8,
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#111827',
  },
  fullscreenBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
  },
});
