import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { cardShadow, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { fetchOpenAlerts, resolveAlert, type OpenAlert } from '@/lib/lone-worker';

/** Somebody may be hurt: this is checked far more often than a dashboard. */
const POLL_MS = 20_000;

/**
 * Open safety alerts, at the top of the chef's screen.
 *
 * Deliberately loud and impossible to scroll past: an alert that waits for
 * the chef to notice it is not a safety feature. Clearing one is an explicit
 * statement that he has taken charge, recorded with his name.
 */
export function SafetyAlerts() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useI18n();

  const [alerts, setAlerts] = useState<OpenAlert[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setAlerts(await fetchOpenAlerts()); } catch { /* the rest of the screen still works */ }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void load();
      }, POLL_MS);
      return () => clearInterval(timer);
    }, [load])
  );

  if (!alerts.length) return null;

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  async function acknowledge(alert: OpenAlert) {
    setBusy(alert.id);
    try { await resolveAlert(alert.id); await load(); }
    finally { setBusy(null); }
  }

  return (
    <View style={styles.wrap}>
      {alerts.map((alert) => (
        <View
          key={alert.id}
          style={[styles.card, cardShadow(theme.isDark), { backgroundColor: theme.danger }]}>
          <View style={styles.head}>
            <Ionicons name="warning" size={22} color={theme.buttonText} />
            <ThemedText style={[styles.kind, { color: theme.buttonText }]}>
              {t.safetyChef[alert.kind]}
            </ThemedText>
          </View>

          <ThemedText style={{ color: theme.buttonText, fontSize: 20, fontWeight: '700' }}>
            {alert.employee_name}
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.buttonText, opacity: 0.9 }}>
            {[alert.site_name, t.safetyChef.at(time(alert.raised_at))].filter(Boolean).join(' · ')}
          </ThemedText>

          <View style={styles.actions}>
            {alert.latitude != null && (
              <Pressable
                onPress={() => router.push('/live')}
                style={({ pressed }) => [
                  styles.action,
                  { borderColor: theme.buttonText },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                  {t.safetyChef.seeOnMap}
                </ThemedText>
              </Pressable>
            )}
            <Pressable
              disabled={busy === alert.id}
              onPress={() => { void acknowledge(alert); }}
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: theme.buttonText, borderColor: theme.buttonText },
                (pressed || busy === alert.id) && styles.pressed,
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.danger }}>
                {t.safetyChef.acknowledge}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // The page already spaces cards 20 apart; an alert is not one more card in the
  // list, so it gets a wider break beneath it than the run of ordinary ones.
  wrap: { gap: Spacing.two, marginBottom: Spacing.three },
  card: { borderRadius: Spacing.three + Spacing.one, padding: Spacing.three, gap: Spacing.one },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  kind: { fontSize: 15, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  action: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
