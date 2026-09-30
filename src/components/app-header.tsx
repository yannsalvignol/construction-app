import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandName } from '@/components/brand-name';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { useTheme } from '@/hooks/use-theme';

const AnimatedImage = Animated.createAnimatedComponent(Image);

export function AppHeader() {
  const theme = useTheme();
  const palette = useAuthPalette();
  const router = useRouter();
  const { profile } = useAuth();

  // The logo is the way home from anywhere, so pressing it answers: the mark
  // dips under the thumb and springs back, with a tap of haptics to match.
  // Haptics have no web implementation, hence the platform check.
  const press = useSharedValue(0);
  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.12 }, { rotate: `${press.value * -4}deg` }],
  }));

  return (
    <ThemedView>
      <SafeAreaView edges={['top', 'left', 'right']}>
        <View style={styles.row}>
          <Pressable
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              }
              router.navigate('/');
            }}
            onPressIn={() => { press.value = withTiming(1, { duration: 90 }); }}
            onPressOut={() => { press.value = withSpring(0, { damping: 12, stiffness: 260 }); }}
            hitSlop={8}>
            <AnimatedImage
              source={require('@/assets/images/official_icon.png')}
              style={[styles.logo, logoStyle]}
              contentFit="contain"
            />
          </Pressable>

          <ThemedText style={styles.title} numberOfLines={1}>
            <BrandName />
          </ThemedText>

          <Pressable
            onPress={() => router.push('/profile')}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <ThemedView
                style={[
                  styles.avatar,
                  styles.avatarPlaceholder,
                  // Same treatment as the profile screen it opens: a filled
                  // disc that stands off the page, not an outline on it.
                  { backgroundColor: palette.avatar },
                ]}>
                <Ionicons name="person" size={26} color={theme.textSecondary} />
              </ThemedView>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.three,
  },
  logo: {
    width: 52,
    height: 52,
    borderRadius: Spacing.three,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 30,
    lineHeight: 36,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
