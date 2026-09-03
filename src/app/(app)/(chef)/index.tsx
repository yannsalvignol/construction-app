import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import type { Translations } from '@/lib/i18n/en';

type Period = 'today' | 'week' | 'month' | 'year';

function periods(t: Translations): { key: Period; label: string }[] {
  return [
    { key: 'today', label: t.chefHome.periods.today },
    { key: 'week', label: t.chefHome.periods.week },
    { key: 'month', label: t.chefHome.periods.month },
    { key: 'year', label: t.chefHome.periods.year },
  ];
}

function stats(t: Translations) {
  return [
    { label: t.chefHome.stats.employees, value: '0' },
    { label: t.chefHome.stats.onSiteNow, value: '0' },
    { label: t.chefHome.stats.late, value: '0' },
    { label: t.chefHome.stats.absent, value: '0' },
    { label: t.chefHome.stats.hoursLogged, value: '0' },
    { label: t.chefHome.stats.openIssues, value: '0' },
  ];
}

function StatTile({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <ThemedView
      style={[styles.statTile, styles.transparent, { borderColor: theme.backgroundSelected }]}>
      <ThemedText type="title" style={styles.statValue}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </ThemedView>
  );
}

function EmptySection({ title, empty }: { title: string; empty: string }) {
  return (
    <ThemedView style={[styles.section, styles.transparent]}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {empty}
      </ThemedText>
    </ThemedView>
  );
}

export default function ChefHomeScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const [period, setPeriod] = useState<Period>('today');
  const [showSiteNote, setShowSiteNote] = useState(false);

  const periodPhrase = t.chefHome.periodPhrase[period];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ThemedView style={styles.filtersRow}>
            {periods(t).map((option) => {
              const selected = option.key === period;
              return (
                <Pressable
                  key={option.key}
                  style={({ pressed }) => pressed && styles.pressed}
                  onPress={() => setPeriod(option.key)}>
                  <ThemedView
                    style={[
                      styles.periodPill,
                      {
                        backgroundColor: 'transparent',
                        borderColor: selected ? theme.text : theme.backgroundSelected,
                      },
                    ]}>
                    <ThemedText
                      type="small"
                      themeColor={selected ? 'text' : 'textSecondary'}>
                      {option.label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ThemedView>

          <Pressable
            style={({ pressed }) => [styles.siteFilterRow, pressed && styles.pressed]}
            onPress={() => setShowSiteNote((value) => !value)}>
            <ThemedText type="small" themeColor="textSecondary">
              {t.chefHome.site}
            </ThemedText>
            <ThemedView style={[styles.siteFilterValue, styles.transparent]}>
              <ThemedText type="smallBold">{t.chefHome.allSites}</ThemedText>
              <SymbolView
                name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
                size={13}
                weight="semibold"
                tintColor={theme.textSecondary}
              />
            </ThemedView>
          </Pressable>
          {showSiteNote && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.siteNote}>
              {t.chefHome.siteFilterNote}
            </ThemedText>
          )}

          <ThemedView style={[styles.statsGrid, styles.transparent]}>
            {stats(t).map((stat) => (
              <StatTile key={stat.label} label={stat.label} value={stat.value} />
            ))}
          </ThemedView>

          <EmptySection title={t.chefHome.onSiteNow.title} empty={t.chefHome.onSiteNow.empty} />
          <EmptySection
            title={t.chefHome.attendance.title}
            empty={t.chefHome.attendance.empty(periodPhrase)}
          />
          <EmptySection
            title={t.chefHome.hoursWorked.title}
            empty={t.chefHome.hoursWorked.empty(periodPhrase)}
          />
          <EmptySection
            title={t.chefHome.recentActivity.title}
            empty={t.chefHome.recentActivity.empty(periodPhrase)}
          />
          <EmptySection title={t.chefHome.reportedIssues.title} empty={t.chefHome.reportedIssues.empty} />
          <EmptySection title={t.chefHome.sites.title} empty={t.chefHome.sites.empty} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.five,
  },
  title: {
    textAlign: 'center',
  },
  filtersRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    backgroundColor: 'transparent',
  },
  periodPill: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pressed: {
    opacity: 0.6,
  },
  siteFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one,
    marginTop: -Spacing.two,
  },
  siteFilterValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  siteNote: {
    marginTop: -Spacing.three,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  statTile: {
    flexBasis: '45%',
    flexGrow: 1,
    borderRadius: Spacing.three,
    borderWidth: 1,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    gap: Spacing.one,
  },
  statValue: {
    fontSize: 32,
    lineHeight: 36,
  },
  section: {
    gap: Spacing.one,
  },
  transparent: {
    backgroundColor: 'transparent',
  },
});
