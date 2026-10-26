// Extends app.json. The Android Google Maps key comes from the environment so it
// stays out of this public repo: .env locally, an EAS environment variable on EAS.
const androidGoogleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;

// Without the key the Android map screen crashes, so fail the build instead.
if (process.env.EAS_BUILD_PLATFORM === 'android' && !androidGoogleMapsApiKey) {
  throw new Error('GOOGLE_MAPS_ANDROID_API_KEY is not set for this EAS build environment.');
}

module.exports = ({ config }) => ({
  ...config,
  plugins: [...config.plugins, ['react-native-maps', { androidGoogleMapsApiKey }]],
});
