import { useCallback, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Action, Card, Feedback, WorkPage } from '@/components/work-ui';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import type { Dashboard } from '@/lib/presence';
import { unitShort, workCopy } from '@/lib/work-copy';

export default function ChefHomeScreen() {
  const { locale } = useI18n();
  const { profile } = useAuth();
  const copy = workCopy(locale);
  const theme = useTheme();
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const companyId = profile?.company_id;
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const { data: result, error: failure } = await supabase.rpc('chef_dashboard');
      if (sequence !== request.current) return;
      if (failure) throw failure;
      setData(result as Dashboard); setError(null);
    } catch { if (sequence === request.current) setError(workCopy(locale).failed); }
  }, [locale]);
  useFocusEffect(useCallback(() => {
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 30_000);
    const app = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    const channel = supabase.channel('dashboard-employees-' + companyId).on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: 'company_id=eq.' + companyId }, () => { void refresh(); }).subscribe();
    return () => { clearInterval(timer); app.remove(); void supabase.removeChannel(channel); request.current++; };
  }, [companyId, refresh]));
  const label = locale === 'en' ? 'label_en' : 'label_fr';
  return <WorkPage title={copy.teamOverview}>
    <Feedback message={error} />
    {error && <Action secondary label={copy.retry} onPress={() => { void refresh(); }} />}
    {!data && !error && <ThemedText>{copy.loading}</ThemedText>}
    {data && <>
      {/* Headcount leads as a single absolute number: it is the figure a contractor
          checks first, and it counts every employee, including code-joined arrivals. */}
      <View style={{ padding: 28, gap: 6, borderRadius: 26, backgroundColor: theme.accent }}>
        <ThemedText style={{ fontSize: 64, lineHeight: 70, fontWeight: '700', color: theme.buttonText }}>{data.employees}</ThemedText>
        <ThemedText type="smallBold" style={{ color: theme.buttonText }}>{copy.headcount}</ThemedText>
        <ThemedText type="small" style={{ color: theme.buttonText, opacity: 0.85 }}>
          {data.active_employees} {copy.activeSuffix} · {data.confirmed} {copy.onSiteToday}
        </ThemedText>
      </View>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        {[{ label: copy.review, value: data.to_review }, { label: copy.hours, value: data.declared_hours + ' h' }].map(stat =>
          <View key={stat.label} style={{ flex: 1, padding: 22, gap: 8, borderRadius: 22, backgroundColor: theme.backgroundElement, borderWidth: 1, borderColor: theme.backgroundSelected }}>
            <ThemedText style={{ fontSize: 32, fontWeight: '700' }}>{stat.value}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{stat.label}</ThemedText>
          </View>)}
      </View>
      <ThemedText type="small" themeColor="textSecondary">{copy.hoursHint}</ThemedText>
      <Card>
        <ThemedText style={{ fontSize: 24, fontWeight: '700' }}>{copy.productivity}</ThemedText>
        <ThemedText themeColor="textSecondary" type="small">{copy.productivityHint}</ThemedText>
        {!data.productivity.length && <ThemedText type="small" themeColor="textSecondary">{copy.noTasks}</ThemedText>}
        {/* Ordered by volume server-side, so the biggest job of the day reads first.
            Quantities are never compared across tasks: the units differ. */}
        {data.productivity.map(task => <View key={task.code} style={{ gap: 10, paddingTop: 18, borderTopWidth: 1, borderTopColor: theme.backgroundSelected }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
            <ThemedText style={{ flex: 1 }}>{task[label]}</ThemedText>
            <ThemedText style={{ fontSize: 22, fontWeight: '700' }} themeColor="accentText">{task.quantity} {unitShort(task.unit, copy)}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">{task.employees} {copy.perTask}</ThemedText>
        </View>)}
      </Card>
      {!!data.flags.length && <Card>
        <ThemedText style={{ fontSize: 22, fontWeight: '700' }} themeColor="warning">{copy.consistency}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{copy.consistencyHint}</ThemedText>
        {data.flags.map((flag, i) => <View key={flag.employee_id + '-' + i} style={{ gap: 6 }}>
          <ThemedText type="smallBold">{flag.employee_name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{flag[label]} · {flag.quantity} {unitShort(flag.unit, copy)} · {flag.site_name}</ThemedText>
        </View>)}
      </Card>}
      <Action secondary label={copy.employees} onPress={() => router.navigate('/employees')} />
    </>}
  </WorkPage>;
}
