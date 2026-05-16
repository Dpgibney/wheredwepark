import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Keyboard, Platform } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import AdBanner from '@/components/AdBanner';

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
      screenOptions={{ tabBarActiveTintColor: '#2563EB' }}
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
            <TouchableOpacity
              onPress={() => router.push('/add-car')}
              style={{ marginRight: 16 }}
            >
              <Text style={{ fontSize: 28, color: '#2563EB', lineHeight: 32 }}>+</Text>
            </TouchableOpacity>
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
