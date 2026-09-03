import { Stack } from 'expo-router';

export default function EmployeesLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Employees', headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: 'Employee' }} />
    </Stack>
  );
}
