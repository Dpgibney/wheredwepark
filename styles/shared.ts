import { StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';

export const shared = StyleSheet.create({
  // Containers
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },

  // Card with shadow
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  // Primary button
  button: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center' as const,
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonDestructive: {
    backgroundColor: colors.destructive,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600' as const,
  },

  // Text input
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 12,
  },

  // Form label (above inputs)
  label: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.textSecondary,
    marginBottom: 6,
    marginTop: 4,
  },

  // Auth screen headings
  title: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    textAlign: 'center' as const,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    marginBottom: 32,
  },

  // Section label (uppercase)
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 10,
  },

  // Link buttons (below primary button on auth screens)
  linkButton: {
    marginTop: 24,
    alignItems: 'center' as const,
  },
  linkText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  linkTextBold: {
    color: colors.brand,
    fontWeight: '600' as const,
  },

  // Bottom sheet
  editBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end' as const,
  },
  editSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 8,
  },
  editTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  editLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.textSecondary,
    marginTop: 4,
  },
  editInput: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: colors.textPrimary,
  },

  // Emoji picker
  emojiGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  emojiButton: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  emojiButtonSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  emojiChar: {
    fontSize: 24,
  },
});
