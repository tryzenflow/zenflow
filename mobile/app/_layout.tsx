import { me } from "@/api/auth";
import { PortalHost } from "@/components/primitives/portal";
import { ToastProvider } from "@/components/ui/toast";
import { useNotificationsSubscription } from "@/hooks/use-notifications";
import { usePushRegistration } from "@/hooks/use-push-registration";
import { useUserStore } from "@/hooks/use-user-store";
import { setAndroidNavigationBar } from "@/lib/android-navigation-bar";
import { restoreSessionCookie } from "@/lib/api-client";
import { NAV_THEME } from "@/lib/constants";
import { routeForSession } from "@/lib/onboarding";
import {
  cacheSessionUser,
  clearCachedSessionUser,
  readCachedSessionUser,
} from "@/lib/session";
import { useColorScheme } from "@/lib/useColorScheme";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { isAxiosError } from "axios";
import { useFonts } from "expo-font";
import {
  Href,
  Redirect,
  SplashScreen,
  Stack,
  type Theme,
  ThemeProvider,
  useSegments,
} from "expo-router";
import * as React from "react";
import { StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "./global.css";

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
 * Headless: registers this device for native push while signed in and routes
 * a tapped notification. Rendered as a sibling of <Stack> (like <AuthGate/>)
 * so its `useRouter()` sits under the mounted navigator.
 */
function PushRegistrar() {
  usePushRegistration();
  return null;
}

/**
 * Headless: subscribes to live SSE notifications (/notifications/stream),
 * presents foreground tap-to-act toast, and triggers AppState catch-up fetch.
 */
function NotificationsSubscriber() {
  useNotificationsSubscription();
  return null;
}

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

  // Signed out -> login; signed in with `onboardedAt === null` -> onboarding
  // (server-side flag, so it follows the user across devices); otherwise out
  // of the auth/onboarding groups. Group-qualified hrefs, not bare "/":
  // `(app)/index` and `(auth)/index` both compile to "/", so a bare redirect
  // could resolve back into the focused group.
  const target = routeForSession(user, group);
  if (target) return <Redirect href={target as Href} />;
  return null;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Geist: require("../assets/fonts/Geist-Regular.ttf"),
    "Geist-Bold": require("../assets/fonts/Geist-Bold.ttf"),
    "Geist-Medium": require("../assets/fonts/Geist-Medium.ttf"),
    "Geist-SemiBold": require("../assets/fonts/Geist-SemiBold.ttf"),
    "Geist-ExtraBold": require("../assets/fonts/Geist-ExtraBold.ttf"),
    // Geist Mono backs the `font-mono` utility (see `components/ui/text.tsx`'s
    // `resolveGeistFontFamily`) — task times, durations and other tabular
    // figures. Only the two weights those call sites use are loaded.
    GeistMono: require("../assets/fonts/GeistMono-Regular.ttf"),
    "GeistMono-Medium": require("../assets/fonts/GeistMono-Medium.ttf"),
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
      let cached: Awaited<ReturnType<typeof readCachedSessionUser>> = null;
      try {
        await restoreSessionCookie();
        cached = await readCachedSessionUser();
      } catch (err) {
        console.warn("[_layout] Session cache read error:", err);
      }

      // Resolve `/auth/me` *before* dropping the splash, so a dead session goes
      // straight to login instead of flashing the cached user's calendar first.
      // The cache is only a fallback for when the server is unreachable.
      try {
        const fresh = await me();
        setUser(fresh);
        if (fresh) await cacheSessionUser(fresh);
        else await clearCachedSessionUser();
      } catch (err) {
        if (isAxiosError(err) && err.response) {
          // Server answered (401/403): the session is dead.
          setUser(null);
          await clearCachedSessionUser();
        } else if (cached) {
          // Offline / timeout: fall back to the cached user.
          setUser(cached);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // The session is resolved but `AuthGate` may still have to redirect (e.g. a
  // signed-out launch lands on the "/" calendar first). Keep the splash up
  // until the focused group is the one the gate wants, so the wrong screen
  // never flashes before the redirect.
  const segments = useSegments();
  const sessionUser = useUserStore((s) => s.user);
  const routeSettled =
    !loading && routeForSession(sessionUser, segments[0] as string) === null;
  // Safety net only for a redirect that never settles; it starts once the
  // session has resolved, so a slow `/auth/me` can't trip it early.
  const [splashTimedOut, setSplashTimedOut] = React.useState(false);
  React.useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => setSplashTimedOut(true), 1500);
    return () => clearTimeout(t);
  }, [loading]);

  // Keep the splash screen up until BOTH fonts and the local session are resolved
  React.useEffect(() => {
    console.log(
      "[_layout] fontsLoaded:",
      fontsLoaded,
      "fontError:",
      fontError,
      "loading:",
      loading,
    );
    if ((fontsLoaded || fontError) && !loading && (routeSettled || splashTimedOut)) {
      SplashScreen.hideAsync().catch((err) => {
        console.warn("[_layout] SplashScreen.hideAsync warning:", err);
      });
    }
  }, [fontsLoaded, fontError, loading, routeSettled, splashTimedOut]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    // `GestureHandlerRootView` wraps `ToastProvider` (not the other way
    // around) — `Toast`'s swipe-to-dismiss uses `GestureDetector`, which
    // throws a render error without a `GestureHandlerRootView` ancestor,
    // and `ToastProvider` renders its toast stack as a sibling of
    // `children` (outside whatever `children` wraps), so it needs to be
    // *inside* this root, not outside it.
    //
    // `PortalHost` must live inside this root too, not as a sibling of it:
    // `components/primitives/portal.tsx`'s `Portal`/`PortalHost` isn't a
    // true native portal — it just renders the portaled children wherever
    // `PortalHost` sits in the React tree via a shared Zustand store, so
    // that's also where they land in the native view hierarchy. Rendering
    // `PortalHost` as a sibling after `</GestureHandlerRootView>` put any
    // `GestureDetector` inside a portaled component (e.g. `DragToastCard`
    // via `DragToastStack`, see `components/calendar/drag-toast-stack.tsx`)
    // outside the gesture root, which is exactly the
    // "GestureDetector must be used as a descendant of
    // GestureHandlerRootView" crash. Kept last among the root's children so
    // portaled content still paints on top of the Stack/AuthGate.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ToastProvider>
        <ThemeProvider value={isDarkColorScheme ? DARK_THEME : LIGHT_THEME}>
          <BottomSheetModalProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(app)" />
              {/* Session create/edit — full screens, not bottom sheets (see
                  mobile/README.md); presented modally so they still read
                  as "on top of" the tabs instead of replacing them. */}
              <Stack.Screen
                name="task/new"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="task/[id]/edit"
                options={{ presentation: "modal" }}
              />
              {/* The ingestion inbox — LMS / portal notifications. */}
              <Stack.Screen
                name="notifications"
                options={{ presentation: "modal" }}
              />
            </Stack>
            <AuthGate />
            <PushRegistrar />
            <NotificationsSubscriber />
            {/* Visible and themed, not `hidden`: on Android a hidden status
                bar still reserves its strip, which showed as an empty band
                above every screen's header.
                `backgroundColor` is gone from this SDK's `StatusBar` type
                entirely (Android's mandatory edge-to-edge display removed
                it, same as `expo-navigation-bar`'s style/color setters --
                see `lib/android-navigation-bar.ts`) -- the status bar is now
                always transparent over whatever's drawn beneath it. Flagged:
                needs a real design pass if Android's status bar area should
                still read as themed (e.g. a themed scrim behind it), not a
                drop-in fix. */}
            <StatusBar
              barStyle={isDarkColorScheme ? "light-content" : "dark-content"}
            />
          </BottomSheetModalProvider>
        </ThemeProvider>
      </ToastProvider>

      <PortalHost />
    </GestureHandlerRootView>
  );
}
