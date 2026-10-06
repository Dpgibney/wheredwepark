import { colors } from '@/constants/colors';
import { text } from '@/constants/typography';

// Shared styling for headers and the tab bar. Every navigator spreads these so
// titles, tint colors and label sizes stay consistent across screens. Like
// iOS's own navigation and tab bars, these don't grow with the user's
// font-size setting (the bars have a fixed height); screen content does.

/** Native stack navigators (app/_layout.tsx, app/(auth)/_layout.tsx). */
export const stackScreenOptions = {
  headerTintColor: colors.brand,
  headerTitleStyle: { fontSize: text.headerTitle.fontSize, fontWeight: text.headerTitle.fontWeight },
} as const;

/** The bottom tab navigator (app/(tabs)/_layout.tsx). */
export const tabScreenOptions = {
  headerTintColor: colors.brand,
  headerTitleStyle: text.headerTitle,
  headerTitleAllowFontScaling: false,
  tabBarActiveTintColor: colors.brand,
  tabBarAllowFontScaling: false,
} as const;
