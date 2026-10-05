import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { cardShadow, MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

/**
 * One person's activity: where they worked, for how long, what they declared
 * and whether the presence checks answered.
 *
 * Every figure here comes from employee_activity, which reads the records and
 * nothing else. It used to invent them — a timeline hashed from the employee's
 * id, with hardcoded task labels under a real person's name — which looked
 * exactly like a record without being one. A day with nothing in it now says so
 * rather than filling itself in.
 *
 * This is the activity view. The account itself (identifiants, réglages,
 * suppression) stays on the Employés tab.
 */

type Person = { id: string; first_name: string; last_name: string; username: string | null; phone: string | null };

type Task = { label_fr: string | null; label_en: string | null; unit: string | null; quantity: number };
/** `on_site` is null when it cannot be answered: position redacted, or a site without coordinates. */
type Check = { captured_at: string; on_site: boolean | null };
/** A photo the chef required before the day could start. */
type Proof = { kind: 'equipment' | 'clock_in'; path: string; captured_at: string };
/** Work in neither the devis nor the catalogue, written by the man who did it. */
type Note = { id: string; description: string; declared_at: string };
type Day = {
  work_date: string;
  site_name: string | null;
  hours: number;
  open: boolean;
  tasks: Task[];
  notes?: Note[];
  photos?: Proof[];
  checks: Check[];
};
type Activity = {
  person: Person;
  hours_total: number;
  site_count: number;
  day_count: number;
  days: Day[];
};

/** The window the three figures at the top are counted over. */
const WINDOW_DAYS = 30;

export default function EmployeeActivityScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, locale } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [failed, setFailed] = useState(false);

  /** The bucket is private, so the photo is reached by a link that expires. */
  async function openProof(path: string) {
    const { data } = await supabase.storage.from('day-proofs').createSignedUrl(path, 60);
    if (data?.signedUrl) await WebBrowser.openBrowserAsync(data.signedUrl);
  }

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      void supabase
        .rpc('employee_activity', { employee: id, window_days: WINDOW_DAYS })
        .then(({ data, error }) => {
          if (!active) return;
          if (error) { setFailed(true); return; }
          setActivity(data as Activity);
          setFailed(false);
        });
      return () => { active = false; };
    }, [id])
  );

  const person = activity?.person ?? null;
  const days = activity?.days ?? [];
  const name = person ? `${person.first_name} ${person.last_name}`.trim() : '';

  const dayLabel = (workDate: string) => {
    const today = new Date();
    const date = new Date(workDate + 'T00:00:00');
    const offset = Math.round((today.setHours(0, 0, 0, 0) - date.getTime()) / 86_400_000);
    if (offset === 0) return t.employeeActivity.today;
    if (offset === 1) return t.employeeActivity.yesterday;
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(date);
  };

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' });

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
              { value: `${activity?.hours_total ?? 0} h`, label: t.employeeActivity.hoursMonth },
              { value: `${activity?.day_count ?? 0}`, label: t.employeeActivity.daysMonth },
              { value: `${activity?.site_count ?? 0}`, label: t.employeeActivity.sitesMonth },
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

          {/* The most recent day's site, and the time of the last check that
              answered on it. No "last seen" when nothing was seen. */}
          {days.length > 0 && (
            <Section title={t.employeeActivity.location}>
              <View style={styles.row}>
                <Ionicons name="location-outline" size={18} color={theme.accentText} />
                <View style={{ flex: 1 }}>
                  <ThemedText numberOfLines={1}>{days[0].site_name ?? '—'}</ThemedText>
                  {days[0].checks.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {t.employeeActivity.lastSeen(time(days[0].checks[days[0].checks.length - 1].captured_at))}
                    </ThemedText>
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.navigate('/live')}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText type="small" themeColor="accentText">{t.siteDetail.viewOnMap}</ThemedText>
                </Pressable>
              </View>
            </Section>
          )}

          {/* The day-by-day record: journée déclarée, ce qui a été déclaré,
              et la vérification de présence qui y répond. */}
          <Section title={t.employeeActivity.history}>
            {failed && <ThemedText type="small" themeColor="textSecondary">{t.employeeActivity.failed}</ThemedText>}
            {!failed && activity && days.length === 0 && (
              <ThemedText type="small" themeColor="textSecondary">{t.employeeActivity.empty}</ThemedText>
            )}
            {days.map((day) => (
              <View key={day.work_date} style={styles.day}>
                <View style={styles.dayHead}>
                  <ThemedText type="smallBold" style={{ flex: 1 }}>{dayLabel(day.work_date)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{day.hours} h</ThemedText>
                </View>

                <View style={styles.entry}>
                  <View style={[styles.rail, { backgroundColor: theme.backgroundSelected }]} />
                  <Ionicons name="time-outline" size={16} color={theme.textSecondary} />
                  <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>
                    {t.employeeActivity.dayOn(day.site_name ?? '—')}
                  </ThemedText>
                </View>

                {/* What he was asked to show before the day could start. The
                    chef set the requirement; this is the only place the
                    answer reaches him. */}
                {(day.photos ?? []).map((photo, index) => (
                  <Pressable
                    key={`p${index}`}
                    accessibilityRole="button"
                    onPress={() => { void openProof(photo.path); }}
                    style={({ pressed }) => [styles.entry, pressed && { opacity: 0.6 }]}>
                    <View style={[styles.rail, { backgroundColor: theme.backgroundSelected }]} />
                    <Ionicons name="camera-outline" size={16} color={theme.textSecondary} />
                    <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>
                      {photo.kind === 'equipment'
                        ? t.employeeActivity.equipmentProof
                        : t.employeeActivity.clockInProof}
                    </ThemedText>
                    <ThemedText type="small" themeColor="accentText">
                      {t.employeeActivity.seeProof}
                    </ThemedText>
                  </Pressable>
                ))}

                {day.tasks.map((task, index) => (
                  <View key={`t${index}`} style={styles.entry}>
                    <View style={[styles.rail, { backgroundColor: theme.backgroundSelected }]} />
                    <Ionicons name="construct-outline" size={16} color={theme.textSecondary} />
                    <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>
                      {(locale === 'en' ? task.label_en : task.label_fr) ?? '—'}
                    </ThemedText>
                    <ThemedText type="smallBold" themeColor="accentText">
                      {task.quantity} {task.unit ?? ''}
                    </ThemedText>
                  </View>
                ))}

                {/* In his own words, so it reads as a sentence and not as a
                    row with a missing quantity. Wrapped, not truncated: the
                    whole point is the part the codes could not carry. */}
                {(day.notes ?? []).map((note) => (
                  <View key={note.id} style={styles.entry}>
                    <View style={[styles.rail, { backgroundColor: theme.backgroundSelected }]} />
                    <Ionicons name="create-outline" size={16} color={theme.textSecondary} />
                    <ThemedText type="small" style={{ flex: 1 }}>{note.description}</ThemedText>
                  </View>
                ))}

                {day.checks.map((check, index) => (
                  <View key={`c${index}`} style={styles.entry}>
                    <View style={[styles.rail, { backgroundColor: theme.backgroundSelected }]} />
                    <Ionicons
                      name={check.on_site === false ? 'alert-circle-outline' : 'camera-outline'}
                      size={16}
                      color={check.on_site === false ? theme.warning : theme.textSecondary}
                    />
                    <ThemedText
                      type="small"
                      style={{ flex: 1, color: check.on_site === false ? theme.warning : theme.textSecondary }}
                      numberOfLines={1}>
                      {/* A check whose position cannot be judged is reported as a
                          check, not as a man off site. */}
                      {check.on_site === false
                        ? t.employeeActivity.checkOff(time(check.captured_at))
                        : t.employeeActivity.checkOk(time(check.captured_at))}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ))}
          </Section>
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
