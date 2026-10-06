import type { ComponentPropsWithRef } from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';
import { MAX_FONT_SCALE } from '@/constants/typography';

// Use these instead of React Native's Text/TextInput everywhere in the app.
// They still follow the user's font-size setting, but stop growing at
// MAX_FONT_SCALE so screens stay usable at the largest accessibility sizes.
// Pass maxFontSizeMultiplier (e.g. MAX_FONT_SCALE_TIGHT) to override per use.

export function Text({ maxFontSizeMultiplier = MAX_FONT_SCALE, ...props }: ComponentPropsWithRef<typeof RNText>) {
  return <RNText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />;
}

export function TextInput({ maxFontSizeMultiplier = MAX_FONT_SCALE, ...props }: ComponentPropsWithRef<typeof RNTextInput>) {
  return <RNTextInput maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />;
}
