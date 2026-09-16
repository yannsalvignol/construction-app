import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';

/**
 * The web build is for chefs only: an employee's day, presence checks and live
 * position all depend on the phone (camera, GPS, push). Shown on web in place
 * of the employee workspace and of the join-with-code flow.
 */
export function PhoneOnlyNotice({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const { signOut } = useAuth();
  return (
    <SafeAreaView style={styles.safeArea}>
      <ThemedView style={styles.content}>
        <Image source={require('../../assets/images/logo_dark.png')} style={styles.logo} />
        <ThemedText type="title" style={styles.center}>{t.phoneOnly.title}</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.center}>{t.phoneOnly.body}</ThemedText>
        {signedIn ? (
          <Pressable onPress={signOut}>
            <ThemedText type="linkPrimary" style={styles.center}>{t.common.signOut}</ThemedText>
          </Pressable>
        ) : (
          <Link href="/sign-in" style={styles.center}>
            <ThemedText type="linkPrimary">{t.phoneOnly.backToSignIn}</ThemedText>
          </Link>
        )}
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', justifyContent: 'center' },
  content: { padding: Spacing.four, gap: Spacing.four, alignItems: 'center', backgroundColor: 'transparent' },
  logo: { width: 72, height: 72, borderRadius: 18 },
  center: { textAlign: 'center' },
});
