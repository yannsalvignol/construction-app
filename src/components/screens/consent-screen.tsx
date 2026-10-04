import { useRef, useState } from 'react';

import { LiveNotice } from '@/components/live-notice';
import { PresenceNotice } from '@/components/presence-notice';
import { ThemedText } from '@/components/themed-text';
import { Feedback, WorkPage } from '@/components/work-ui';
import { useI18n } from '@/hooks/use-i18n';
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
  const { locale } = useI18n();
  const copy = workCopy(locale);
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

  return <WorkPage title={copy.info}>
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
