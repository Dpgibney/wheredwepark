import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

// SecureStore adapter so auth tokens are stored encrypted on-device
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // must be false for React Native
  },
});

// Convenience type helpers
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

// Minimal inline types (expand as needed or generate via `supabase gen types`)
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; email: string; display_name: string | null; created_at: string };
        Insert: { id: string; email: string; display_name?: string | null };
        Update: { display_name?: string | null };
      };
      cars: {
        Row: { id: string; owner_id: string; name: string; license_plate: string | null; vehicle_type: 'car' | 'bike' | 'motorcycle'; emoji: string | null; created_at: string };
        Insert: { owner_id: string; name: string; license_plate?: string | null; vehicle_type?: 'car' | 'bike' | 'motorcycle'; emoji?: string | null };
        Update: { name?: string; license_plate?: string | null; vehicle_type?: 'car' | 'bike' | 'motorcycle'; emoji?: string | null };
      };
      car_shares: {
        Row: { id: string; car_id: string; shared_with_user_id: string; created_at: string };
        Insert: { car_id: string; shared_with_user_id: string };
        Update: never;
      };
      parking_locations: {
        Row: { id: string; car_id: string; latitude: number; longitude: number; updated_by_user_id: string; updated_at: string; notes: string | null };
        Insert: { car_id: string; latitude: number; longitude: number; updated_by_user_id: string; notes?: string | null };
        Update: { latitude?: number; longitude?: number; updated_by_user_id?: string; updated_at?: string; notes?: string | null };
      };
    };
  };
}
