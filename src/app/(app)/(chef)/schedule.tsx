import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import type { Translations } from '@/lib/i18n/en';

type Scope = 'me' | 'team';

function scopes(t: Translations): { key: Scope; label: string }[] {
  return [
    { key: 'me', label: t.schedule.scopes.me },
    { key: 'team', label: t.schedule.scopes.team },
  ];
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getCurrentWeekDates(): Date[] {
  const today = startOfToday();
  const mondayOffset = today.getDay() === 0 ? -6 : 1 - today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return date;
  });
}

function formatSelectedDay(t: Translations, date: Date) {
  if (isSameDay(date, startOfToday())) return t.schedule.today;
  const weekdayIndex = (date.getDay() + 6) % 7;
  return t.schedule.formatDate(
    t.schedule.weekdaysFull[weekdayIndex],
    date.getDate(),
    t.schedule.months[date.getMonth()]
  );
}

export default function ScheduleScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const [scope, setScope] = useState<Scope>('me');
  const [selectedDate, setSelectedDate] = useState(startOfToday);

  const weekDates = useMemo(() => getCurrentWeekDates(), []);
  const today = startOfToday();
  const isSelectedToday = isSameDay(selectedDate, today);
  const selectedDayLabel = formatSelectedDay(t, selectedDate);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ThemedText type="title" style={styles.title}>
            {t.schedule.title}
          </ThemedText>

          <ThemedView style={[styles.filtersRow, styles.transparent]}>
            {scopes(t).map((option) => {
              const selected = option.key === scope;
              return (
                <Pressable
                  key={option.key}
                  style={({ pressed }) => pressed && styles.pressed}
                  onPress={() => setScope(option.key)}>
                  <ThemedView
                    style={[
                      styles.pill,
                      styles.transparent,
                      { borderColor: selected ? theme.accent : theme.backgroundSelected },
                    ]}>
                    <ThemedText type="small" themeColor={selected ? 'accentText' : 'textSecondary'}>
                      {option.label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ThemedView>

          <ThemedView style={[styles.weekStrip, styles.transparent]}>
            {weekDates.map((date, index) => {
              const selected = isSameDay(date, selectedDate);
              const isToday = isSameDay(date, today);
              return (
                <Pressable
                  key={date.toISOString()}
                  style={styles.weekDayTouchable}
                  onPress={() => setSelectedDate(date)}>
                  <ThemedView
                    style={[
                      styles.weekDay,
                      {
                        backgroundColor: selected ? theme.accent : 'transparent',
                        borderColor: isToday && !selected ? theme.accent : theme.backgroundSelected,
                      },
                    ]}>
                    <ThemedText type="small" themeColor={selected ? 'buttonText' : 'textSecondary'}>
                      {t.schedule.weekdayLetters[index]}
                    </ThemedText>
                    <ThemedText type="smallBold" themeColor={selected ? 'buttonText' : 'text'}>
                      {date.getDate()}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ThemedView>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 },
            ]}>
            <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
              {scope === 'me' ? t.schedule.addShift : t.schedule.assignShift}
            </ThemedText>
          </Pressable>

          {scope === 'team' && (
            <Pressable style={({ pressed }) => [styles.employeeFilterRow, pressed && styles.pressed]}>
              <ThemedText type="small" themeColor="textSecondary">
                {t.schedule.employee}
              </ThemedText>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t.schedule.allEmployees}
              </ThemedText>
            </Pressable>
          )}

          <ThemedView style={[styles.emptyState, styles.transparent]}>
            <SymbolView
              name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }}
              size={28}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="smallBold" style={styles.centerText}>
              {isSelectedToday ? t.schedule.noShiftsToday : t.schedule.noShiftsOnDay(selectedDayLabel)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {scope === 'me' ? t.schedule.emptyMe : t.schedule.emptyTeam}
            </ThemedText>
          </ThemedView>
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
    gap: Spacing.four,
  },
  title: {
    textAlign: 'center',
  },
  centerText: {
    textAlign: 'center',
  },
  filtersRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  pill: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.6,
  },
  weekStrip: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  weekDayTouchable: {
    flex: 1,
  },
  weekDay: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    gap: Spacing.half,
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  employeeFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -Spacing.two,
  },
  emptyState: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  transparent: {
    backgroundColor: 'transparent',
  },
});
