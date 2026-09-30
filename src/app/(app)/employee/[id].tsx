import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { cardShadow, MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

/**
 * One person's activity: where they worked, for how long, what they declared
 * and where they were seen.
 *
 * The person is real; the timeline is placeholder, derived from their id so it
 * stays put between visits. The real version reads work_days,
 * task_declarations, presence_check_ins and live_positions — all of which
 * already exist — through an RPC that does not yet exist, since only the
 * employee themself can read those today.
 *
 * This is the activity view. The account itself (identifiants, réglages,
 * suppression) stays on the Employés tab.
 */

type Person = { id: string; first_name: string; last_name: string; username: string | null; phone: string | null };

// --- placeholder ------------------------------------------------------------
type Entry =
  | { kind: 'day'; site: string; hours: number }
  | { kind: 'task'; label: string; amount: string }
  | { kind: 'check'; site: string; onSite: boolean; time: string };

const TASKS: [string, string][] = [
  ['Pose réseau PPR DN25', '16 m'],
  ['Pose évacuation PVC DN100', '12 m'],
  ['Pose gaine spirale DN125', '8 m'],
  ['Calorifugeage de gaine', '18 m'],
  ['Pose WC', '2 u'],
  ['Pose receveur de douche', '3 u'],
  ['Pose climatiseur mural', '1 u'],
];

function hash(value: string) {
  let out = 0;
  for (let i = 0; i < value.length; i++) out = (out * 31 + value.charCodeAt(i)) % 100000;
  return out;
}

/** A week of days, newest first, each with its declarations and checks. */
function timelineFor(id: string, siteNames: string[]) {
  const h = hash(id);
  const sites = siteNames.length ? siteNames : ['Chantier'];
  return Array.from({ length: 5 }, (_, dayIndex) => {
    const seed = h + dayIndex * 37;
    const site = sites[seed % sites.length];
    const hours = 6 + (seed % 3);
    const entries: Entry[] = [
      { kind: 'day', site, hours },
      { kind: 'task', label: TASKS[seed % TASKS.length][0], amount: TASKS[seed % TASKS.length][1] },
    ];
    if (seed % 3 !== 0) {
      const second = TASKS[(seed + 3) % TASKS.length];
      entries.push({ kind: 'task', label: second[0], amount: second[1] });
    }
    entries.push({
      kind: 'check',
      site,
      onSite: seed % 7 !== 0,
      time: `${8 + (seed % 8)}h${(seed % 6) * 10}`.replace('h0', 'h00'),
    });
    return { dayOffset: dayIndex, hours, site, entries };
  });
}
// ----------------------------------------------------------------------------

export default function EmployeeActivityScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [person, setPerson] = useState<Person | null>(null);
  const [siteNames, setSiteNames] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      void supabase
        .from('profiles')
        .select('id,first_name,last_name,username,phone')
        .eq('id', id)
        .maybeSingle()
        .then(({ data }) => { if (active) setPerson(data); });
      void supabase
        .from('sites')
        .select('name')
        .eq('is_active', true)
        .order('name')
        .then(({ data }) => { if (active) setSiteNames((data ?? []).map((row) => row.name)); });
      return () => { active = false; };
    }, [id])
  );

  const days = timelineFor(id ?? '', siteNames);
  const hoursMonth = days.reduce((sum, day) => sum + day.hours, 0) * 4;
  const siteCount = new Set(days.map((day) => day.site)).size;
  const name = person ? `${person.first_name} ${person.last_name}`.trim() : '';

  const dayLabel = (offset: number) => {
    if (offset === 0) return t.employeeActivity.today;
    if (offset === 1) return t.employeeActivity.yesterday;
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(date);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
          hitSlop={8}
          accessibilityLabel={t.common.back}
          style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={30} color={theme.text} />
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.headerTitle} numberOfLines={1}>{name}</ThemedText>
            {!!person?.username && (
              <ThemedText type="small" themeColor="textSecondary">@{person.username}</ThemedText>
            )}
          </View>
        </Pressable>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.statRow}>
            {[
              { value: `${hoursMonth} h`, label: t.employeeActivity.hoursMonth },
              { value: `${days.length * 4}`, label: t.employeeActivity.daysMonth },
              { value: `${siteCount}`, label: t.employeeActivity.sitesMonth },
            ].map((stat) => (
              <View
                key={stat.label}
                style={[
                  styles.stat,
                  cardShadow(theme.isDark),
                  { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
                ]}>
                <ThemedText style={styles.statValue}>{stat.value}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{stat.label}</ThemedText>
              </View>
            ))}
          </View>

          {/* Where they were last seen. The real value comes from
              live_positions / presence_check_ins, both already collected. */}
          <Section title={t.employeeActivity.location}>
            <View style={styles.row}>
              <Ionicons name="location-outline" size={18} color={theme.accentText} />
              <View style={{ flex: 1 }}>
                <ThemedText numberOfLines={1}>{days[0]?.site ?? '—'}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t.employeeActivity.lastSeen('12 min')}
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.navigate('/live')}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="small" themeColor="accentText">{t.siteDetail.viewOnMap}</ThemedText>
              </Pressable>
            </View>
          </Section>

          {/* The day-by-day record: journée déclarée, ce qui a été déclaré,
              et la vérification de présence qui y répond. */}
          <Section title={t.employeeActivity.history}>
            {days.map((day) => (
              <View key={day.dayOffset} style={styles.day}>
                <View style={styles.dayHead}>
                  <ThemedText type="smallBold" style={{ flex: 1 }}>{dayLabel(day.dayOffset)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{day.hours} h</ThemedText>
                </View>

                {day.entries.map((entry, index) => (
                  <View key={index} style={styles.entry}>
                    <View style={[styles.rail, { backgroundColor: theme.backgroundSelected }]} />
                    <Ionicons
                      name={
                        entry.kind === 'day'
                          ? 'time-outline'
                          : entry.kind === 'task'
                            ? 'construct-outline'
                            : entry.onSite
                              ? 'camera-outline'
                              : 'alert-circle-outline'
                      }
                      size={16}
                      color={
                        entry.kind === 'check' && !entry.onSite ? theme.warning : theme.textSecondary
                      }
                    />
                    {entry.kind === 'day' && (
                      <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>
                        {t.employeeActivity.dayOn(entry.site)}
                      </ThemedText>
                    )}
                    {entry.kind === 'task' && (
                      <>
                        <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>{entry.label}</ThemedText>
                        <ThemedText type="smallBold" themeColor="accentText">{entry.amount}</ThemedText>
                      </>
                    )}
                    {entry.kind === 'check' && (
                      <ThemedText
                        type="small"
                        style={{ flex: 1, color: entry.onSite ? theme.textSecondary : theme.warning }}
                        numberOfLines={1}>
                        {entry.onSite
                          ? t.employeeActivity.checkOk(entry.time)
                          : t.employeeActivity.checkOff(entry.time)}
                      </ThemedText>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </Section>

          <ThemedText type="small" themeColor="textSecondary" style={styles.placeholder}>
            {t.progress.placeholder}
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" style={{ color: theme.accentText }}>{title}</ThemedText>
      <ThemedView
        style={[
          styles.card,
          cardShadow(theme.isDark),
          { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
        ]}>
        {children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  statRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  section: {
    gap: Spacing.two,
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
  day: {
    paddingVertical: Spacing.three,
  },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: Spacing.two,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one + 2,
  },
  rail: {
    width: 2,
    alignSelf: 'stretch',
    marginLeft: 3,
    marginRight: Spacing.two,
  },
  placeholder: {
    fontStyle: 'italic',
  },
  pressed: {
    opacity: 0.6,
  },
});
