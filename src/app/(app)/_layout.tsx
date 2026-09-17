import { Stack } from 'expo-router';

import { useAuth } from '@/hooks/use-auth';

export default function AppLayout() {
  const { profile } = useAuth();

  return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={profile?.role === 'chef'}>
          <Stack.Screen name="(chef)" />
        </Stack.Protected>
        <Stack.Protected guard={profile?.role === 'employee'}>
          <Stack.Screen name="(employee)" />
        </Stack.Protected>
        {/* Réglages: shared by both roles, pushed over the tabs from Compte. */}
        <Stack.Screen name="settings" />
      </Stack>
  );
}
