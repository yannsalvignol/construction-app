import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Card } from './work-ui';
import { ThemedText } from './themed-text';
import { OnSiteBadge } from './on-site-badge';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { positionAge, workCopy } from '@/lib/work-copy';
import type { Site } from '@/lib/presence';

type Member = {
  employee_id: string; employee_name: string; is_active: boolean;
  location_mode: 'checkpoint' | 'live'; last_day: string; days: number; present_today: boolean;
  /** Null when nobody is sharing, or the site has no coordinates. */
  on_site: boolean | null;
  /** Most recent evidence of where they were on this site: a live position or a check-in. */
  last_seen_at: string | null;
};

/**
 * A site that expands in place to reveal its team, so the roster reads as part of
 * the list rather than covering it. The roster loads on the press that opens it,
 * then stays cached for as long as the screen lives.
 */
export function SiteRow({ site, onPressSite, onLocate, locatable, onRemoved }: {
  site: Site;
  /** When given, a long press offers to take the site out of the list. */
  onRemoved?: () => void | Promise<void>;
  /** Runs alongside the expand toggle, so one press can also move a map. */
  onPressSite?: () => void;
  /** When given, a member with a shared position becomes pressable. */
  onLocate?: (employeeId: string) => void;
  locatable?: Set<string>;
}) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  // Captured when the roster loads: reading the clock during render is not pure.
  const [now, setNow] = useState(() => Date.now());
  const [team, setTeam] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);

  async function load() {
    if (loading.current) return;
    loading.current = true; setError(null);
    const { data, error: failure } = await supabase.rpc('site_team', { site: site.id });
    if (failure) setError(copy.failed);
    else { setTeam((data ?? []) as Member[]); setNow(Date.now()); }
    loading.current = false;
  }

  function confirmRemove() {
    if (!onRemoved) return;
    // Confirms the long press landed, before the dialog covers the card.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(site.name, copy.removeSiteConfirm, [
      { text: copy.cancel, style: 'cancel' },
      { text: copy.removeSite, style: 'destructive', onPress: () => { void remove(); } },
    ]);
  }

  async function remove() {
    setError(null);
    const { error: failure } = await supabase.rpc('remove_site', { site: site.id });
    if (failure) { setError(copy.failed); return; }
    await onRemoved?.();
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !team) void load();
    onPressSite?.();
  }

  return <Card>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={site.name}
      onPress={toggle} onLongPress={onRemoved ? confirmRemove : undefined}
      accessibilityHint={onRemoved ? copy.removeSiteHint : undefined}
      style={({ pressed }) => pressed && { opacity: 0.6 }}>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ThemedText style={{ flex: 1, fontSize: 20, fontWeight: '700' }}>{site.name}</ThemedText>
          <ThemedText style={{ color: theme.textSecondary, fontSize: 18 }}>{open ? '⌄' : '›'}</ThemedText>
        </View>
        {site.address && <ThemedText themeColor="textSecondary">{site.address}</ThemedText>}
        {site.latitude == null && <ThemedText type="small" themeColor="warning">{copy.siteNoCoords}</ThemedText>}
      </View>
    </Pressable>

    {open && <View style={{ gap: 14, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.backgroundSelected }}>
      <ThemedText type="smallBold">{copy.siteTeam}</ThemedText>
      {!team && !error && <ActivityIndicator color={theme.accent} />}
      {error && <ThemedText type="small" themeColor="danger">{error}</ThemedText>}
      {team && !team.length && <ThemedText type="small" themeColor="textSecondary">{copy.siteTeamEmpty}</ThemedText>}
      {team?.map(member => {
        // Only somebody currently sharing a position can be pointed at on a map.
        const canLocate = !!onLocate && !!locatable?.has(member.employee_id);
        // Two lines: who, and where they stand right now. The rest — day counts,
        // dates, hints — belongs on the employee's own page, not in a roster.
        const body = <View style={{ gap: 4, paddingLeft: 14, borderLeftWidth: 3, borderLeftColor: member.present_today ? theme.accent : theme.backgroundSelected }}>
          <ThemedText type="smallBold">{member.employee_name}</ThemedText>
          {canLocate
            ? <OnSiteBadge onSite={member.on_site} />
            : member.last_seen_at
              ? <ThemedText type="small" themeColor="textSecondary">{copy.lastSeen} : {positionAge(member.last_seen_at, copy, now)}</ThemedText>
              : <ThemedText type="small" themeColor="textSecondary">{copy.neverSeen}</ThemedText>}
          {!member.is_active && <ThemedText type="small" themeColor="warning">{copy.suspended}</ThemedText>}
        </View>;
        return canLocate
          ? <Pressable key={member.employee_id} accessibilityRole="button" accessibilityLabel={member.employee_name}
              onPress={() => onLocate(member.employee_id)} style={({ pressed }) => pressed && { opacity: 0.6 }}>{body}</Pressable>
          : <View key={member.employee_id}>{body}</View>;
      })}
    </View>}
  </Card>;
}
