import { useRef, useState } from 'react';
import { Action, Feedback, WorkPage } from './work-ui';
import { ThemedText } from './themed-text';
import { PresenceNotice } from './presence-notice';
import { LiveNotice } from './live-notice';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useWorkspace } from '@/hooks/use-workspace';
import { supabase } from '@/lib/supabase';
import { NOTICE_VERSION } from '@/lib/presence';
import { LIVE_NOTICE_VERSION } from '@/lib/live-location';
import { workCopy } from '@/lib/work-copy';

/**
 * Stands in front of the employee tabs until every required agreement is given.
 * Nothing in the app collects anything before this point, so a decision here is
 * made before any data is gathered rather than after the fact.
 *
 * Signing out stays reachable: the agreement has to be refusable to be an
 * agreement at all, and trapping somebody inside the app would make it coercion.
 */
export function ConsentGate({ children }: { children: React.ReactNode }) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const { profile, signOut } = useAuth();
  const { data, loading, error, refresh, consented, liveConsented } = useWorkspace({ manageSharing: false });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const lock = useRef(false);

  async function act(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setActionError(null);
    try { await operation(); await refresh(); }
    catch (failure) { setActionError(failure instanceof Error ? failure.message : copy.failed); }
    finally { lock.current = false; setBusy(false); }
  }

  // A suspended account is handled by the screens themselves, which explain it.
  if (!profile || profile.role !== 'employee' || !profile.is_active) return <>{children}</>;
  if (loading && !data) return <WorkPage title={copy.gateTitle}><ThemedText>{copy.loading}</ThemedText></WorkPage>;
  if (!data) {
    return <WorkPage title={copy.gateTitle}>
      <Feedback message={error} />
      <Action secondary label={copy.retry} onPress={() => { void refresh(); }} />
    </WorkPage>;
  }

  const liveRequired = data.location_mode === 'live';
  if (consented && (!liveRequired || liveConsented)) return <>{children}</>;

  return <WorkPage title={copy.gateTitle} subtitle={copy.gateHint}>
    <Feedback message={actionError} />
    {!consented && <PresenceNotice accepted={false} busy={busy}
      onAccept={() => { void act(async () => {
        const { error: failure } = await supabase.rpc('set_presence_consent', { accepted: true, version: NOTICE_VERSION });
        if (failure) throw failure;
      }); }}
      onWithdraw={() => { /* nothing to withdraw before accepting */ }} />}

    {/* The live agreement is only asked of employees the chef switched to live. */}
    {consented && liveRequired && !liveConsented && <LiveNotice accepted={false} busy={busy}
      onAccept={() => { void act(async () => {
        const { error: failure } = await supabase.rpc('set_live_location_consent', { accepted: true, version: LIVE_NOTICE_VERSION });
        if (failure) throw failure;
      }); }}
      onWithdraw={() => { /* nothing to withdraw before accepting */ }} />}

    <Action secondary label={copy.signOut} onPress={() => { void signOut(); }} />
  </WorkPage>;
}
