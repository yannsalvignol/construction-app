import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SiteQuotes } from '@/components/site-quotes';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { cardShadow, MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import type { Site } from '@/lib/presence';
import { supabase } from '@/lib/supabase';

/**
 * Everything about one chantier, on one screen.
 *
 * Everything here is real. A chantier shows a percentage only once its devis
 * has been imported and validated; until then it says so plainly rather than
 * standing in an invented figure, which a chef cannot tell apart from a
 * measured one and would act on.
 */

type Milestone = {
  id: string;
  label: string;
  percent: number | null;
  is_retention: boolean;
  validated_at: string | null;
};

type QuoteProgress = {
  site_id: string;
  quote_id: string;
  lines: number;
  measurable: number;
  quoted_amount: number;
  done_amount: number;
  percent: number;
};

type TeamMember = {
  employee_id: string;
  employee_name: string;
  present_today: boolean;
  days: number;
  last_day: string | null;
};

export default function SiteDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [site, setSite] = useState<Site | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  // A chantier nobody has worked on yet has no progress to show: it is waiting
  // for its devis, and saying so is more use than inventing a percentage.
  // The validated devis for this chantier, if it has one: a real denominator
  // replaces the sample figures entirely.
  const [progress, setProgress] = useState<QuoteProgress | null>(null);
  // A devis that is imported but not yet validated still has to be visible
  // here: "aucun devis importé" is plainly wrong once one has been uploaded.
  const [pendingQuote, setPendingQuote] = useState<{ id: string; status: string } | null>(null);
  // Hours and active days come from the declared work days themselves, which
  // the chantier has always had; only the devis figures needed a devis.
  const [effort, setEffort] = useState<{ hours: number; days: number } | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      void supabase
        .from('sites')
        .select('id,name,address,is_active,latitude,longitude')
        .eq('id', id)
        .maybeSingle()
        .then(({ data }) => { if (active) setSite(data); });
      void supabase.rpc('site_team', { site: id }).then(({ data }) => {
        if (active) setTeam((data as TeamMember[]) ?? []);
      });
      void supabase
        .from('work_days')
        .select('work_date, started_at, ended_at, planned_end_at')
        .eq('site_id', id)
        .then(({ data }) => {
          if (!active) return;
          const days = data ?? [];
          const hours = days.reduce((total, day) => {
            const end = Date.parse(day.ended_at ?? day.planned_end_at);
            const start = Date.parse(day.started_at);
            if (!Number.isFinite(end) || !Number.isFinite(start)) return total;
            return total + Math.max(0, Math.min(end, Date.now()) - start) / 3_600_000;
          }, 0);
          setEffort({ hours: Math.round(hours), days: new Set(days.map((day) => day.work_date)).size });
        });
      void supabase
        .from('site_quotes')
        .select('id, status')
        .eq('site_id', id)
        .neq('status', 'validated')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => { if (active) setPendingQuote(data ?? null); });
      void supabase.rpc('site_quote_progress').then(({ data }) => {
        if (!active) return;
        const rows = (data as QuoteProgress[]) ?? [];
        const mine = rows.find((row) => row.site_id === id) ?? null;
        setProgress(mine);
        if (!mine) { setMilestones([]); return; }
        void supabase
          .from('quote_milestones')
          .select('id, label, percent, is_retention, validated_at')
          .eq('quote_id', mine.quote_id)
          .order('position')
          .then(({ data: schedule }) => {
            if (active) setMilestones((schedule as Milestone[]) ?? []);
          });
      });
      return () => { active = false; };
    }, [id])
  );

  const onSiteNow = team.filter((member) => member.present_today).length;

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
            <ThemedText style={styles.headerTitle} numberOfLines={1}>{site?.name ?? ''}</ThemedText>
            {!!site?.address && (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {site.address}
              </ThemedText>
            )}
          </View>
        </Pressable>

        <ScrollView contentContainerStyle={styles.content}>
          {/* Where the chantier stands, and when it is due — the two numbers a
              chef checks before anything else. */}
          <Pressable
            disabled={!pendingQuote}
            onPress={() => pendingQuote && router.push(`/quote/${pendingQuote.id}`)}
            style={({ pressed }) => [
              styles.hero,
              { backgroundColor: theme.accent },
              pressed && pendingQuote && styles.pressed,
            ]}>
            <ThemedText style={[styles.heroValue, { color: theme.buttonText }]}>
              {progress ? `${progress.percent}%` : pendingQuote ? '0%' : '—'}
            </ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
              {t.siteDetail.doneOfQuote}
            </ThemedText>
            <View style={styles.heroBar}>
              <View style={[styles.track, { backgroundColor: 'rgba(255,255,255,0.28)' }]}>
                <View
                  style={[
                    styles.fill,
                    {
                      width: `${progress?.percent ?? 0}%`,
                      backgroundColor: theme.buttonText,
                    },
                  ]}
                />
              </View>
            </View>
            <ThemedText type="small" style={{ color: theme.buttonText, opacity: 0.9 }}>
              {progress
                ? t.progress.quoteLines(progress.lines)
                : pendingQuote
                  ? t.quoteStatus[pendingQuote.status as keyof typeof t.quoteStatus]
                  : t.progress.noQuote}
            </ThemedText>
          </Pressable>

          <View style={styles.statRow}>
            {[
              { value: effort ? `${effort.hours} h` : '—', label: t.siteDetail.hoursTotal },
              { value: effort ? `${effort.days}` : '—', label: t.siteDetail.daysActive },
              { value: `${onSiteNow}`, label: t.siteDetail.onSiteNow },
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

          {/* Real roster. Each line opens that person's activity. */}
          <Section title={t.siteDetail.teamToday(onSiteNow)}>
            {!team.length && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyRow}>
                {t.siteDetail.noTeam}
              </ThemedText>
            )}
            {team.map((member) => (
              <Pressable
                key={member.employee_id}
                accessibilityRole="button"
                onPress={() => router.push(`/employee/${member.employee_id}`)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: member.present_today ? theme.success : theme.backgroundSelected },
                  ]}
                />
                <ThemedText style={{ flex: 1 }} numberOfLines={1}>{member.employee_name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {member.present_today ? t.siteDetail.onSite : t.siteDetail.daysOnSite(member.days)}
                </ThemedText>
                <Ionicons name="chevron-forward" size={16} color={theme.textPlaceholder} />
              </Pressable>
            ))}
          </Section>

          {/* The devis itself: photographed or picked, kept with the chantier.
              Reading lots and quantities out of it comes later; until then the
              jalons below only appear once there is declared work. */}
          <Section title={t.siteDetail.quote}>
            <SiteQuotes siteId={id ?? ''} />
          </Section>

          {/* The devis's own payment schedule. Validating a jalon is the
              chef's act, on the review screen: money does not move because a
              quantity was declared. */}
          {milestones.length > 0 && (
            <Section title={t.siteDetail.milestones}>
              {milestones.map((milestone) => (
                <View key={milestone.id} style={styles.row}>
                  <Ionicons
                    name={milestone.validated_at ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={milestone.validated_at ? theme.success : theme.textPlaceholder}
                  />
                  <ThemedText style={{ flex: 1 }} numberOfLines={1}>{milestone.label}</ThemedText>
                  {milestone.percent != null && (
                    <ThemedText type="small" themeColor="textSecondary">{milestone.percent}%</ThemedText>
                  )}
                </View>
              ))}
            </Section>
          )}

          <View style={styles.actions}>
            {[
              { icon: 'map-outline' as const, label: t.siteDetail.viewOnMap, go: () => router.push('/live') },
            ].map((action) => (
              <Pressable
                key={action.label}
                accessibilityRole="button"
                onPress={action.go}
                style={({ pressed }) => [
                  styles.action,
                  cardShadow(theme.isDark),
                  { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement },
                  pressed && styles.pressed,
                ]}>
                <Ionicons name={action.icon} size={20} color={theme.accentText} />
                <ThemedText type="small" style={styles.actionLabel}>{action.label}</ThemedText>
              </Pressable>
            ))}
          </View>

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
  hero: {
    padding: Spacing.four + Spacing.one,
    borderRadius: 26,
    gap: Spacing.one,
  },
  heroValue: {
    fontSize: 56,
    lineHeight: 62,
    fontWeight: '700',
  },
  heroBar: {
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  track: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  alerts: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
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
  emptyRow: {
    paddingVertical: Spacing.three,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  lotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  lotLabel: { width: 92 },
  lotTrack: { flex: 1, height: 6 },
  lotValue: { width: 38, textAlign: 'right' },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  actionLabel: {
    textAlign: 'center',
  },
  placeholder: {
    fontStyle: 'italic',
  },
  pressed: {
    opacity: 0.6,
  },
});
