import { useState } from 'react';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

const ANDROID_AD_UNIT_ID = __DEV__
  ? TestIds.ADAPTIVE_BANNER
  : 'ca-app-pub-6599569803835160/5915537898';

const IOS_AD_UNIT_ID = __DEV__
  ? TestIds.ADAPTIVE_BANNER
  : 'ca-app-pub-6599569803835160/5221073758';

const adUnitId =
  typeof process !== 'undefined' && process.env.EXPO_OS === 'android'
    ? ANDROID_AD_UNIT_ID
    : IOS_AD_UNIT_ID;

export default function AdBanner() {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <BannerAd
      unitId={adUnitId}
      size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
      onAdFailedToLoad={() => setFailed(true)}
    />
  );
}
