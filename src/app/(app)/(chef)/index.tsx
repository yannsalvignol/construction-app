import { useCallback, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppModal, ModalButton } from '@/components/app-modal';
import { cardShadow } from '@/constants/theme';
import { Action, Card, Feedback, pageStyles } from '@/components/work-ui';
import { SafetyAlerts } from '@/components/safety-alerts';
import { SiteProgressList } from '@/components/site-progress';
import { TeamList } from '@/components/team-list';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import type { Dashboard } from '@/lib/presence';
import { unitShort, workCopy } from '@/lib/work-copy';

const BOARDS = ['sites', 'team'] as const;
type Board = (typeof BOARDS)[number];

const AnimatedText = Animated.createAnimatedComponent(ThemedText);

/** Tab label whose colour follows the pager rather than the committed state. */
function TabLabel({
  label,
  index,
  scrollX,
  pageWidth,
}: {
  label: string;
  index: number;
  scrollX: SharedValue<number>;
  pageWidth: number;
}) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({
    color: interpolateColor(
      scrollX.value,
      [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth],
      [theme.textSecondary, theme.text, theme.textSecondary]
    ),
  }));
  return <AnimatedText type="smallBold" style={style}>{label}</AnimatedText>;
}

/**
 * The outline of one tab. Only the unselected tabs show it: the border fades
 * into the sliding pill's own fill as that page arrives, so an outline and the
 * pill never sit on top of each other mid-swipe.
 */
function TabOutline({
  index,
  scrollX,
  pageWidth,
  children,
}: {
  index: number;
  scrollX: SharedValue<number>;
  pageWidth: number;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      scrollX.value,
      [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth],
      [theme.text, theme.backgroundElement, theme.text]
    ),
  }));
  return <Animated.View style={[styles.tab, style]}>{children}</Animated.View>;
}

