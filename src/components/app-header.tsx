import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';

export function AppHeader() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const { profile } = useAuth();

  return (
    <ThemedView>
      <SafeAreaView edges={['top', 'left', 'right']}>
        <View style={styles.row}>
          <Pressable
            onPress={() => router.navigate('/')}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}>
            <Image
              source={require('@/assets/images/logo_dark.png')}
              style={styles.logo}
              contentFit="contain"
            />
          </Pressable>

          <ThemedText style={styles.title} numberOfLines={1}>
            {t.common.appName}
          </ThemedText>

          <Pressable
            onPress={() => router.navigate('/account')}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <ThemedView
                style={[
                  styles.avatar,
                  styles.avatarPlaceholder,
                  { borderWidth: 1, borderColor: theme.backgroundSelected },
                ]}>
                <SymbolView
                  name={{ ios: 'person.fill', android: 'person', web: 'person' }}
                  size={26}
                  tintColor={theme.textSecondary}
                />
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
