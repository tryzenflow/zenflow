import { Stack } from 'expo-router';

export default function AuthLayout() {
  console.log('[AuthLayout] render');
  return <Stack screenOptions={{ headerShown: false }} />;
}
