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
        {/* The chef's profile, pushed from the header avatar. Employees reach
            the same screen as a tab of their own, hence only this one route. */}
        <Stack.Screen name="profile" />
        {/* One chantier in full, pushed from the dashboard. */}
        <Stack.Screen name="site/[id]" />
        {/* One person's activity, pushed from a chantier's roster. */}
        <Stack.Screen name="employee/[id]" />
        {/* Réglages: shared by both roles, pushed over the tabs from Compte. */}
        <Stack.Screen name="settings" />
        {/* Pushed from Réglages; confirmed by a code emailed to the account. */}
        <Stack.Screen name="change-password" />
        {/* What the worker agreed to, pushed from Réglages. */}
        <Stack.Screen name="consent" />
      </Stack>
  );
}
