import { Redirect } from 'expo-router';

// No session state exists yet (the cookie-aware API client lands with
// Phase 1 of the RN migration — see mobile/docs/react-native-migration.md),
// so this always routes to login rather than gating on auth.
export default function Index() {
  return <Redirect href="/(auth)/login" />;
}
