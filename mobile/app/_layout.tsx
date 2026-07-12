import '@/global.css';

import { NAV_THEME } from '@/lib/theme';
import { Geist_400Regular, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import { ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { PortalHost } from '@rn-primitives/portal';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useUniwind } from 'uniwind';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

SplashScreen.preventAutoHideAsync();

const g = globalThis as unknown as {
  ErrorUtils?: { setGlobalHandler: (h: (e: unknown, isFatal?: boolean) => void) => void; getGlobalHandler: () => (e: unknown, isFatal?: boolean) => void };
  HermesInternal?: { hasPromise?: () => boolean; enablePromiseRejectionTracker?: (opts: unknown) => void };
};
if (g.ErrorUtils) {
  const defaultHandler = g.ErrorUtils.getGlobalHandler();
  g.ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.log('[GlobalError]', isFatal, (error as Error)?.message, (error as Error)?.stack);
    defaultHandler(error, isFatal);
  });
}
if (g.HermesInternal?.enablePromiseRejectionTracker) {
  g.HermesInternal.enablePromiseRejectionTracker({
    allRejections: true,
    onUnhandled: (id: number, rejection: unknown) => {
      console.log('[UnhandledRejection]', id, (rejection as Error)?.message, (rejection as Error)?.stack);
    },
  });
}

export default function RootLayout() {
  console.log('[RootLayout] render start');
  const { theme } = useUniwind();
  console.log('[RootLayout] useUniwind ok, theme=', theme);
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
  });
  console.log('[RootLayout] fontsLoaded=', fontsLoaded, 'fontError=', fontError);

  React.useEffect(() => {
    if (fontsLoaded) {
      console.log('[RootLayout] calling SplashScreen.hideAsync()');
      SplashScreen.hideAsync()
        .then(() => console.log('[RootLayout] hideAsync resolved'))
        .catch((e) => console.log('[RootLayout] hideAsync REJECTED', e?.message, e?.stack));
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  console.log('[RootLayout] about to render tree');
  return (
    <SafeAreaProvider>
      <ThemeProvider value={NAV_THEME[theme ?? 'light']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false }} />
        <PortalHost />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
