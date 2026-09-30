import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppModal, ModalButton } from '@/components/app-modal';
import { ThemedText } from '@/components/themed-text';
import { cardShadow, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

/**
 * The company's employees, as they stand today: which chantier each one
 * declared, for how long, and whether they have declared any work.
 *
 * Real data throughout — a chef may read their company's profiles, work_days
 * and task_declarations directly. The filters are the two questions actually
 * asked of this list: who is on which chantier, and who has not declared.
 */

type Row = {
  id: string;
  name: string;
  isActive: boolean;
  siteId: string | null;
  siteName: string | null;
  hours: number | null;
  /** The declared day is still running. */
  open: boolean;
  declarations: number;
};

type Status = 'all' | 'present' | 'absent' | 'silent';

/** Today where the chef stands; the work_date column is a plain date. */
function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function TeamList({ reloadKey = 0 }: { reloadKey?: number }) {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();

  const [rows, setRows] = useState<Row[] | null>(null);
  // Every active chantier, so one created a minute ago can be filtered on
  // before anybody has declared a day there.
  const [allSites, setAllSites] = useState<{ id: string; name: string }[]>([]);
  const [site, setSite] = useState<string>('all');
  const [status, setStatus] = useState<Status>('all');
  const [infoOpen, setInfoOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      (async () => {
        const today = todayISO();
        const [{ data: people }, { data: sites }, { data: days }] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, first_name, last_name, is_active')
            .eq('role', 'employee')
            .is('deleted_at', null)
            .order('first_name'),
          supabase.from('sites').select('id, name').eq('is_active', true).order('name'),
          supabase
            .from('work_days')
            .select('id, employee_id, site_id, started_at, ended_at, planned_end_at')
            .eq('work_date', today),
        ]);

        const dayIds = (days ?? []).map((day) => day.id);
        const { data: declarations } = dayIds.length
          ? await supabase.from('task_declarations').select('work_day_id').in('work_day_id', dayIds)
          : { data: [] as { work_day_id: string }[] };

        if (!active) return;

        setAllSites(sites ?? []);
        const siteName = new Map((sites ?? []).map((s) => [s.id, s.name]));
        const dayOf = new Map((days ?? []).map((day) => [day.employee_id, day]));
        const declaredPerDay = new Map<string, number>();
        for (const row of declarations ?? []) {
          declaredPerDay.set(row.work_day_id, (declaredPerDay.get(row.work_day_id) ?? 0) + 1);
        }

        setRows(
          (people ?? []).map((person) => {
            const day = dayOf.get(person.id);
            const end = day ? new Date(day.ended_at ?? day.planned_end_at) : null;
            const start = day ? new Date(day.started_at) : null;
            const hours =
              start && end ? Math.round(((Math.min(end.getTime(), Date.now()) - start.getTime()) / 3600_000) * 10) / 10 : null;
            return {
              id: person.id,
              name: `${person.first_name} ${person.last_name}`.trim(),
              isActive: person.is_active,
              siteId: day?.site_id ?? null,
              siteName: day ? siteName.get(day.site_id) ?? null : null,
              hours: hours !== null && hours > 0 ? hours : day ? 0 : null,
              open: !!day && !day.ended_at,
              declarations: day ? declaredPerDay.get(day.id) ?? 0 : 0,
            };
          })
        );
      })();

      return () => { active = false; };
      // reloadKey is the dependency: bumping it is how a pull-to-refresh
      // re-runs this fetch. The linter cannot see that it is used as a signal.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reloadKey])
  );

  // Memoised so the site options below do not recompute on every render.
  const list = useMemo(() => rows ?? [], [rows]);

  // Chantiers with somebody on them today come first — that is the common
  // filter — then the rest, so a new one is reachable straight away.
  const siteOptions = useMemo(() => {
    const busy = new Set(list.map((row) => row.siteId).filter(Boolean) as string[]);
    return [...allSites].sort((a, b) => {
      const gap = Number(busy.has(b.id)) - Number(busy.has(a.id));
      return gap !== 0 ? gap : a.name.localeCompare(b.name);
    });
  }, [allSites, list]);

  const filtered = list.filter((row) => {
    if (site === 'none' ? row.siteId !== null : site !== 'all' && row.siteId !== site) return false;
    if (status === 'present') return row.open;
    if (status === 'absent') return row.siteId === null;
    if (status === 'silent') return row.siteId !== null && row.declarations === 0;
    return true;
  });

  const statuses: { key: Status; label: string }[] = [
    { key: 'all', label: t.team.statusAll },
    { key: 'present', label: t.team.statusPresent },
    { key: 'silent', label: t.team.statusSilent },
    { key: 'absent', label: t.team.statusAbsent },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <ThemedText style={styles.title}>{t.team.title}</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.team.title}
          hitSlop={10}
          onPress={() => setInfoOpen(true)}
          style={({ pressed }) => pressed && styles.pressed}>
          <Ionicons name="information-circle-outline" size={22} color={theme.textSecondary} />
        </Pressable>
      </View>

      {/* Chantier first: it is how a chef thinks about his crews. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label={t.team.allSites} selected={site === 'all'} onPress={() => setSite('all')} />
        {siteOptions.map((option) => (
          <Chip
            key={option.id}
            label={option.name}
            selected={site === option.id}
            onPress={() => setSite(option.id)}
          />
        ))}
        <Chip label={t.team.noSite} selected={site === 'none'} onPress={() => setSite('none')} />
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {statuses.map((option) => (
          <Chip
            key={option.key}
            label={option.label}
            selected={status === option.key}
            onPress={() => setStatus(option.key)}
          />
        ))}
      </ScrollView>

      <View
        style={[
          styles.card,
          cardShadow(theme.isDark),
          { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
        ]}>
        {!filtered.length && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {rows ? t.team.empty : t.team.loading}
          </ThemedText>
        )}

        {filtered.map((row, index) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            onPress={() => router.push(`/employee/${row.id}`)}
            style={({ pressed }) => [
              styles.row,
              // A hairline between neighbours, never above the first one.
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}>
            <View
              style={[
                styles.dot,
                { backgroundColor: row.open ? theme.success : row.siteId ? theme.textPlaceholder : theme.backgroundSelected },
              ]}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText numberOfLines={1} style={!row.isActive && { color: theme.textPlaceholder }}>
                {row.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {row.siteName
                  ? `${row.siteName} · ${t.team.declarations(row.declarations)}`
                  : t.team.noDayToday}
              </ThemedText>
            </View>
            {row.hours !== null && (
              <ThemedText type="small" themeColor="textSecondary">{row.hours} h</ThemedText>
            )}
            <Ionicons name="chevron-forward" size={16} color={theme.textPlaceholder} />
          </Pressable>
        ))}
      </View>

      <AppModal
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={t.team.title}
        icon="people-outline"
        actions={<ModalButton label={t.common.done} onPress={() => setInfoOpen(false)} />}>
        <ThemedText type="small" themeColor="textSecondary">{t.team.subtitle}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t.team.infoFilters}</ThemedText>
      </AppModal>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          // Same as the tab pills above: the picked one is the raised white
          // surface, the rest are outlined against the page.
          backgroundColor: selected ? theme.backgroundElement : theme.background,
          borderColor: selected ? 'transparent' : theme.text,
        },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="small" themeColor={selected ? 'text' : 'textSecondary'}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  wrap: {
    gap: Spacing.three,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  chips: {
    gap: Spacing.two,
    paddingRight: Spacing.four,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  card: {
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  empty: {
    paddingVertical: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});