export default function ChefHomeScreen() {
  const { t, locale } = useI18n();
  const { profile } = useAuth();
  const copy = workCopy(locale);
  const theme = useTheme();
  const { width } = useWindowDimensions();
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

  // Two dashboards behind one screen: what the chantiers owe, and what the team
  // did. Both answer "where do I stand", from opposite ends, and a chef arrives
  // with one of the two questions already in mind. They sit side by side in a
  // pager so the tabs and the swipe are the same movement, and each board keeps
  // its own vertical scroll.
  const [board, setBoard] = useState<Board>('sites');
  const pager = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(0);
  const [tabsWidth, setTabsWidth] = useState(0);
  const [hoursInfoOpen, setHoursInfoOpen] = useState(false);
  // Pull to refresh: the dashboard RPC and both lists, which watch reloadKey.
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Only the title gives way when a board is scrolled: the header slides up by
  // exactly its height, which leaves the two tabs pinned under the chef's tab
  // bar — they are a control, and a control that scrolls away is a nuisance.
  const [headerHeight, setHeaderHeight] = useState(0);
  const [titleHeight, setTitleHeight] = useState(0);
  const headerOffset = useSharedValue(0);
  const titleTravel = titleHeight + HEADER_GAP;

  const headerStyle = useAnimatedStyle(() => {
    const travel = Math.max(titleTravel, 1);
    return { transform: [{ translateY: -Math.min(Math.max(headerOffset.value, 0), travel) }] };
  });

  // The title fades as it goes, so it does not smear past the tabs on its way.
  const titleStyle = useAnimatedStyle(() => {
    const travel = Math.max(titleTravel, 1);
    const shift = Math.min(Math.max(headerOffset.value, 0), travel);
    return { opacity: interpolate(shift, [0, travel * 0.7], [1, 0], 'clamp') };
  });

  async function pullToRefresh() {
    setRefreshing(true);
    setReloadKey((key) => key + 1);
    await refresh();
    setRefreshing(false);
  }

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  // The pill slides under the thumb rather than snapping when the swipe ends.
  const indicatorStyle = useAnimatedStyle(() => {
    const step = (tabsWidth - TAB_GAP) / BOARDS.length + TAB_GAP;
    return { transform: [{ translateX: (scrollX.value / Math.max(width, 1)) * step }] };
  });

  function select(next: Board) {
    setBoard(next);
    pager.current?.scrollTo({ x: next === 'team' ? width : 0, animated: true });
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Animated.View
        style={[styles.header, { backgroundColor: theme.background }, headerStyle]}
        onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
        <AnimatedText
          style={[pageStyles.heading, titleStyle]}
          onLayout={event => setTitleHeight(event.nativeEvent.layout.height)}>
          {t.home.title}
        </AnimatedText>
        <View style={styles.tabs} onLayout={event => setTabsWidth(event.nativeEvent.layout.width)}>
          {tabsWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.indicator,
                {
                  width: (tabsWidth - TAB_GAP) / BOARDS.length,
                  backgroundColor: theme.backgroundElement,
                },
                indicatorStyle,
              ]}
            />
          )}
          {BOARDS.map((key, index) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: board === key }}
              onPress={() => select(key)}
              style={({ pressed }) => [styles.tabPress, { opacity: pressed ? 0.7 : 1 }]}>
              <TabOutline index={index} scrollX={scrollX} pageWidth={width}>
                <TabLabel
                  label={key === 'sites' ? t.home.sitesTab : t.home.teamTab}
                  index={index}
                  scrollX={scrollX}
                  pageWidth={width}
                />
              </TabOutline>
            </Pressable>
          ))}
        </View>
      </Animated.View>

      <Animated.ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // The tabs follow the swipe, so the two controls never disagree.
        onMomentumScrollEnd={event =>
          setBoard(event.nativeEvent.contentOffset.x > width / 2 ? 'team' : 'sites')
        }
        style={styles.pager}>
        <Page
          index={0}
          scrollX={scrollX}
          pageWidth={width}
          headerHeight={headerHeight}
          headerOffset={headerOffset}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={pullToRefresh}
              tintColor={theme.accentText}
              // The header floats over the page, so the spinner has to clear it.
              progressViewOffset={headerHeight}
            />
          }>
          {/* What this board means, and that its figures are placeholder, live
              behind the ⓘ on the summary card rather than above it. */}
          <SafetyAlerts />
          <SiteProgressList reloadKey={reloadKey} />
        </Page>

        <Page
          index={1}
          scrollX={scrollX}
          pageWidth={width}
          headerHeight={headerHeight}
          headerOffset={headerOffset}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={pullToRefresh}
              tintColor={theme.accentText}
              // The header floats over the page, so the spinner has to clear it.
              progressViewOffset={headerHeight}
            />
          }>
          <SafetyAlerts />
          <Feedback message={error} />
          {error && <Action secondary label={copy.retry} onPress={() => { void refresh(); }} />}
          {!data && !error && <ThemedText>{copy.loading}</ThemedText>}
          {data && <>
            {/* Headcount leads as a single absolute number: it is the figure a contractor
                checks first, and it counts every employee, including code-joined arrivals. */}
            <View style={styles.headcountGroup}>
              <View style={[styles.headcount, { backgroundColor: theme.backgroundElement }, cardShadow(theme.isDark)]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.hours}
                  hitSlop={10}
                  onPress={() => setHoursInfoOpen(true)}
                  style={({ pressed }) => [styles.info, pressed && { opacity: 0.6 }]}>
                  <Ionicons name="information-circle-outline" size={22} color={theme.textSecondary} />
                </Pressable>
                <ThemedText style={{ fontSize: 64, lineHeight: 70, fontWeight: '700' }}>{data.employees}</ThemedText>
                <ThemedText type="smallBold">{copy.headcount}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {data.active_employees} {copy.activeSuffix} · {data.confirmed} {copy.onSiteToday}
                </ThemedText>
              </View>
              {/* Flush against the bubble above: the three read as one block
                  about the company, not as three unrelated cards. */}
              <View style={styles.statRow}>
                {[{ label: copy.review, value: data.to_review }, { label: copy.hours, value: data.declared_hours + ' h' }].map((stat, index) =>
                  <View
                    key={stat.label}
                    style={[
                      styles.stat,
                      cardShadow(theme.isDark),
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.backgroundSelected,
                        borderBottomLeftRadius: index === 0 ? 22 : 4,
                        borderBottomRightRadius: index === 0 ? 4 : 22,
                      },
                    ]}>
                    <ThemedText style={{ fontSize: 32, fontWeight: '700' }}>{stat.value}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{stat.label}</ThemedText>
                  </View>)}
              </View>
            </View>
            <TeamList reloadKey={reloadKey} />

            {!!data.flags.length && <Card>
              <ThemedText style={{ fontSize: 22, fontWeight: '700' }} themeColor="warning">{copy.consistency}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{copy.consistencyHint}</ThemedText>
              {data.flags.map((flag, i) => <View key={flag.employee_id + '-' + i} style={{ gap: 6 }}>
                <ThemedText type="smallBold">{flag.employee_name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{flag[label]} · {flag.quantity} {unitShort(flag.unit, copy)} · {flag.site_name}</ThemedText>
              </View>)}
            </Card>}
          </>}
        </Page>
      </Animated.ScrollView>

      <AppModal
        visible={hoursInfoOpen}
        onClose={() => setHoursInfoOpen(false)}
        title={copy.hours}
        icon="time-outline"
        actions={<ModalButton label={t.common.done} onPress={() => setHoursInfoOpen(false)} />}>
        <ThemedText type="small" themeColor="textSecondary">{copy.hoursHint}</ThemedText>
      </AppModal>
    </View>
  );
}

