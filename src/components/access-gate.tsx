import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Action, Card, WorkPage } from '@/components/work-ui';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { supabase } from '@/lib/supabase';

/**
 * Where a chef writes to have his access opened.
 *
 * The one address in the binary, and the only thing in it that points outside
 * the app. No pricing page, no plan names, no prices: App Review reads a link
 * to a tariff page as a call to action for a purchase made outside the app,
 * which costs a free B2B companion app its exemption from in-app purchase
 * (guideline 3.1.3(f)). CASPROD is invoiced to the company, never to the
 * phone, and the app says nothing about what it costs.
 */
export const SALES_EMAIL = 'melanie@casprod.app';

type Access = {
  active: boolean;
  days_left: number;
  locked: boolean;
  notice_seen: boolean;
};

/**
 * Fifteen days, then a conversation.
 *
 * Two screens from one question. On the first opening, what the trial is and
 * how long it runs — said once, because a chef who has read it does not need
 * it every morning. After it expires, a wall: the app is not usable until
 * somebody here unlocks the account.
 *
 * Only in front of the chef. An employee did not sign anything and cannot pay
 * anything; locking him out of a day he is halfway through would punish the
 * wrong person for his employer's invoice.
 *
 * The screen is not the lock. The database refuses a locked company's writes
 * on its own, because a lock that lives in the app is a suggestion.
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const { t } = useI18n();
  const theme = useTheme();
  const [access, setAccess] = useState<Access | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    if (profile?.role !== 'chef') return;
    const { data } = await supabase.rpc('company_access');
    setAccess((data as Access) ?? null);
  }, [profile?.role]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (profile?.role !== 'chef' || !access) return <>{children}</>;

  if (access.locked) {
    return (
      <WorkPage topInset title={t.trial.lockedTitle}>
        <Card>
          <ThemedText type="small" themeColor="textSecondary">{t.trial.lockedBody}</ThemedText>
          <ThemedText type="smallBold">{SALES_EMAIL}</ThemedText>
          <Action
            label={t.trial.writeToUs}
            onPress={() => {
              void Linking.openURL(
                `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t.trial.mailSubject)}`
              );
            }}
          />
        </Card>
      </WorkPage>
    );
  }

  // The welcome, once. Marked seen as he dismisses it rather than as it
  // appears: a screen closed by a crash was never read.
  if (!access.active && !access.notice_seen && !dismissed) {
    return (
      <WorkPage topInset title={t.trial.welcomeTitle}>
        <Card>
          {/* The number is the message, so it is set like one: at display size
              on a plain grey panel. Deliberately not the accent — this screen
              keeps its one purple for the one thing to press. */}
          <View style={[styles.hero, { backgroundColor: theme.backgroundGroup }]}>
            <ThemedText style={styles.heroCount}>{access.days_left}</ThemedText>
            <View style={styles.heroWords}>
              <ThemedText style={styles.heroUnit}>
                {t.trial.freeDaysUnit(access.days_left)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t.trial.noCard}</ThemedText>
            </View>
          </View>

          {/* What "everything" means, said as three things rather than as the
              word: generosity is only felt once it is itemised. */}
          <View style={styles.included}>
            {t.trial.included.map((line) => (
              <View key={line} style={styles.includedRow}>
                <Ionicons name="checkmark" size={18} color={theme.textSecondary} />
                <ThemedText type="small" style={styles.includedText}>{line}</ThemedText>
              </View>
            ))}
          </View>

          <Action
            large
            label={t.trial.start}
            onPress={() => {
              setDismissed(true);
              void supabase.rpc('mark_trial_notice_seen');
            }}
          />

          <View style={[styles.rule, { backgroundColor: theme.separator }]} />

          {/* Below the button, so the address never competes with it. */}
          <ThemedText type="small" themeColor="textSecondary">{t.trial.reachUsNow}</ThemedText>
          {/* A bordered row rather than a coloured link: it reads as pressable
              without borrowing the accent the button is holding. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void Linking.openURL(
                `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t.trial.mailSubject)}`
              );
            }}
            style={({ pressed }) => [
              styles.linkRow,
              { borderColor: theme.separator },
              pressed && styles.pressed,
            ]}>
            <Ionicons name="mail-outline" size={18} color={theme.textSecondary} />
            <ThemedText type="smallBold" style={styles.linkLabel}>{SALES_EMAIL}</ThemedText>
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
          </Pressable>
        </Card>
      </WorkPage>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 16, padding: 16 },
  heroCount: { fontSize: 54, lineHeight: 58, fontWeight: '700', letterSpacing: -1.5 },
  heroWords: { flex: 1, gap: 4 },
  heroUnit: { fontSize: 18, lineHeight: 22, fontWeight: '700' },
  included: { gap: 8 },
  includedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  includedText: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, marginTop: 2 },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14,
  },
  linkLabel: { flex: 1 },
  pressed: { opacity: 0.6 },
});
