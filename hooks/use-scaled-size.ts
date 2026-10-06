import { useWindowDimensions } from 'react-native';
import { MAX_FONT_SCALE_TIGHT } from '@/constants/typography';

/**
 * Scales a fixed dimension (e.g. a 36pt round button) by the user's font-size
 * setting, capped like the text inside it, so the container grows with its
 * label instead of clipping it.
 */
export function useScaledSize(base: number, maxScale: number = MAX_FONT_SCALE_TIGHT) {
  const { fontScale } = useWindowDimensions();
  return Math.round(base * Math.min(Math.max(fontScale, 1), maxScale));
}
