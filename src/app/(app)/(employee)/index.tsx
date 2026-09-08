import { useRef, useState } from 'react';
import { Action, Card, Feedback, NumberWheel, Select, WorkPage } from '@/components/work-ui';
import { ThemedText } from '@/components/themed-text';
import { PresenceNotice } from '@/components/presence-notice';
import { LiveNotice } from '@/components/live-notice';
import { TaskForm } from '@/components/task-form';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useWorkspace } from '@/hooks/use-workspace';
import { capturePresence, NOTICE_VERSION } from '@/lib/presence';
import { LIVE_NOTICE_VERSION } from '@/lib/live-location';
import { enablePresenceNotifications } from '@/lib/presence-notifications';
import { supabase } from '@/lib/supabase';
import { workCopy } from '@/lib/work-copy';

export default function EmployeeHomeScreen() {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const { data, loading, error, refresh, now, consented, liveConsented } = useWorkspace();
  const [site, setSite] = useState('');
  const [duration, setDuration] = useState('8');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pushWarning, setPushWarning] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const lock = useRef(false);
  async function act(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setActionError(null);
    try { await operation(); await refresh(); }
    catch (e) { setActionError(e instanceof Error ? e.message : copy.failed); }
    finally { lock.current = false; setBusy(false); }
  }
  async function consent(accepted: boolean) {
    const { error: failure } = await supabase.rpc('set_presence_consent', { accepted, version: NOTICE_VERSION });
    if (failure) throw failure;
    if (accepted) setPushWarning(!await enablePresenceNotifications(locale));
    setShowNotice(false);
  }
  async function liveConsent(accepted: boolean) {
    const { error: failure } = await supabase.rpc('set_live_location_consent', { accepted, version: LIVE_NOTICE_VERSION });
    if (failure) throw failure;
  }
  const active = !!data?.day && !data.day.ended_at && Date.parse(data.day.planned_end_at) > now;
  const pending = active ? data.requests.find(r => Date.parse(r.expires_at) > now && !data.checks.some(c => c.request_id === r.id)) : undefined;
  const missed = data?.requests.filter(r => Date.parse(r.expires_at) <= now && !data.checks.some(c => c.request_id === r.id)).length ?? 0;
  return <WorkPage title={copy.dayTitle} subtitle={copy.daySubtitle}>
    {loading && <ThemedText>{copy.loading}</ThemedText>}
    <Feedback message={error || actionError} />
    {error && <Action secondary label={copy.retry} onPress={() => { void refresh(); }} />}
    {profile && !profile.is_active ? <Card><ThemedText>{copy.inactive}</ThemedText></Card> : data && <>
      {(!consented || showNotice) && <PresenceNotice accepted={consented} busy={busy} onAccept={() => { void act(() => consent(true)); }} onWithdraw={() => { void act(() => consent(false)); }} />}
      {consented && !data.day && <Card>
        {data.sites.length ? <>
          <Select label={copy.chooseSite} value={site} options={data.sites.map(s => ({ value: s.id, label: s.name }))} onChange={setSite} />
          <NumberWheel label={copy.duration} value={Number(duration)} values={[4, 8, 10]} onChange={n => setDuration(String(n))} />
          <Action label={copy.start} disabled={!site} busy={busy} onPress={() => { void act(async () => {
            setPushWarning(!await enablePresenceNotifications(locale));
            const { error: failure } = await supabase.rpc('start_work_day', { declared_site_id: site, duration_hours: Number(duration) });
            if (failure) throw failure;
          }); }} />
        </> : <ThemedText>{copy.noSites}</ThemedText>}
      </Card>}
      {consented && data.location_mode === 'live' && <LiveNotice accepted={!!liveConsented} busy={busy}
        onAccept={() => { void act(() => liveConsent(true)); }}
        onWithdraw={() => { void act(() => liveConsent(false)); }} />}
      {data.day && <Card accent>
        <ThemedText type="small" themeColor="accentText">{active ? copy.today : copy.dayDone}</ThemedText>
        <ThemedText style={{ fontSize: 24, fontWeight: '700' }}>{data.sites.find(s => s.id === data.day?.site_id)?.name ?? copy.site}</ThemedText>
        <ThemedText themeColor="textSecondary">{data.checks.length} {copy.checksDone}</ThemedText>
        {data.location_mode === 'live' && <ThemedText type="small" themeColor={liveConsented ? 'accentText' : 'textSecondary'}>
          {liveConsented ? copy.liveOn : copy.liveOff}</ThemedText>}
        {!!missed && <ThemedText>{missed} · {copy.missed}</ThemedText>}
      </Card>}
      {active && <>
        <Card accent={!!pending}>
          <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{pending ? copy.requestReady : copy.waiting}</ThemedText>
          {pending ? <>
            <ThemedText themeColor="accentText">{copy.deadline} {new Date(pending.expires_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</ThemedText>
            <ThemedText themeColor="textSecondary">{copy.captureHint}</ThemedText>
            <Action label={copy.capture} busy={busy} onPress={() => { void act(async () => { await capturePresence(pending.id, profile!.id, locale); }); }} />
          </> : <ThemedText themeColor="textSecondary">{copy.waitingHint}</ThemedText>}
          {pushWarning && <ThemedText themeColor="warning" type="small">{copy.pushUnavailable}</ThemedText>}
          <Action secondary label={copy.refresh} onPress={() => { void refresh(); }} />
        </Card>
        <TaskForm data={data} onSaved={refresh} />
        {confirmFinish && <Card><ThemedText>{copy.finishConfirm}</ThemedText></Card>}
        <Action secondary label={copy.finish} busy={busy} onPress={() => {
          if (!confirmFinish) { setConfirmFinish(true); return; }
          void act(async () => { const { error: failure } = await supabase.rpc('end_work_day', { day_id: data.day!.id }); if (failure) throw failure; setConfirmFinish(false); });
        }} />
        {confirmFinish && <Action secondary label={copy.cancel} onPress={() => setConfirmFinish(false)} />}
      </>}
      {consented && <Action secondary label={showNotice ? copy.close : copy.info} onPress={() => setShowNotice(!showNotice)} />}
    </>}
  </WorkPage>;
}
