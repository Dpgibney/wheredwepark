import { Image, Linking, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import * as Application from 'expo-application';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/colors';
import { text } from '@/constants/typography';
import { shared } from '@/styles/shared';

const ARTIST_SHOP_URL = 'https://www.etsy.com/shop/DoodlesByRay';

export default function AboutScreen() {
  const { t } = useTranslation();

  return (
    <ScrollView style={shared.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Image
          source={require('@/assets/images/icon.png')}
          style={styles.icon}
          accessibilityIgnoresInvertColors
        />
        <Text style={styles.appName}>{t('about.appName')}</Text>
        <Text style={styles.version}>
          {t('about.version', {
            version: Application.nativeApplicationVersion ?? '?',
            build: Application.nativeBuildVersion ?? '?',
          })}
        </Text>
      </View>

      <Text style={shared.sectionLabel}>{t('about.creditsTitle')}</Text>
      <View style={[shared.card, styles.creditCard]}>
        <Text style={styles.creditText}>{t('about.artworkCredit')}</Text>
        <TouchableOpacity
          style={shared.button}
          onPress={() => Linking.openURL(ARTIST_SHOP_URL)}
          accessibilityRole="link"
        >
          <Text style={shared.buttonText}>{t('about.visitShop')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
    gap: 4,
  },
  icon: {
    width: 96,
    height: 96,
    borderRadius: 22,
    marginBottom: 12,
  },
  appName: {
    ...text.sectionTitle,
    color: colors.textPrimary,
  },
  version: {
    ...text.caption,
    color: colors.textSecondary,
  },
  creditCard: {
    gap: 8,
  },
  creditText: {
    ...text.body,
    color: colors.textPrimary,
    lineHeight: 22,
  },
});
