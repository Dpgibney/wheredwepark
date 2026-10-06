import { ScrollView, StyleSheet, View } from 'react-native';
import * as Application from 'expo-application';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/colors';
import { text } from '@/constants/typography';
import { shared } from '@/styles/shared';

// iOS only (linked from Settings on iOS). Explains the "Park My Car" App Intent
// from plugins/with-park-intent and how to trigger it from an automation.
// Keep in sync with the "Auto-park with Siri" section of docs/index.html.

function Step({ number, children }: { number: number; children: string }) {
  return (
    <View style={styles.step}>
      <Text style={styles.stepNumber}>{number}.</Text>
      <Text style={styles.stepText}>{children}</Text>
    </View>
  );
}

export default function SiriShortcutScreen() {
  const { t } = useTranslation();
  // The name iOS shows under Siri and Shortcuts, e.g. "wheredwepark".
  const app = Application.applicationName ?? 'wheredwepark';

  return (
    <ScrollView style={shared.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>{t('siri.intro')}</Text>

      <Text style={shared.sectionLabel}>{t('siri.askTitle')}</Text>
      <View style={[shared.card, styles.card]}>
        <Text style={styles.body}>{t('siri.askBody', { app })}</Text>
      </View>

      <Text style={shared.sectionLabel}>{t('siri.automationTitle')}</Text>
      <View style={[shared.card, styles.card]}>
        <Step number={1}>{t('siri.step1')}</Step>
        <Step number={2}>{t('siri.step2')}</Step>
        <Step number={3}>{t('siri.step3')}</Step>
        <Step number={4}>{t('siri.step4', { app })}</Step>
        <Step number={5}>{t('siri.step5')}</Step>
      </View>

      <Text style={shared.sectionLabel}>{t('siri.tipsTitle')}</Text>
      <View style={[shared.card, styles.card]}>
        <Text style={styles.body}>{t('siri.tipOpenApp')}</Text>
        <Text style={styles.body}>{t('siri.tipPermissions')}</Text>
        <Text style={styles.body}>{t('siri.tipLocked')}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 24,
    gap: 8,
  },
  intro: {
    ...text.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 16,
  },
  card: {
    gap: 12,
    marginBottom: 20,
  },
  body: {
    ...text.body,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  step: {
    flexDirection: 'row',
    gap: 8,
  },
  stepNumber: {
    ...text.bodyStrong,
    color: colors.brand,
    lineHeight: 22,
  },
  stepText: {
    ...text.body,
    color: colors.textPrimary,
    lineHeight: 22,
    flex: 1,
  },
});
