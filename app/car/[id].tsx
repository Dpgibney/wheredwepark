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
  Platform,
  Linking,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { upsertParkingLocation } from '@/lib/parking';
import { shared } from '@/styles/shared';
import { colors } from '@/constants/colors';

const VEHICLE_EMOJIS = [
  '🚗','🚙','🚕','🏎️','🚓','🚑','🚒','🚐','🛻','🚌','🚎','🚚','🚛','🚜',
  '🚲','🛴','🏍️','🛵',
];

type CarDetail = {
  id: string;
  name: string;
  license_plate: string | null;
  owner_id: string;
  emoji: string | null;
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
  const { t } = useTranslation();

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
  const [editEmoji, setEditEmoji] = useState('🚗');
  const [savingEdit, setSavingEdit] = useState(false);
  const [pickingLocation, setPickingLocation] = useState(false);
  const [pickedCoord, setPickedCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const savedNoteRef = useRef('');
  const noteTextRef = useRef('');
  const scrollViewRef = useRef<ScrollView>(null);
  const mapRef = useRef<MapView>(null);

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

  // The map is uncontrolled (initialRegion) so the user can freely pan while
  // picking a spot — recenter imperatively when the saved location changes.
  useEffect(() => {
    const l = car?.parking_locations;
    if (l && !pickingLocation) {
      mapRef.current?.animateToRegion(
        { latitude: l.latitude, longitude: l.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 },
        400
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car?.parking_locations?.latitude, car?.parking_locations?.longitude]);

  // Center on the user once their location resolves, if no spot is saved yet.
  useEffect(() => {
    if (!car?.parking_locations && userRegion && !pickingLocation) {
      mapRef.current?.animateToRegion(userRegion, 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRegion]);

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
      .select('id, name, license_plate, owner_id, emoji, parking_locations(latitude, longitude, updated_at, notes, image_path, profiles(display_name))')
      .eq('id', id)
      .single();

    if (error) {
      Alert.alert(t('common.error'), error.message);
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

  async function persistLocation(latitude: number, longitude: number): Promise<boolean> {
    const { error } = await upsertParkingLocation({
      carId: id,
      latitude,
      longitude,
      userId: userId!,
    });

    if (error) {
      Alert.alert(t('common.error'), error.message);
      return false;
    }
    await fetchCar();
    return true;
  }

  // Tapping the save/update button offers a choice between the current GPS
  // position and manually placing a pin on the map.
  function handleUpdateLocationPress() {
    Alert.alert(
      loc ? t('carDetail.updateParkingLocation') : t('carDetail.saveParkingLocation'),
      t('carDetail.chooseLocationMethod'),
      [
        { text: t('carDetail.useCurrentLocation'), onPress: handleUseCurrentLocation },
        { text: t('carDetail.chooseOnMap'), onPress: startPickingLocation },
        { text: t('common.cancel'), style: 'cancel' },
      ]
    );
  }

  async function handleUseCurrentLocation() {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('carDetail.permissionDenied'), t('carDetail.locationPermissionRequired'));
      return;
    }

    setSavingLocation(true);
    try {
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await persistLocation(location.coords.latitude, location.coords.longitude);
    } catch {
      Alert.alert(t('common.error'), t('carDetail.locationError'));
    } finally {
      setSavingLocation(false);
    }
  }

  function startPickingLocation() {
    const start = loc
      ? { latitude: loc.latitude, longitude: loc.longitude }
      : userRegion
        ? { latitude: userRegion.latitude, longitude: userRegion.longitude }
        : null;
    setPickedCoord(start);
    setPickingLocation(true);

    const region = loc
      ? { latitude: loc.latitude, longitude: loc.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }
      : userRegion ?? null;
    if (region) mapRef.current?.animateToRegion(region, 300);
  }

  async function handleConfirmPickedLocation() {
    if (!pickedCoord) return;
    setSavingLocation(true);
    const ok = await persistLocation(pickedCoord.latitude, pickedCoord.longitude);
    setSavingLocation(false);
    if (ok) {
      setPickingLocation(false);
      setPickedCoord(null);
    }
  }

  function cancelPicking() {
    setPickingLocation(false);
    setPickedCoord(null);
  }

  async function handleLeaveVehicle() {
    Alert.alert(
      t('carDetail.leaveVehicle'),
      t('carDetail.leaveVehicleConfirm', { name: car?.name ?? 'this vehicle' }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('carDetail.leave'),
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
              Alert.alert(t('common.error'), error.message);
            } else if (!count || count === 0) {
              Alert.alert(t('common.error'), t('carDetail.removeAccessError'));
            } else {
              router.replace('/(tabs)');
            }
          },
        },
      ]
    );
  }

  async function handlePickImage() {
    const hasPhoto = !!imageUrl;
    Alert.alert(hasPhoto ? t('carDetail.changePhoto') : t('carDetail.addPhoto'), t('carDetail.chooseSource'), [
      {
        text: t('carDetail.camera'),
        onPress: () => launchPicker('camera'),
      },
      {
        text: t('carDetail.photoLibrary'),
        onPress: () => launchPicker('library'),
      },
      ...(hasPhoto
        ? [{
            text: t('carDetail.removePhoto'),
            style: 'destructive' as const,
            onPress: handleRemoveImage,
          }]
        : []),
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  async function handleRemoveImage() {
    const path = car?.parking_locations?.image_path;
    if (!path) return;

    setUploadingImage(true);
    try {
      const { error: storageError } = await supabase.storage
        .from('parking-images')
        .remove([path]);
      if (storageError) throw storageError;

      const { error: dbError } = await supabase
        .from('parking_locations')
        .update({ image_path: null })
        .eq('car_id', id);
      if (dbError) throw dbError;

      await fetchCar();
    } catch (e: any) {
      Alert.alert(t('carDetail.removeFailed'), e?.message ?? t('carDetail.removePhotoError'));
    } finally {
      setUploadingImage(false);
    }
  }

  async function launchPicker(source: 'camera' | 'library') {
    let result: ImagePicker.ImagePickerResult;

    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('carDetail.permissionDenied'), t('carDetail.cameraPermissionRequired'));
        return;
      }
      result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.5 });
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('carDetail.permissionDenied'), t('carDetail.libraryPermissionRequired'));
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
      Alert.alert(t('carDetail.uploadFailed'), e?.message ?? t('carDetail.uploadPhotoError'));
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
    else Alert.alert(t('common.error'), error.message);
    setSavingNote(false);
  }

  function openEditModal() {
    setEditName(car!.name);
    setEditPlate(car!.license_plate ?? '');
    setEditEmoji(car!.emoji ?? '🚗');
    setEditModalVisible(true);
  }

  async function handleDeleteCar() {
    Alert.alert(
      t('carDetail.removeVehicle'),
      t('carDetail.removeVehicleConfirm', { name: car!.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('carDetail.remove'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('cars').delete().eq('id', id);
            if (error) Alert.alert(t('common.error'), error.message);
            else router.back();
          },
        },
      ]
    );
  }

  async function handleSaveEdit() {
    const trimmedName = editName.trim();
    if (!trimmedName) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from('cars')
      .update({ name: trimmedName, license_plate: editPlate.trim() || null, emoji: editEmoji })
      .eq('id', id);
    if (error) {
      Alert.alert(t('common.error'), error.message);
    } else {
      setCar(prev => prev ? { ...prev, name: trimmedName, license_plate: editPlate.trim() || null, emoji: editEmoji } : prev);
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
        Alert.alert(t('common.error'), t('carDetail.mapsOpenError'));
      }
      return;
    }

    // iOS: detect installed map apps and offer a choice
    const candidates = [
      { text: t('carDetail.appleMaps'), url: `maps://?daddr=${latitude},${longitude}` },
      { text: t('carDetail.googleMaps'), url: `comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving` },
      { text: t('carDetail.waze'), url: `waze://?ll=${latitude},${longitude}&navigate=yes` },
    ];

    const available: { text: string; url: string }[] = [];
    for (const app of candidates) {
      if (await Linking.canOpenURL(app.url)) available.push(app);
    }
    // Web fallback always works
    available.push({ text: t('carDetail.googleMapsWeb'), url: `https://maps.google.com/?daddr=${latitude},${longitude}` });

    const openMap = async (url: string) => {
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert(t('common.error'), t('carDetail.mapsAppOpenError'));
      }
    };

    Alert.alert(
      t('carDetail.getDirections'),
      t('carDetail.openIn'),
      [
        ...available.map(app => ({ text: app.text, onPress: () => openMap(app.url) })),
        { text: t('common.cancel'), style: 'cancel' },
      ]
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
      <View style={shared.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!car) {
    return (
      <View style={shared.centered}>
        <Text style={styles.errorText}>{t('carDetail.vehicleNotFound')}</Text>
      </View>
    );
  }

  const loc = car.parking_locations;
  const isOwner = car.owner_id === userId;
  const mapRegion: Region | undefined = loc
    ? { latitude: loc.latitude, longitude: loc.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }
    : userRegion ?? undefined;

  return (
    <View style={shared.container}>
      <Stack.Screen
        options={{
          title: car.name,
          headerRight: isOwner ? () => (
            <TouchableOpacity onPress={openEditModal}>
              <Text style={{ color: colors.brand, fontSize: 22, fontWeight: '400' }}>{t('carDetail.edit')}</Text>
            </TouchableOpacity>
          ) : undefined,
        }}
      />

      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={mapRegion}
        showsUserLocation
        onPress={pickingLocation ? (e) => setPickedCoord(e.nativeEvent.coordinate) : undefined}
      >
        {pickingLocation
          ? pickedCoord && (
              <Marker
                coordinate={pickedCoord}
                draggable
                onDragEnd={(e) => setPickedCoord(e.nativeEvent.coordinate)}
              />
            )
          : loc && (
              <Marker
                coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
                title={car.name}
                description={car.license_plate ?? undefined}
              />
            )}
      </MapView>

      {pickingLocation ? (
        <View style={[styles.bottomCard, styles.pickingCard]}>
          <Text style={styles.pickingHint}>{t('carDetail.pickLocationHint')}</Text>
          <TouchableOpacity
            style={[shared.button, (savingLocation || !pickedCoord) && shared.buttonDisabled]}
            onPress={handleConfirmPickedLocation}
            disabled={savingLocation || !pickedCoord}
          >
            {savingLocation
              ? <ActivityIndicator color="#fff" />
              : <Text style={shared.buttonText}>{t('carDetail.saveThisLocation')}</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.textActionButton}
            onPress={cancelPicking}
            disabled={savingLocation}
          >
            <Text style={styles.textActionText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.bottomCard}>
        <ScrollView ref={scrollViewRef} style={styles.cardScroll} contentContainerStyle={styles.cardContent}>
          {car.license_plate && (
            <Text style={styles.plate}>{t('carDetail.licensePlate', { plate: car.license_plate })}</Text>
          )}

          {loc ? (
            <View style={styles.locationInfo}>
              <View style={styles.locationRow}>
                <View style={styles.locationText}>
                  <Text style={styles.locationLabel}>{t('carDetail.lastParked')}</Text>
                  <Text style={styles.locationDate}>{formatDate(loc.updated_at)}</Text>
                  {loc.profiles?.display_name && (
                    <Text style={styles.locationBy}>{t('carDetail.by', { name: loc.profiles.display_name })}</Text>
                  )}
                </View>
                <TouchableOpacity style={styles.directionsButton} onPress={handleDirections}>
                  <Text style={styles.directionsButtonText}>{t('carDetail.directions')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text style={styles.noLocation}>{t('carDetail.noLocationSaved')}</Text>
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
                      ? <ActivityIndicator color={colors.brand} size="small" />
                      : <Text style={styles.photoButtonText}>{t('carDetail.changePhoto')}</Text>
                    }
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.addPhotoButton, uploadingImage && shared.buttonDisabled]}
                  onPress={handlePickImage}
                  disabled={uploadingImage}
                >
                  {uploadingImage
                    ? <ActivityIndicator color={colors.textSecondary} size="small" />
                    : <Text style={styles.addPhotoText}>{t('carDetail.addParkingPhoto')}</Text>
                  }
                </TouchableOpacity>
              )}

              <View style={styles.noteRow}>
                <TextInput
                  style={styles.noteInput}
                  value={noteText}
                  onChangeText={setNoteText}
                  onFocus={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
                  placeholder={t('carDetail.notePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  multiline
                  maxLength={500}
                />
                {savingNote && <ActivityIndicator size="small" color={colors.brand} style={styles.noteSpinner} />}
              </View>
            </View>
          )}
        </ScrollView>

        <View style={styles.buttonSection}>
          <TouchableOpacity
            style={[shared.button, savingLocation && shared.buttonDisabled]}
            onPress={handleUpdateLocationPress}
            disabled={savingLocation}
          >
            {savingLocation
              ? <ActivityIndicator color="#fff" />
              : <Text style={shared.buttonText}>
                  {loc ? t('carDetail.updateParkingLocation') : t('carDetail.saveParkingLocation')}
                </Text>
            }
          </TouchableOpacity>

          {isOwner ? (
            <TouchableOpacity
              style={styles.textActionButton}
              onPress={() => router.push(`/car/${id}/share`)}
            >
              <Text style={styles.textActionText}>{t('carDetail.manageSharing')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.textActionButton}
              onPress={handleLeaveVehicle}
            >
              <Text style={styles.leaveText}>{t('carDetail.leaveVehicle')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
      )}

      <Modal visible={editModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[shared.editBackdrop, styles.editBackdropOpaque]}
        >
          <View style={shared.editSheet}>
            <Text style={shared.editTitle}>{t('carDetail.editVehicle')}</Text>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editScrollContent}>
              <Text style={shared.editLabel}>{t('carDetail.icon')}</Text>
              <View style={shared.emojiGrid}>
                {VEHICLE_EMOJIS.map(e => (
                  <TouchableOpacity
                    key={e}
                    style={[shared.emojiButton, editEmoji === e && shared.emojiButtonSelected]}
                    onPress={() => setEditEmoji(e)}
                  >
                    <Text style={shared.emojiChar}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={shared.editLabel}>{t('carDetail.name')}</Text>
              <TextInput
                style={shared.editInput}
                value={editName}
                onChangeText={setEditName}
                placeholder={t('carDetail.vehicleNamePlaceholder')}
                placeholderTextColor={colors.textMuted}
                maxLength={100}
              />

              <Text style={shared.editLabel}>{t('carDetail.licensePlateLabel')}</Text>
              <TextInput
                style={shared.editInput}
                value={editPlate}
                onChangeText={setEditPlate}
                placeholder={t('carDetail.optional')}
                placeholderTextColor={colors.textMuted}
                maxLength={20}
                autoCapitalize="characters"
              />

              <TouchableOpacity
                style={[shared.button, (!editName.trim() || savingEdit) && shared.buttonDisabled]}
                onPress={handleSaveEdit}
                disabled={!editName.trim() || savingEdit}
              >
                {savingEdit
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={shared.buttonText}>{t('common.save')}</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textActionButton}
                onPress={() => setEditModalVisible(false)}
                disabled={savingEdit}
              >
                <Text style={styles.textActionText}>{t('common.cancel')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.textActionButton}
                onPress={handleDeleteCar}
                disabled={savingEdit}
              >
                <Text style={[styles.textActionText, { color: colors.destructive }]}>{t('carDetail.deleteVehicle')}</Text>
              </TouchableOpacity>
            </ScrollView>
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
  map: {
    flex: 1,
  },
  bottomCard: {
    backgroundColor: colors.surface,
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
  pickingCard: {
    padding: 24,
    gap: 16,
  },
  pickingHint: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  plate: {
    fontSize: 14,
    color: colors.textSecondary,
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
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  directionsButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '600',
  },
  locationLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  locationDate: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  locationBy: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  noLocation: {
    fontSize: 14,
    color: colors.textMuted,
  },
  photoSection: {
    gap: 8,
  },
  parkingImage: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    backgroundColor: colors.divider,
  },
  photoButton: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
  },
  photoButtonText: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: '500',
  },
  addPhotoButton: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addPhotoText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  noteRow: {
    position: 'relative',
  },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    paddingRight: 32,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  noteSpinner: {
    position: 'absolute',
    bottom: 8,
    right: 8,
  },
  textActionButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  textActionText: {
    color: colors.brand,
    fontSize: 15,
    fontWeight: '500',
  },
  leaveText: {
    color: colors.destructive,
    fontSize: 15,
    fontWeight: '500',
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  editBackdropOpaque: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  editScrollContent: {
    paddingBottom: 32,
    gap: 8,
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
