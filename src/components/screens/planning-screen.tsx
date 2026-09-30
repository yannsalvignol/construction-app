import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppModal, ModalButton } from '@/components/app-modal';
import { ThemedText } from '@/components/themed-text';
import { Card, WorkPage } from '@/components/work-ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { useCached } from '@/hooks/use-cached';
import { loadPlanning, planningKey } from '@/lib/tab-data';

type Scope = 'me' | 'team';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
const hm = (t: string) => t.slice(0, 5);

/**
 * Read-only planning. Shifts are created and sent from the web workspace; the
 * phone only shows what was sent. The chef sees the whole team, an employee
 * their own days (RLS hides everything else).
 */
export function PlanningScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { profile } = useAuth();
  const isChef = profile?.role === 'chef';
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [selected, setSelected] = useState(() => iso(new Date()));
  const [scope, setScope] = useState<Scope>('me');

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const today = iso(new Date());

  // Cached per week: stepping back to a week already seen redraws it at once,
  // and the home screen warms the current one before this tab is opened.
  const companyId = profile?.company_id ?? '';
  const loader = useCallback(
    () => loadPlanning(companyId, days[0], days[6]),
    [companyId, days]
  );
  const cached = useCached(planningKey(companyId, days[0]), loader);
  const shifts = cached.data ?? [];
  const error = cached.error ? t.planning.failed : null;

  const [infoOpen, setInfoOpen] = useState(false);

  const dayShifts = shifts.filter((s) => s.work_date === selected && (!isChef || scope === 'team' || s.employee_id === profile?.id));
  const weekHours = shifts.filter((s) => s.employee_id === profile?.id).reduce((n, s) => {
    const [a, b] = [s.start_time, s.end_time].map((x) => { const [h, m] = x.split(':').map(Number); return h + m / 60; });
    return n + (b - a);
  }, 0);
  const dayLabel = (d: string) => { const x = parse(d); return `${t.schedule.weekdaysFull[(x.getDay() + 6) % 7]} ${x.getDate()} ${t.schedule.months[x.getMonth()]}`; };

  return (
    <WorkPage
      title={t.schedule.title}
      // Where the plannings come from is read once and never again, so it sits
      // behind the ⓘ rather than above every week of the year.
      titleAccessory={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.schedule.title}
          hitSlop={10}
          onPress={() => setInfoOpen(true)}>
          <Ionicons name="information-circle-outline" size={22} color={theme.textSecondary} />
        </Pressable>
      }>
      <View style={styles.weekNav}>
        <Pressable hitSlop={8} onPress={() => { setWeek(addDays(week, -7)); setSelected(addDays(week, -7)); }}><Ionicons name="chevron-back" size={20} color={theme.textSecondary} /></Pressable>
        <ThemedText type="smallBold">{t.planning.weekOf(dayLabel(days[0]))}</ThemedText>
        <Pressable hitSlop={8} onPress={() => { setWeek(addDays(week, 7)); setSelected(addDays(week, 7)); }}><Ionicons name="chevron-forward" size={20} color={theme.textSecondary} /></Pressable>
      </View>
      <View style={styles.weekStrip}>
        {days.map((d, i) => {
          const isSelected = d === selected, isToday = d === today;
          const has = shifts.some((s) => s.work_date === d && (!isChef || scope === 'team' || s.employee_id === profile?.id));
          return (
            <Pressable key={d} style={styles.weekDayTouchable} onPress={() => setSelected(d)}>
              <View style={[styles.weekDay, { backgroundColor: isSelected ? theme.accent : 'transparent', borderColor: isToday && !isSelected ? theme.accent : theme.backgroundSelected }]}>
                <ThemedText type="small" themeColor={isSelected ? 'buttonText' : 'textSecondary'}>{t.schedule.weekdayLetters[i]}</ThemedText>
                <ThemedText type="smallBold" themeColor={isSelected ? 'buttonText' : 'text'}>{parse(d).getDate()}</ThemedText>
                <View style={[styles.dot, { backgroundColor: has ? (isSelected ? theme.buttonText : theme.accent) : 'transparent' }]} />
              </View>
            </Pressable>
          );
        })}
      </View>
      {isChef && (
        <View style={styles.filtersRow}>
          {(['me', 'team'] as Scope[]).map((key) => (
            <Pressable key={key} onPress={() => setScope(key)}>
              <View style={[styles.pill, { borderColor: scope === key ? theme.accent : theme.backgroundSelected }]}>
                <ThemedText type="small" themeColor={scope === key ? 'accentText' : 'textSecondary'}>{t.schedule.scopes[key]}</ThemedText>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <ThemedText type="small" themeColor="textSecondary">{t.planning.weekTotal(Math.round(weekHours * 10) / 10)}</ThemedText>
      {error && <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>}
      {dayShifts.length === 0 ? (
        <Card>
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={28} color={theme.textSecondary} />
            <ThemedText type="smallBold" style={styles.center}>{selected === today ? t.schedule.noShiftsToday : t.schedule.noShiftsOnDay(dayLabel(selected))}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{isChef && scope === 'team' ? t.schedule.emptyTeam : t.schedule.emptyMe}</ThemedText>
          </View>
        </Card>
      ) : dayShifts.map((s) => (
        <Card key={s.id}>
          <View style={styles.shiftHead}>
            <ThemedText type="smallBold">{hm(s.start_time)} – {hm(s.end_time)}</ThemedText>
            {isChef && scope === 'team' && s.profiles && <ThemedText type="small" themeColor="textSecondary">{s.profiles.first_name} {s.profiles.last_name}</ThemedText>}
          </View>
          <ThemedText type="smallBold">{s.sites?.name ?? '—'}</ThemedText>
          {s.sites?.address && <ThemedText type="small" themeColor="textSecondary">{s.sites.address}</ThemedText>}
          {s.note && <ThemedText type="small">{s.note}</ThemedText>}
        </Card>
      ))}

      <AppModal
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={t.schedule.title}
        icon="calendar-outline"
        actions={<ModalButton label={t.common.done} onPress={() => setInfoOpen(false)} />}>
        <ThemedText type="small" themeColor="textSecondary">
          {isChef ? t.planning.chefHint : t.planning.employeeHint}
        </ThemedText>
      </AppModal>
    </WorkPage>
  );
}

const styles = StyleSheet.create({
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekStrip: { flexDirection: 'row', gap: Spacing.one },
  weekDayTouchable: { flex: 1 },
  weekDay: { alignItems: 'center', gap: 2, paddingVertical: Spacing.two, borderRadius: Spacing.three, borderWidth: 1 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  filtersRow: { flexDirection: 'row', gap: Spacing.two },
  pill: { borderRadius: Spacing.four, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderWidth: 1 },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  center: { textAlign: 'center' },
  shiftHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
