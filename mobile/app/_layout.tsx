import "./global.css";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { type Theme, ThemeProvider } from "@react-navigation/native";
import { Href, Redirect, SplashScreen, Stack, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import * as React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PortalHost } from "@/components/primitives/portal";
import { setAndroidNavigationBar } from "@/lib/android-navigation-bar";
import { NAV_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/useColorScheme";
import { ToastProvider } from "@/components/ui/toast";
import { useUserStore } from "@/hooks/use-user-store";
import {
  cacheSessionUser,
  clearCachedSessionUser,
  readCachedSessionUser,
} from "@/lib/session";
import { restoreSessionCookie } from "@/lib/api-client";
import { me } from "@/api/auth";
import { StatusBar } from "react-native";

const NAV_FONT_FAMILY = "Geist";
const LIGHT_THEME: Theme = {
  dark: false,
  colors: NAV_THEME.light,
  fonts: {
    regular: { fontFamily: NAV_FONT_FAMILY, fontWeight: "400" },
    medium: { fontFamily: NAV_FONT_FAMILY + "-Medium", fontWeight: "500" },
    bold: { fontFamily: NAV_FONT_FAMILY + "-SemiBold", fontWeight: "600" },
    heavy: { fontFamily: NAV_FONT_FAMILY + "-Bold", fontWeight: "700" },
  },
};
const DARK_THEME: Theme = {
  dark: true,
  colors: NAV_THEME.dark,
  fonts: LIGHT_THEME.fonts,
};

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from "expo-router";

SplashScreen.preventAutoHideAsync();

/**
 * Auth gate: no server round-trip on every navigation, just a redirect based
 * on the Zustand user store (hydrated once, below, from the cookie session /
 * secure-store cache). Mirrors the web `WithAuth` HOC (CLAUDE.md §7).
 *
 * Rendered as a sibling of <Stack>, never wrapping it: expo-router requires
 * the Root Layout to mount a navigator on its very first render, so this can
 * only ever add a <Redirect/> alongside the Stack, not replace it.
 */
function AuthGate() {
  const segments = useSegments();
  const user = useUserStore((s) => s.user);
  const loading = useUserStore((s) => s.loading);

  if (loading) return null;

  const group = segments[0] as string;
  const inAuthGroup = group === "(auth)";
  const inOnboardingGroup = group === "(onboarding)";

  if (!user) {
    return inAuthGroup ? null : <Redirect href={"/(auth)/login" as Href} />;
  }
  if (!user.onboardingComplete) {
    return inOnboardingGroup ? null : (
      <Redirect href={"/(onboarding)" as Href} />
    );
  }
  if (inAuthGroup || inOnboardingGroup) {
    // Group-qualified, not bare "/": `(app)/index` and `(onboarding)/index`
    // both compile to the URL "/" (parenthesized segments are stripped from
    // the path), so a bare "/" redirect fired while the focused navigator is
    // still the `(onboarding)` stack resolves back into onboarding's own
    // index instead of escaping to `(app)` — the "Done button sends me back
    // to onboarding" bug. Naming the group disambiguates it.
    return <Redirect href={"/(app)" as Href} />;
  }
  return null;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Geist: require("../assets/fonts/Geist-Regular.ttf"),
    "Geist-Bold": require("../assets/fonts/Geist-Bold.ttf"),
    "Geist-Medium": require("../assets/fonts/Geist-Medium.ttf"),
    "Geist-SemiBold": require("../assets/fonts/Geist-SemiBold.ttf"),
    "Geist-ExtraBold": require("../assets/fonts/Geist-ExtraBold.ttf"),
  });
  const { colorScheme, isDarkColorScheme } = useColorScheme();
  const setUser = useUserStore((s) => s.setUser);
  const setLoading = useUserStore((s) => s.setLoading);
  const loading = useUserStore((s) => s.loading);

  React.useEffect(() => {
    setAndroidNavigationBar(colorScheme);
  }, [colorScheme]);

  // Hydrate the session once: show the secure-store cache immediately, then
  // reconcile against `/auth/me` in the background (CLAUDE.md §7 — cookie
  // sessions, no JWT to decode client-side).
  //
  // Everything here is wrapped in one try/finally: `setLoading(false)` must
  // run no matter what throws above it. Previously only the `me()` call was
  // guarded, so a throw from `readCachedSessionUser`/`restoreSessionCookie`
  // (e.g. `expo-secure-store` has no web implementation) skipped the
  // `finally` entirely, leaving `loading` stuck `true` forever — which makes
  // `AuthGate` a permanent no-op (never redirects, on a 403 or anything else).
  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const cached = await readCachedSessionUser();
        if (cached) setUser(cached);
        // Restore the persisted native session cookie (no-op on web, where
        // the browser's own cookie jar applies) before the first request
        // goes out — `api-client.ts`'s request interceptor needs it in
        // memory to attach the `Cookie` header.
        await restoreSessionCookie();
        const fresh = await me();
        setUser(fresh);
        if (fresh) await cacheSessionUser(fresh);
        else await clearCachedSessionUser();
      } catch {
        // Network/offline error, or a genuine auth failure: on 401/403 the
        // global interceptor in `api-client.ts` already cleared the user, so
        // there's nothing more to do here either way.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Keep the splash screen up until BOTH fonts and the session are resolved
  // — hiding it on fonts alone let the Stack's default initial screen (e.g.
  // the app tabs) flash briefly before `AuthGate` had a verdict, then swap
  // to login/onboarding once hydration caught up.
  React.useEffect(() => {
    if ((fontsLoaded || fontError) && !loading) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError, loading]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <>
      <ToastProvider>
        <ThemeProvider value={isDarkColorScheme ? DARK_THEME : LIGHT_THEME}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <BottomSheetModalProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(app)" />
                {/* Task create/edit — full screens, not bottom sheets (see
                    mobile/README.md); presented modally so they still read
                    as "on top of" the tabs instead of replacing them. */}
                <Stack.Screen name="task/new" options={{ presentation: "modal" }} />
                <Stack.Screen
                  name="task/[id]/edit"
                  options={{ presentation: "modal" }}
                />
              </Stack>
              <AuthGate />
              <StatusBar hidden={true} />
            </BottomSheetModalProvider>
          </GestureHandlerRootView>
        </ThemeProvider>
      </ToastProvider>

      <PortalHost />
    </>
  );
}
