import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

export type VersionStatus =
  | { updateRequired: false }
  | { updateRequired: true; storeUrl: string | null };

/**
 * Compares this build's number (iOS CFBundleVersion / Android versionCode) with
 * the oldest build the server still supports (public.app_min_versions). Raise
 * min_build there to make older builds show the "Update required" screen.
 *
 * Fails open: if the check can't run (offline, server error), the app carries on.
 */
export async function checkAppVersion(): Promise<VersionStatus> {
  const build = Number(Application.nativeBuildVersion);
  if (!Number.isFinite(build) || (Platform.OS !== 'ios' && Platform.OS !== 'android')) {
    return { updateRequired: false };
  }

  const { data, error } = await supabase
    .from('app_min_versions')
    .select('min_build, store_url')
    .eq('platform', Platform.OS)
    .maybeSingle();

  if (error || !data || build >= data.min_build) {
    return { updateRequired: false };
  }
  return { updateRequired: true, storeUrl: data.store_url };
}
