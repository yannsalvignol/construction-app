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

/** Where a locked chef is told to write. */
export const SALES_EMAIL = 'melanie@casprod.app';
const PRICING_URL = 'https://casprod.app/pricing';
/** The address as it is read on the page, without the scheme nobody says out loud. */
const PRICING_LABEL = 'casprod.app/pricing';

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
          <Action secondary label={t.trial.seePricing} onPress={() => { void Linking.openURL(PRICING_URL); }} />
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
          {/* The number is the message, so it is set like one: an accent panel
              at the head of the card with the count at display size. A chef who
              has just signed up should see what he was given before he reads a
              word about it. */}
          <View style={[styles.hero, { backgroundColor: theme.accent }]}>
            <ThemedText style={[styles.heroCount, { color: theme.buttonText }]}>
              {access.days_left}
            </ThemedText>
            <View style={styles.heroWords}>
              <ThemedText style={[styles.heroUnit, { color: theme.buttonText }]}>
                {t.trial.freeDaysUnit(access.days_left)}
              </ThemedText>
              <ThemedText type="small" style={[styles.heroNote, { color: theme.buttonText }]}>
                {t.trial.noCard}
              </ThemedText>
            </View>
          </View>

          {/* What "everything" means, said as three things rather than as the
              word: generosity is only felt once it is itemised. */}
          <View style={styles.included}>
            {t.trial.included.map((line) => (
              <View key={line} style={styles.includedRow}>
                <Ionicons name="checkmark-circle" size={20} color={theme.accentText} />
                <ThemedText type="small" style={styles.includedText}>{line}</ThemedText>
              </View>
            ))}
          </View>

          <ThemedText type="small" themeColor="textSecondary">{t.trial.welcomeBody}</ThemedText>

          <Action
            large
            label={t.trial.start}
            onPress={() => {
              setDismissed(true);
              void supabase.rpc('mark_trial_notice_seen');
            }}
          />

          <View style={[styles.rule, { backgroundColor: theme.separator }]} />

          {/* Not "later, when the trial ends" — both doors are open today, and
              they sit below the button so they never compete with it. */}
          <ThemedText type="small" themeColor="textSecondary">{t.trial.reachUsNow}</ThemedText>
          <View style={styles.links}>
            <Pressable
              style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
              onPress={() => {
                void Linking.openURL(
                  `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t.trial.mailSubject)}`
                );
              }}>
              <Ionicons name="mail-outline" size={18} color={theme.accentText} />
              <ThemedText type="linkPrimary">{SALES_EMAIL}</ThemedText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
              onPress={() => { void Linking.openURL(PRICING_URL); }}>
              <Ionicons name="pricetag-outline" size={18} color={theme.accentText} />
              <ThemedText type="linkPrimary">{PRICING_LABEL}</ThemedText>
            </Pressable>
          </View>
        </Card>
      </WorkPage>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 18, borderRadius: 16, padding: 20 },
  heroCount: { fontSize: 64, lineHeight: 68, fontWeight: '700', letterSpacing: -2 },
  heroWords: { flex: 1, gap: 4 },
  heroUnit: { fontSize: 19, lineHeight: 24, fontWeight: '700' },
  /** White on the accent, dimmed rather than greyed: a grey would muddy it. */
  heroNote: { opacity: 0.85 },
  included: { gap: 10 },
  includedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  includedText: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, marginTop: 2 },
  links: { gap: 10 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pressed: { opacity: 0.6 },
});