/**
 * One board of the pager. The content eases in as the page arrives rather than
 * sliding in rigidly with the finger, which is what makes a swipe feel like it
 * carries something.
 */
function Page({
  index,
  scrollX,
  pageWidth,
  headerHeight,
  headerOffset,
  refreshControl,
  children,
}: {
  index: number;
  scrollX: SharedValue<number>;
  pageWidth: number;
  headerHeight: number;
  headerOffset: SharedValue<number>;
  refreshControl?: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
  children: React.ReactNode;
}) {
  /* eslint-disable react-hooks/immutability -- a shared value is written from a
     worklet on purpose; this predates the compiler's understanding of them. */
  // Only the page under the thumb drives the header, or the other board's
  // resting position would push it back down mid-swipe.
  const onScroll = useAnimatedScrollHandler((event) => {
    if (Math.round(scrollX.value / Math.max(pageWidth, 1)) === index) {
      headerOffset.value = event.contentOffset.y;
    }
  });
  /* eslint-enable react-hooks/immutability */

  const style = useAnimatedStyle(() => {
    const range = [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth];
    return {
      opacity: interpolate(scrollX.value, range, [0.35, 1, 0.35], 'clamp'),
      transform: [
        { scale: interpolate(scrollX.value, range, [0.94, 1, 0.94], 'clamp') },
        // A touch of drag: the outgoing page trails the finger slightly.
        { translateX: interpolate(scrollX.value, range, [pageWidth * 0.12, 0, -pageWidth * 0.12], 'clamp') },
      ],
    };
  });

  return (
    <Animated.ScrollView
      style={{ width: pageWidth }}
      contentContainerStyle={[pageStyles.page, { paddingTop: headerHeight + 8 }]}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={refreshControl}>
      <Animated.View style={style}>{children}</Animated.View>
    </Animated.ScrollView>
  );
}

const TAB_GAP = 10;
/** Between the title and the tabs; also how far the header travels up. */
const HEADER_GAP = 16;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    gap: HEADER_GAP,
  },
  tabs: {
    flexDirection: 'row',
    gap: TAB_GAP,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 16,
  },
  tabPress: {
    flex: 1,
  },
  tab: {
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
  },
  pager: {
    flex: 1,
  },
  headcountGroup: {
    gap: 4,
    // The block ends here; the employee list below is a separate subject.
    marginBottom: 12,
  },
  headcount: {
    padding: 28,
    gap: 6,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  info: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  statRow: {
    flexDirection: 'row',
    gap: 4,
  },
  stat: {
    flex: 1,
    padding: 22,
    gap: 8,
    borderWidth: 1,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
});
