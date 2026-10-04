import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppModal, ModalButton } from '@/components/app-modal';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/work-ui';
import { Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { STILL_FOR_MS } from '@/lib/lone-worker-watch';
import {
  confirmStillFine, fetchMyAlerts, raiseAlert, resolveAlert, setLoneWorkerWatch, type OpenAlert,
} from '@/lib/lone-worker';
import { hasBackgroundLocation } from '@/lib/live-location';

/**
 * Protection du travailleur isolé, from the worker's side.
 *
 * This is his feature, not his chef's: he can see that the watch is running,
 * he can call for help himself, and he can cancel a false alarm without
 * asking anyone. A worker alone in a trench or a plant room has no other way
 * to reach somebody if he is hurt and cannot get to his phone, which is why
 * the watch has to keep running with the screen off.
 */
export function SafetyCard({ dayOpen, employeeId, watchOn, watchAvailable = true, asked, onChanged }: {
  dayOpen: boolean;
  employeeId: string;
  /** Whether the company runs the automatic watch at all. When it does not,
   *  the switch and the "je vous surveille" line go: a card that claims to
   *  watch over a man it is not watching is worse than no card. The SOS stays
   *  — that is him asking for help, and it cannot misfire. */
  watchAvailable?: boolean;
  /** His own choice, as the server holds it. */
  watchOn: boolean;
  /** The server is waiting for him to say he is alright. Only ever true of an
   *  open day — and checked against `dayOpen` again here, because a card that
   *  asks a man on his sofa whether he is still alive is how this feature
   *  stops being believed. */
  asked: boolean;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useI18n();

  const [mine, setMine] = useState<OpenAlert[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // "While Using" is what iOS grants first, and it is not enough for a phone in
  // a pocket. Saying so is the difference between a watch that works and a
  // worker who believes it does.
  const [backgroundGranted, setBackgroundGranted] = useState(true);

  const load = useCallback(async () => {
    try { setMine(await fetchMyAlerts(employeeId)); } catch { /* the card still draws */ }
    setBackgroundGranted(await hasBackgroundLocation());
  }, [employeeId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function setWatch(enabled: boolean) {
    setBusy(true);
    try { await setLoneWorkerWatch(enabled); onChanged(); }
    finally { setBusy(false); }
  }

  async function imFine() {
    setBusy(true);
    try { await confirmStillFine(); await load(); onChanged(); }
    finally { setBusy(false); }
  }

  async function sendSos() {
    setConfirming(false);
    setBusy(true);
    await raiseAlert('sos');
    await load();
    onChanged();
    setBusy(false);
  }

  async function cancel(alert: OpenAlert) {
    setBusy(true);
    try { await resolveAlert(alert.id); await load(); onChanged(); }
    finally { setBusy(false); }
  }

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  return (
    <Card accent={mine.length > 0}>
      <View style={styles.head}>
        <Ionicons
          name={mine.length ? 'alert-circle' : 'shield-checkmark-outline'}
          size={22}
          color={mine.length ? theme.danger : theme.text}
        />
        <ThemedText style={styles.title}>{t.safety.title}</ThemedText>
        {/* How the watch works is read once and never again, so it lives
            behind the icon instead of above the button every day. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.safety.title}
          hitSlop={10}
          onPress={() => setInfoOpen(true)}
          style={({ pressed }) => pressed && styles.pressed}>
          <Ionicons name="information-circle-outline" size={22} color={theme.textSecondary} />
        </Pressable>
      </View>

      {mine.length > 0 ? (
        <>
          {mine.map((alert) => (
            <View key={alert.id} style={styles.row}>
              <ThemedText type="smallBold" style={{ flex: 1, color: theme.danger }}>
                {t.safety.raisedAt(time(alert.raised_at))}
              </ThemedText>
              <Pressable
                disabled={busy}
                onPress={() => { void cancel(alert); }}
                style={({ pressed }) => [
                  styles.cancel,
                  { borderColor: theme.text },
                  (pressed || busy) && styles.pressed,
                ]}>
                <ThemedText type="smallBold">{t.safety.cancel}</ThemedText>
              </Pressable>
            </View>
          ))}
        </>
      ) : asked && dayOpen ? (
        <View style={styles.row}>
          <ThemedText type="smallBold" style={{ flex: 1, color: theme.danger }}>
            {t.safety.askedBody}
          </ThemedText>
          <Pressable
            disabled={busy}
            onPress={() => { void imFine(); }}
            style={({ pressed }) => [styles.cancel, { borderColor: theme.text }, (pressed || busy) && styles.pressed]}>
            <ThemedText type="smallBold">{t.safety.fine}</ThemedText>
          </Pressable>
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {!watchAvailable
            ? t.safety.unavailable
            : !watchOn ? t.safety.off : dayOpen ? t.safety.watching : t.safety.idle}
        </ThemedText>
      )}

      {watchAvailable && watchOn && dayOpen && !backgroundGranted && (
        <ThemedText type="small" style={{ color: theme.danger }}>{t.safety.permissionNeeded}</ThemedText>
      )}

      {/* His phone, his choice. The watch is on until he says otherwise —
          unless his company does not run it, in which case there is nothing
          for him to choose. */}
      {watchAvailable && <View style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
          {t.safety.watchToggle}
        </ThemedText>
        <Switch value={watchOn} disabled={busy} onValueChange={enabled => { void setWatch(enabled); }} />
      </View>}

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => setConfirming(true)}
        style={({ pressed }) => [
          styles.sos,
          { backgroundColor: theme.danger },
          (pressed || busy) && styles.pressed,
        ]}>
        <Ionicons name="warning" size={20} color={theme.buttonText} />
        <ThemedText style={{ color: theme.buttonText, fontSize: 17, fontWeight: '700' }}>
          {t.safety.sos}
        </ThemedText>
      </Pressable>

      <AppModal
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={t.safety.title}
        icon="shield-checkmark-outline"
        actions={<ModalButton label={t.common.done} onPress={() => setInfoOpen(false)} />}>
        <ThemedText type="small" themeColor="textSecondary">
          {t.safety.watchingHint(Math.round(STILL_FOR_MS / 60_000))}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t.safety.sosHint}</ThemedText>
      </AppModal>

      <AppModal
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={t.safety.sosConfirmTitle}
        icon="warning-outline"
        actions={
          <>
            <ModalButton label={t.safety.sosSend} onPress={() => { void sendSos(); }} />
            <ModalButton secondary label={t.common.cancel} onPress={() => setConfirming(false)} />
          </>
        }>
        <ThemedText type="small" themeColor="textSecondary">{t.safety.sosConfirmBody}</ThemedText>
      </AppModal>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { fontSize: 22, fontWeight: '700', flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cancel: {
    minHeight: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sos: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 64,
    borderRadius: Spacing.three,
  },
  pressed: { opacity: 0.6 },
});
