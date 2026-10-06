import type { TextStyle } from 'react-native';

// Text grows with the user's font-size setting (iOS Dynamic Type / Android font
// scale) up to this multiple of its base size. 1.6 covers every standard iOS
// size plus the first accessibility size; past that, layouts start to break.
export const MAX_FONT_SCALE = 1.6;

// For text inside fixed-height chrome (header buttons, tab labels, badges,
// emoji and icon buttons) where there is less room to grow.
export const MAX_FONT_SCALE_TIGHT = 1.3;

// Every font size and weight in the app comes from one of these roles. Spread
// a role into a StyleSheet entry and add color/spacing there:
//   carName: { ...text.cardTitle, color: colors.textPrimary }
export const text = {
  // Headings
  screenTitle: { fontSize: 28, fontWeight: '700' },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  sectionTitle: { fontSize: 18, fontWeight: '600' },
  cardTitle: { fontSize: 17, fontWeight: '600' },

  // Navigation chrome (header titles and buttons)
  headerTitle: { fontSize: 17, fontWeight: '600' },
  headerButton: { fontSize: 17, fontWeight: '400' },

  // Body copy
  bodyLarge: { fontSize: 16 },
  bodyLargeStrong: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 15 },
  bodyMedium: { fontSize: 15, fontWeight: '500' },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 14 },
  smallMedium: { fontSize: 14, fontWeight: '500' },
  smallStrong: { fontSize: 14, fontWeight: '600' },
  caption: { fontSize: 13 },
  captionMedium: { fontSize: 13, fontWeight: '500' },

  // Controls
  button: { fontSize: 16, fontWeight: '600' },
  input: { fontSize: 16 },
  inputCompact: { fontSize: 15 },
  label: { fontSize: 13, fontWeight: '600' },

  // Uppercase labels
  sectionLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  overline: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Small tags
  badge: { fontSize: 11, fontWeight: '600' },
  badgeMedium: { fontSize: 11, fontWeight: '500' },

  // Glyph-sized text (emoji, initials, chevrons)
  emoji: { fontSize: 24 },
  emojiSmall: { fontSize: 16 },
  avatar: { fontSize: 26, fontWeight: '700' },
  chevron: { fontSize: 22 },
} as const satisfies Record<string, TextStyle>;
