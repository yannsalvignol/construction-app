import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { LiveNotice } from '@/components/live-notice';
import { PresenceNotice } from '@/components/presence-notice';
import { ThemedText } from '@/components/themed-text';
import { Feedback, WorkPage } from '@/components/work-ui';
import { Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import { LIVE_NOTICE_VERSION } from '@/lib/live-location';
import { NOTICE_VERSION } from '@/lib/presence';
import { serverMessage } from '@/lib/i18n/server-errors';
import { supabase } from '@/lib/supabase';
import { workCopy } from '@/lib/work-copy';

/**
 * What the worker agreed to, and how to take it back.
 *
 * It used to live on the day screen behind an "Information et accord" button
 * at the very bottom, which opened the text at the very top — so pressing it
 * appeared to do nothing, and the two halves of one thing sat a screenful
 * apart. It is a page now, reached from the settings, where somebody goes when
 * they want to read it rather than when they are trying to start a day.
 */
export function ConsentScreen() {
  const { locale, t } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const { data, loading, error, refresh, consented, liveConsented } = useWorkspace({ manageSharing: false });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const lock = useRef(false);

  async function act(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setFailure(null);
    try { await operation(); await refresh(); }
    catch (e) { setFailure(serverMessage(e, copy.failed, locale)); }
    finally { lock.current = false; setBusy(false); }
  }

  // Pushed over the tabs, so nothing above it holds the heading clear of the
  // status bar — which is where it had ended up.
  return <WorkPage topInset title={copy.info} titleAccessory={
    // Pushed over the tabs with no header of its own, so the way back has to
    // be on the page: a swipe is not a way out an ouvrier will look for.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.common.back}
      hitSlop={10}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
      style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}>
      <Ionicons name="close" size={26} color={theme.textSecondary} />
    </Pressable>
  }>
    {loading && !data && <ThemedText>{copy.loading}</ThemedText>}
    <Feedback message={error || failure} />
    {data && <>
      <PresenceNotice
        accepted={consented}
        busy={busy}
        onAccept={() => { void act(async () => {
          const { error: e } = await supabase.rpc('set_presence_consent', { accepted: true, version: NOTICE_VERSION });
          if (e) throw e;
        }); }}
        onWithdraw={() => { void act(async () => {
          const { error: e } = await supabase.rpc('set_presence_consent', { accepted: false, version: NOTICE_VERSION });
          if (e) throw e;
        }); }}
      />

      {/* Only where live sharing applies: a worker on checkpoint mode has
          nothing to agree to here, and a second notice he cannot act on is
          the clutter this page exists to undo. */}
      {data.location_mode === 'live' && (
        <LiveNotice
          accepted={!!liveConsented}
          busy={busy}
          onAccept={() => { void act(async () => {
            const { error: e } = await supabase.rpc('set_live_location_consent', { accepted: true, version: LIVE_NOTICE_VERSION });
            if (e) throw e;
          }); }}
          onWithdraw={() => { void act(async () => {
            const { error: e } = await supabase.rpc('set_live_location_consent', { accepted: false, version: LIVE_NOTICE_VERSION });
            if (e) throw e;
          }); }}
        />
      )}
    </>}
  </WorkPage>;
}

const styles = StyleSheet.create({
  back: { padding: Spacing.one },
});
