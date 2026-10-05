import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Action, Card, Feedback, NumberWheel, Select, ShiftSpan, WorkPage } from '@/components/work-ui';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { serverMessage } from '@/lib/i18n/server-errors';
import { EmployeeLiveMap } from '@/components/employee-live-map';
import { DeclaredTasks } from '@/components/declared-tasks';
import { PresenceHistory } from '@/components/screens/presence-history';
import { SafetyCard } from '@/components/safety-card';
import { ZoneTime } from '@/components/zone-time';
import { DayHistory, PastDayView, formatDay, useDayHistory } from '@/components/day-history';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useWorkspace } from '@/hooks/use-workspace';
import { captureDayProof, capturePresence } from '@/lib/presence';
import { enablePresenceNotifications } from '@/lib/presence-notifications';
import { supabase } from '@/lib/supabase';
import { formatElapsed, workCopy } from '@/lib/work-copy';

const clock = (ms: number, locale: string) =>
  new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

/** 7.5 is read as "7 h 30"; a worker does not declare seven and a half hours. */
function formatDuration(hours: number) {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes ? `${whole} h ${minutes}` : `${whole} h`;
}

export default function EmployeeHomeScreen() {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const theme = useTheme();
  const copy = workCopy(locale);
  const { data, loading, error, refresh, now, consented, liveConsented, watchAvailable, watchEnabled } = useWorkspace();
  const [site, setSite] = useState('');
  const [duration, setDuration] = useState('8');
  // Counts refusals rather than recording one: the field lights again on every
  // press, where a boolean would answer the first and ignore the rest. Zero is
  // "nobody has tried yet", and a field is not wrong until somebody has.
  const [refusals, setRefusals] = useState(0);
  const [proofsOpen, setProofsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pushWarning, setPushWarning] = useState(false);
  const history = useDayHistory();
  // null means today; a date shows that day in place of the live screen.
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const lock = useRef(false);
  async function act(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setActionError(null);
    try { await operation(); await refresh(); }
    // A Supabase failure is a plain object, not an Error, so testing for Error
    // threw away every reason the server gave and showed "could not load the
    // data" instead — for an action, where nothing was being loaded.
    catch (e) { setActionError(serverMessage(e, copy.failed, locale)); }
    finally { lock.current = false; setBusy(false); }
  }
  const active = !!data?.day && !data.day.ended_at && Date.parse(data.day.planned_end_at) > now;
  const pending = active ? data.requests.find(r => Date.parse(r.expires_at) > now && !data.checks.some(c => c.request_id === r.id)) : undefined;
  const liveSharing = data?.location_mode === 'live' && !!liveConsented;
  function confirmCancelDay() {
    if (!data?.day) return;
    // Confirms the long press landed, before the dialog covers the card.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(copy.cancelDay, copy.cancelDayConfirm, [
      { text: copy.cancel, style: 'cancel' },
      { text: copy.cancelDay, style: 'destructive', onPress: () => { void act(async () => {
        const { error: failure } = await supabase.rpc('cancel_work_day', { day_id: data.day!.id });
        if (failure) throw failure;
      }); } },
    ]);
  }
  const missed = data?.requests.filter(r => Date.parse(r.expires_at) <= now && !data.checks.some(c => c.request_id === r.id)).length ?? 0;
  const pickedDays = picked ? (history.days ?? []).filter(day => day.work_date === picked) : [];

  return <WorkPage
    title={picked ? formatDay(picked, locale) : copy.dayTitle}
    titleAccessory={<DayHistory days={history.days} error={history.error}
      onOpen={() => { void history.load(); }} onPick={setPicked} />}>
    {picked ? <>
      <Action secondary label={copy.backToToday} onPress={() => setPicked(null)} />
      <PastDayView days={pickedDays} />
    </> : <>
    {loading && <ThemedText>{copy.loading}</ThemedText>}
    <Feedback message={error || actionError} />
    {error && <Action secondary label={copy.retry} onPress={() => { void refresh(); }} />}
    {profile && !profile.is_active ? <Card><ThemedText>{copy.inactive}</ThemedText></Card> : data && <>
      {/* Only while the day is running. A finished day is a record, and a
          record belongs in the history behind the arrow by the title, not at
          the top of the screen where the next day is started: a worker about
          to begin his second day was reading yesterday's totals first.
          Long-press cancels a day declared by mistake; the destructive path
          stays out of reach of a normal tap, and the server refuses once the
          day produced work. */}
      {active && data.day && <Pressable onLongPress={active ? confirmCancelDay : undefined}
        accessibilityRole={active ? 'button' : undefined}
        accessibilityHint={active ? copy.cancelDayHint : undefined}
        style={({ pressed }) => pressed && active ? { opacity: 0.7 } : undefined}>
        <Card accent>
        <ThemedText type="small" themeColor="accentText">{copy.today}</ThemedText>
        <ThemedText style={{ fontSize: 24, fontWeight: '700' }}>{data.sites.find(s => s.id === data.day?.site_id)?.name ?? copy.site}</ThemedText>
        {/* Counts up from the declared start. `now` already ticks every second
            in useWorkspace, and the card is gone by the time the day ends. */}
        <ThemedText themeColor="textSecondary">
          {copy.elapsedLabel} : {formatElapsed(now - Date.parse(data.day.started_at), copy)}
        </ThemedText>
        {data.location_mode === 'live' && <ThemedText type="small" themeColor={liveConsented ? 'accentText' : 'textSecondary'}>
          {liveConsented ? copy.liveOn : copy.liveOff}</ThemedText>}
        {/* Only meaningful while sharing: without positions there is nothing to
            classify — and the day's own length is passed in so the part of it
            no position accounts for is named rather than silently dropped. */}
        {liveSharing && <ZoneTime
          secondsInside={data.day.seconds_inside}
          secondsOutside={data.day.seconds_outside}
          secondsElapsed={Math.max(0, Math.round((now - Date.parse(data.day.started_at)) / 1000))} />}
        {!!missed && <ThemedText>{missed} · {copy.missed}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">{copy.cancelDayHint}</ThemedText>
        </Card>
      </Pressable>}
      {active && <>
        {/* A pending check always takes the screen. Otherwise, live sharing replaces
            the idle "nothing to do" card with the position actually being shared. */}
        {pending ? <Card accent>
          <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{copy.requestReady}</ThemedText>
          <ThemedText themeColor="accentText">{copy.deadline} {new Date(pending.expires_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</ThemedText>
          <ThemedText themeColor="textSecondary">{copy.captureHint}</ThemedText>
          <Action label={copy.capture} busy={busy} onPress={() => { void act(async () => { await capturePresence(pending.id, profile!.id, locale); }); }} />
          {pushWarning && <ThemedText themeColor="warning" type="small">{copy.pushUnavailable}</ThemedText>}
          <Action secondary label={copy.refresh} onPress={() => { void refresh(); }} />
        </Card> : liveSharing ? <EmployeeLiveMap /> : <Card>
          <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{copy.waiting}</ThemedText>
          <ThemedText themeColor="textSecondary">{copy.waitingHint}</ThemedText>
          {pushWarning && <ThemedText themeColor="warning" type="small">{copy.pushUnavailable}</ThemedText>}
          <Action secondary label={copy.refresh} onPress={() => { void refresh(); }} />
        </Card>}
        {/* Read-only: declaring stays in the Tasks tab, this is the day's tally. */}
        <Card>
          <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{copy.tasksDone}</ThemedText>
          <DeclaredTasks data={data} />
        </Card>
        {confirmFinish && <Card><ThemedText>{copy.finishConfirm}</ThemedText></Card>}
        <Action large tone="finish" label={copy.finish} busy={busy} onPress={() => {
          if (!confirmFinish) { setConfirmFinish(true); return; }
          void act(async () => { const { error: failure } = await supabase.rpc('end_work_day', { day_id: data.day!.id }); if (failure) throw failure; setConfirmFinish(false); });
        }} />
        {confirmFinish && <Action secondary label={copy.cancel} onPress={() => setConfirmFinish(false)} />}
      </>}
      {consented && !active && <Card>
        {data.sites.length ? <>
          <Select
            label={copy.chooseSite}
            value={site}
            missing={refusals > 0}
            refusedAt={refusals}
            options={data.sites.map(s => ({
              value: s.id,
              label: s.name,
              note: s.awaiting ? copy.awaitingHere : undefined,
            }))}
            onChange={value => { setSite(value); setRefusals(0); }} />
          <NumberWheel
            label={copy.duration}
            value={Number(duration)}
            min={1}
            max={12}
            step={0.5}
            decimals={1}
            format={formatDuration}
            onChange={n => setDuration(String(n))} />
          {/* The two hours the day would run between, if it started now. The
              server stamps the real end from its own clock a few seconds later,
              so these are near rather than exact — which nobody reading a
              planned duration takes them for. */}
          <ShiftSpan
            startLabel={copy.startsLabel}
            endLabel={copy.endsLabel}
            start={clock(now, locale)}
            end={clock(now + Number(duration) * 3_600_000, locale)}
            middle={formatDuration(Number(duration))} />
          {/* Pressable even with no chantier chosen: a button that does nothing
              when pressed cannot say why, and "nothing happened" is the worst
              answer a screen can give. It points at what is missing instead. */}
          <Action large tone="start" label={copy.start} busy={busy} onPress={() => {
            if (!site) {
              setRefusals(n => n + 1);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              return;
            }
            void act(async () => {
              setPushWarning(!await enablePresenceNotifications(locale));
              // What his chef requires before the day may start. One step, a
              // shot for each thing asked for, in the order they are listed
              // on his card. Backing out of the camera is a decision not to
              // start the day, so it stops here rather than failing.
              let equipment: Awaited<ReturnType<typeof captureDayProof>> = null;
              let clockIn: Awaited<ReturnType<typeof captureDayProof>> = null;
              if (data.equipment_photo_required) {
                equipment = await captureDayProof('equipment', profile!.id, locale);
                if (!equipment) return;
              }
              if (data.clock_in_photo_required) {
                clockIn = await captureDayProof('clock_in', profile!.id, locale);
                if (!clockIn) return;
              }
              const where = equipment ?? clockIn;
              const { error: failure } = await supabase.rpc('start_work_day', {
                declared_site_id: site,
                duration_hours: Number(duration),
                equipment_photo: equipment?.path ?? null,
                clock_in_photo: clockIn?.path ?? null,
                lat: where?.accuracy ? where.latitude : null,
                lng: where?.accuracy ? where.longitude : null,
                accuracy: where?.accuracy || null,
                // This build has the camera step, so the chef's requirement
                // may be enforced against it. A build that predates this says
                // nothing and is refused nothing, rather than being locked
                // out of its own work days by a setting it cannot satisfy.
                can_photograph: true,
              });
              if (failure) throw failure;
            });
          }} />
        </> : <ThemedText>{copy.noSites}</ThemedText>}
      </Card>}
      {/* The proofs already given, under the day they belong to: a tab of its
          own pushed the employee's six tabs into iOS's "More" list. Folded,
          because he has no reason to read them unless something is disputed,
          and open they are the longest thing on the screen. */}
      {consented && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: proofsOpen }}
          onPress={() => setProofsOpen((current) => !current)}
          style={({ pressed }) => [styles.disclosure, pressed && { opacity: 0.6 }]}>
          <ThemedText type="smallBold" style={{ flex: 1 }}>{copy.proofsTitle}</ThemedText>
          <Ionicons
            name={proofsOpen ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={theme.textSecondary}
          />
        </Pressable>
      )}
      {consented && proofsOpen && <PresenceHistory />}

      {/* Protection du travailleur isolé, last on the screen at the chef's
          request. It is the one thing here somebody reaches for hurt, so it
          stays a full card rather than a line in a list. */}
      {/* Gone entirely when the company has the feature off — card, switch
          and alert button. Half a safety feature on a screen is worse than
          none: a man who can see a shield reads it as somebody watching. */}
      {consented && profile && watchAvailable && <SafetyCard
        dayOpen={!!active}
        employeeId={profile.id}
        watchOn={watchEnabled}
        asked={!!data.lone_worker_asked}
        onChanged={() => { void refresh(); }} />}
    </>}
    </>}
  </WorkPage>;
}

const styles = StyleSheet.create({
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
});
