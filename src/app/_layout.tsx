import {
  SpaceGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { StatusBar } from 'expo-status-bar';
import { Colors } from '@/constants/theme';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { SessionLoadingScreen } from '@/components/session-loading';
import { UpdateWall } from '@/components/update-wall';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { I18nProvider } from '@/hooks/use-i18n';
// Registers the live-location background task at startup: a background wake
// after the app was terminated must find the task already defined.
import '@/lib/live-location';
import { applyThemeChoice, readStoredThemeChoice } from '@/lib/theme-choice';

applyThemeChoice(readStoredThemeChoice());

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, profile, loading, profileStalled } = useAuth();
  const [fontsLoaded] = useFonts({ SpaceGrotesk_700Bold });

  // Nothing to draw yet, and the native splash is still up: this is the cold
  // start, not a wait the user is watching.
  if (!fontsLoaded || (loading && !session)) return null;

  // Signed in, profile not known yet. Rendering null here is what made the app
  // look frozen after sign-in, so the wait is now visible and escapable.
  if (session && (loading || (profileStalled && !profile))) return <SessionLoadingScreen />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session && !!profile}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!!session && !profile}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="register" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="verify-email" />
        <Stack.Screen name="join" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = { ...base, colors: { ...base.colors, background: palette.background, card: palette.backgroundElement, text: palette.text, border: palette.backgroundSelected, primary: palette.accentText, notification: palette.accent } };
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style={palette.isDark ? 'light' : 'dark'} />
        <I18nProvider>
          <AuthProvider>
            <AnimatedSplashOverlay />
            {/* Outside the navigator and outside the session: a build too old
                to use is too old to sign in with. */}
            <UpdateWall>
              <RootNavigator />
            </UpdateWall>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
