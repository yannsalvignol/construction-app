import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppModal, ModalButton } from '@/components/app-modal';
import { ThemedText } from '@/components/themed-text';
import { cardShadow, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import type { Site } from '@/lib/presence';
import { supabase } from '@/lib/supabase';

/**
 * Progress of the company's chantiers.
 *
 * A chantier shows a percentage only once its devis has been imported and
 * validated: that is the only denominator there is (docs/DEVIS_AVANCEMENT.md).
 * The others are listed without one, saying what they are waiting for. An
 * invented figure would be worse than a blank, because a chef cannot tell it
 * from a measured one and would act on it.
 */

/** One progress bar. `thick` is the headline bar on a card. */
function Bar({ percent, tone, thick = false }: { percent: number; tone: string; thick?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { height: thick ? 8 : 5, backgroundColor: theme.backgroundSelected }]}>
      <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: tone }]} />
    </View>
  );
}

export type QuoteProgress = {
  site_id: string;
  quote_id: string;
  lines: number;
  measurable: number;
  quoted_amount: number;
  done_amount: number;
  percent: number;
};

export function SiteProgressList({ reloadKey = 0 }: { reloadKey?: number }) {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const [sites, setSites] = useState<Site[] | null>(null);
  // Real progress, for the chantiers whose devis has been checked and
  // validated. Anything else falls back to the sample figures.
  const [quotes, setQuotes] = useState<Map<string, QuoteProgress>>(new Map());
  const [infoOpen, setInfoOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [{ data: rows }, { data: progress }] = await Promise.all([
          supabase
            .from('sites')
            .select('id,name,address,is_active,latitude,longitude')
            .eq('is_active', true)
            .order('name'),
          supabase.rpc('site_quote_progress'),
        ]);
        if (!active) return;
        setSites(rows ?? []);
        setQuotes(new Map(((progress as QuoteProgress[]) ?? []).map((row) => [row.site_id, row])));
      })();
      return () => { active = false; };
      // reloadKey is the dependency: bumping it is how a pull-to-refresh
      // re-runs this fetch. The linter cannot see that it is used as a signal.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reloadKey])
  );

  // Only a validated devis gives a chantier a percentage. Everything else is
  // listed without one: an invented figure is worse than an honest blank,
  // because a chef cannot tell the difference and will act on it.
  const rows = (sites ?? []).map((site) => ({ site, quote: quotes.get(site.id) }));
  const measured = rows.filter((row) => row.quote);
  const average = measured.length
    ? Math.round(measured.reduce((sum, row) => sum + (row.quote?.percent ?? 0), 0) / measured.length)
    : 0;

  return (
    <View style={styles.list}>
      {/* The company in one line: how far along everything is, and how many
          chantiers have gone quiet — the two questions asked every morning. */}
      <View style={[styles.summary, { backgroundColor: theme.backgroundElement }, cardShadow(theme.isDark)]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.progress.title}
          hitSlop={10}
          onPress={() => setInfoOpen(true)}
          style={({ pressed }) => [styles.info, pressed && styles.pressed]}>
          <Ionicons name="information-circle-outline" size={22} color={theme.textSecondary} />
        </Pressable>
        <ThemedText style={styles.summaryValue}>{average}%</ThemedText>
        <ThemedText type="smallBold">{t.progress.averageLabel(measured.length)}</ThemedText>
        <View style={styles.summaryBar}>
          <View style={[styles.track, { backgroundColor: theme.backgroundSelected, height: 8 }]}>
            <View style={[styles.fill, { width: `${average}%`, backgroundColor: theme.text }]} />
          </View>
        </View>
      </View>

      {sites && !sites.length && (
        <View
          style={[
            styles.card,
            cardShadow(theme.isDark),
            { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
          ]}>
          <ThemedText type="small" themeColor="textSecondary">{t.progress.empty}</ThemedText>
        </View>
      )}

      {rows.map(({ site, quote }) => (
        <Pressable
          key={site.id}
          accessibilityRole="button"
          onPress={() => router.push(`/site/${site.id}`)}
          style={({ pressed }) => [
            styles.card,
            cardShadow(theme.isDark),
            { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
            pressed && styles.pressed,
          ]}>
          <View style={styles.headRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText style={styles.name}>{site.name}</ThemedText>
              {!!site.address && (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {site.address}
                </ThemedText>
              )}
            </View>
            <View style={styles.headRight}>
              {!!quote && (
                <ThemedText style={[styles.percent, { color: theme.accentText }]}>
                  {quote.percent}%
                </ThemedText>
              )}
              <Ionicons name="chevron-forward" size={18} color={theme.textPlaceholder} />
            </View>
          </View>

          <Bar
            percent={quote ? quote.percent : 0}
            tone={quote ? theme.accent : theme.backgroundSelected}
            thick
          />

          <View style={styles.metaRow}>
            <Ionicons name="document-attach-outline" size={15} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
              {quote ? t.progress.quoteLines(quote.lines) : t.progress.noQuote}
            </ThemedText>
          </View>
        </Pressable>
      ))}

      {/* Adding a chantier belongs where the chantiers are listed; this is the
          shortcut from the dashboard. */}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.navigate('/sites')}
        style={({ pressed }) => [styles.addButton, { borderColor: theme.accent }, pressed && styles.pressed]}>
        <Ionicons name="add" size={20} color={theme.accentText} />
        <ThemedText type="smallBold" themeColor="accentText">{t.progress.addSite}</ThemedText>
      </Pressable>

      <AppModal
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={t.progress.title}
        icon="trending-up-outline"
        actions={<ModalButton label={t.common.done} onPress={() => setInfoOpen(false)} />}>
        <ThemedText type="small" themeColor="textSecondary">{t.progress.subtitle}</ThemedText>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.three,
  },
  summary: {
    padding: Spacing.four + Spacing.one,
    borderRadius: 26,
    gap: Spacing.one,
  },
  info: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
  },
  summaryValue: {
    fontSize: 56,
    lineHeight: 62,
    fontWeight: '700',
  },
  summaryBar: {
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  headRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  name: {
    fontSize: 19,
    fontWeight: '700',
  },
  percent: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '700',
  },
  track: {
    borderRadius: 999,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },
  lots: {
    gap: Spacing.two,
  },
  lotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  lotLabel: {
    width: 92,
  },
  lotValue: {
    width: 38,
    textAlign: 'right',
  },
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 56,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  pressed: {
    opacity: 0.7,
  },
});
