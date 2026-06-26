import { Platform } from 'react-native';
import mobileAds, {
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
} from 'react-native-google-mobile-ads';
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';

let initPromise: Promise<boolean> | null = null;

/**
 * Gathers ad consent and initializes the Mobile Ads SDK. Resolves true once
 * ads may be requested. Idempotent — safe to call from every AdBanner mount;
 * the flow runs once per app launch.
 *
 * Order matters: the UMP (GDPR) form must be answered before any ad request
 * in the EEA/UK, and the iOS ATT prompt must be shown before the SDK can
 * access the device's advertising identifier, so both precede initialize().
 */
export function initializeAds(): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      let canRequestAds = true;
      try {
        const info = await AdsConsent.gatherConsent();
        canRequestAds = info.canRequestAds;
      } catch {
        // Offline or UMP unreachable — fall back to the last known consent
        // state so returning users still get ads (or correctly get none).
        try {
          canRequestAds = (await AdsConsent.getConsentInfo()).canRequestAds;
        } catch {
          canRequestAds = false;
        }
      }

      if (Platform.OS === 'ios') {
        // Denial just means no IDFA; the SDK then serves non-personalized ads.
        await requestTrackingPermissionsAsync().catch(() => {});
      }

      if (canRequestAds) {
        await mobileAds().initialize();
      }
      return canRequestAds;
    })();
  }
  return initPromise;
}

/**
 * Whether the UMP requires the app to expose a way to revisit consent
 * choices (true for users who were shown the GDPR form).
 */
export async function adPrivacyOptionsRequired(): Promise<boolean> {
  try {
    // Wait for the launch consent flow (idempotent) — before it completes
    // getConsentInfo() reports UNKNOWN, which would wrongly hide the
    // Settings entry point that GDPR/UMP policy requires us to offer.
    await initializeAds();
    const info = await AdsConsent.getConsentInfo();
    return (
      info.privacyOptionsRequirementStatus ===
      AdsConsentPrivacyOptionsRequirementStatus.REQUIRED
    );
  } catch {
    return false;
  }
}

/** Re-opens the Google consent form so the user can change their choices. */
export function showAdPrivacyOptions() {
  return AdsConsent.showPrivacyOptionsForm();
}
