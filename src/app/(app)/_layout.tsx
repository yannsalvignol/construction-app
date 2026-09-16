import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { PhoneOnlyNotice } from '@/components/phone-only-notice';
import { useAuth } from '@/hooks/use-auth';

export default function AppLayout() {
  const { profile } = useAuth();

  if (Platform.OS === 'web' && profile?.role === 'employee') return <PhoneOnlyNotice signedIn />;

  return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={profile?.role === 'chef'}>
          <Stack.Screen name="(chef)" />
        </Stack.Protected>
        <Stack.Protected guard={profile?.role === 'employee'}>
          <Stack.Screen name="(employee)" />
        </Stack.Protected>
      </Stack>
  );
}
