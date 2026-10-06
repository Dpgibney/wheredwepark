import { useState, useEffect } from 'react';
import { View, Keyboard, Platform } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import AdBanner from '@/components/AdBanner';
import { HeaderIconButton } from '@/components/ui/header-button';
import { tabScreenOptions } from '@/constants/navigation';

export default function TabLayout() {
  const router = useRouter();
  const { t } = useTranslation();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  return (
    <Tabs
      screenOptions={tabScreenOptions}
      tabBar={(props) => keyboardVisible ? null : (
        <View>
          <AdBanner />
          <BottomTabBar {...props} />
        </View>
      )}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('layout.myVehicles'),
          tabBarIcon: ({ color, size }) => <Ionicons name="car" size={size} color={color} />,
          headerRight: () => (
            <HeaderIconButton
              icon="add"
              accessibilityLabel={t('layout.addVehicle')}
              onPress={() => router.push('/add-car')}
              style={{ marginRight: 16 }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('layout.settings'),
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
