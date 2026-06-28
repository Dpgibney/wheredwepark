import { supabase } from '@/lib/supabase';

/**
 * Canonical "park a car" write — one row per car (parking_locations has a UNIQUE
 * constraint on car_id, so this upserts on conflict).
 *
 * IMPORTANT: the native iOS App Intent mirrors this request field-for-field in
 * plugins/with-park-intent/swift/SupabaseParkClient.swift (raw PostgREST POST with
 * Prefer: resolution=merge-duplicates & on_conflict=car_id). If the shape changes
 * here, update that file too.
 */
export async function upsertParkingLocation({
  carId,
  latitude,
  longitude,
  userId,
}: {
  carId: string;
  latitude: number;
  longitude: number;
  userId: string;
}) {
  return supabase.from('parking_locations').upsert(
    {
      car_id: carId,
      latitude,
      longitude,
      updated_by_user_id: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'car_id' }
  );
}
