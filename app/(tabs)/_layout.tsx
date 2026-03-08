import { Text, TouchableOpacity } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  const router = useRouter();

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#2563EB' }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'My Vehicles',
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
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
