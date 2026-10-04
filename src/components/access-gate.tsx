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
/** Read as a Moroccan chef reads it; `tel:` wants it without the spaces. */
const SALES_PHONE_LABEL = '+33 7 83 79 22 84';
const SALES_PHONE = '+33783792284';
/** Mirrors `trial_days()` in the database, which is the one that decides. */
const TRIAL_DAYS = 15;

type Access = {
  active: boolean;
  days_left: number;
  locked: boolean;
  notice_seen: boolean;
  /** Single days still there to take before the wall is final. */
  grace_left: number;
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
  const [taking, setTaking] = useState(false);

  const load = useCallback(async () => {
    if (profile?.role !== 'chef') return;
    const { data } = await supabase.rpc('company_access');
    setAccess((data as Access) ?? null);
  }, [profile?.role]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /** Spends one of the three days. The server returns the new access, so the
   *  wall comes down without a second round trip. */
  async function takeDay() {
    setTaking(true);
    const { data } = await supabase.rpc('take_grace_day');
    if (data) setAccess(data as Access);
    else await load();
    setTaking(false);
  }

  if (profile?.role !== 'chef' || !access) return <>{children}</>;

  if (access.locked) {
    return (
      <WorkPage topInset title={t.trial.lockedTitle(TRIAL_DAYS)}>
        <Card>
          {/* Said before anything else, because it is the fear: the work is
              still there. A chef who thinks his devis are gone will not be in
              a mood to talk about anything. */}
          <View style={[styles.hero, { backgroundColor: theme.backgroundGroup }]}>
            <Ionicons name="time-outline" size={38} color={theme.textSecondary} />
            <View style={styles.heroWords}>
              <ThemedText style={styles.heroUnit}>{t.trial.lockedHead}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t.trial.lockedKept}</ThemedText>
            </View>
          </View>

          <ThemedText type="small" themeColor="textSecondary">{t.trial.lockedBody}</ThemedText>

          {/* The phone carries the accent: at this point a call settles in two
              minutes what e-mail takes two days to. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => { void Linking.openURL(`tel:${SALES_PHONE}`); }}
            style={({ pressed }) => [
              styles.linkRow,
              { backgroundColor: theme.accent, borderColor: theme.accent },
              pressed && styles.pressed,
            ]}>
            <Ionicons name="call-outline" size={18} color={theme.buttonText} />
            <ThemedText type="smallBold" style={[styles.linkLabel, { color: theme.buttonText }]}>
              {SALES_PHONE_LABEL}
            </ThemedText>
            <Ionicons name="chevron-forward" size={16} color={theme.buttonText} />
          </Pressable>

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

          {/* Three days he can take while the call is being arranged. Not an
              escape — the count is on the company and the database holds it —
              but a locked-out chef with a crew on site tomorrow needs a door,
              and a man who had to break one does not sign a contract. */}
          {access.grace_left > 0 && (
            <>
              <View style={[styles.rule, { backgroundColor: theme.separator }]} />
              <Action
                secondary
                busy={taking}
                label={t.trial.takeDay}
                onPress={() => { void takeDay(); }}
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                {t.trial.daysLeftToTake(access.grace_left)}
              </ThemedText>
            </>
          )}
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
          {/* Bordered rows rather than coloured links: they read as pressable
              without borrowing the accent Commencer is holding. */}
          <View style={styles.links}>
            {([
              ['call-outline', SALES_PHONE_LABEL, `tel:${SALES_PHONE}`],
              ['mail-outline', SALES_EMAIL,
                `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t.trial.mailSubject)}`],
            ] as const).map(([icon, label, url]) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                onPress={() => { void Linking.openURL(url); }}
                style={({ pressed }) => [
                  styles.linkRow,
                  { borderColor: theme.separator },
                  pressed && styles.pressed,
                ]}>
                <Ionicons name={icon} size={18} color={theme.textSecondary} />
                <ThemedText type="smallBold" style={styles.linkLabel}>{label}</ThemedText>
                <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
              </Pressable>
            ))}
          </View>
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
  links: { gap: 8 },
  included: { gap: 8 },
  includedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  includedText: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, marginTop: 2 },
  centered: { textAlign: 'center' },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14,
  },
  linkLabel: { flex: 1 },
  pressed: { opacity: 0.6 },
});
