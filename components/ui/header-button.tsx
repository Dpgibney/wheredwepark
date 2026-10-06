import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleProp, TouchableOpacity, ViewStyle } from 'react-native';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/colors';
import { text } from '@/constants/typography';

// Header actions. Like iOS's own navigation bar buttons, these keep a fixed
// size regardless of the user's font-size setting (see constants/navigation.ts).

export function HeaderTextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={8} accessibilityRole="button">
      <Text style={[text.headerButton, { color: colors.brand }]} allowFontScaling={false}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function HeaderIconButton({
  icon,
  accessibilityLabel,
  onPress,
  style,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      <Ionicons name={icon} size={28} color={colors.brand} />
    </TouchableOpacity>
  );
}
