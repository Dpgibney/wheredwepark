import { Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/text';
import { shared } from '@/styles/shared';

// Shown instead of the app when this build is older than the minimum the
// server supports (see lib/app-version.ts).
export function UpdateRequired({ storeUrl }: { storeUrl: string | null }) {
  const { t } = useTranslation();

  return (
    <View style={[shared.centered, styles.container]}>
      <Text style={shared.title}>{t('updateRequired.title')}</Text>
      <Text style={shared.subtitle}>{t('updateRequired.message')}</Text>
      {storeUrl && (
        <TouchableOpacity
          style={[shared.button, styles.button]}
          onPress={() => Linking.openURL(storeUrl)}
          accessibilityRole="button"
        >
          <Text style={shared.buttonText}>{t('updateRequired.button')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
  },
  button: {
    alignSelf: 'stretch',
  },
});
