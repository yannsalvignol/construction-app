import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppModal, ModalButton } from '@/components/app-modal';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { BrandSpinner } from '@/components/brand-spinner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { cardShadow, MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

/**
 * The review screen: every line the parser read, next to what it made of it,
 * before any of it counts.
 *
 * This screen is the product, not a safety net. Extraction from a clean
 * tabular PDF is close to solved; from a photograph of an annotated paper
 * devis it is not, and a wrong quantity silently poisons every percentage
 * derived from it. So nothing reaches a dashboard until a chef has been
 * through here and pressed validate.
 */

type Line = {
  id: string;
  position: number;
  lot: string | null;
  label: string;
  kind: 'work' | 'heading' | 'discount';
  source_unit: string | null;
  unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount_ht: number | null;
  task_code: string | null;
};

type Quote = {
  id: string;
  company_id: string;
  file_name: string;
  status: 'stored' | 'parsing' | 'parsed' | 'validated' | 'failed';
  total_ht: number | null;
  currency: string;
  parse_error: string | null;
  parse_warning: string | null;
  site_id: string;
};

type Code = { code: string; label_fr: string | null; unit: string };

type Milestone = {
  id: string;
  position: number;
  label: string;
  percent: number | null;
  amount_ht: number | null;
  is_retention: boolean;
  validated_at: string | null;
};

const money = (value: number, currency: string) =>
  `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export default function QuoteReviewScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [codes, setCodes] = useState<Code[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [picking, setPicking] = useState<Line | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  // A hundred lines is a lot of scrolling in card form; the compact view is
  // for reading the devis against the paper, the cards for correcting it.
  const [dense, setDense] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: q }, { data: rows }, { data: catalogue }, { data: schedule }] = await Promise.all([
      supabase
        .from('site_quotes')
        .select('id, company_id, file_name, status, total_ht, currency, parse_error, parse_warning, site_id')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('quote_lines')
        .select('id, position, lot, label, kind, source_unit, unit, quantity, unit_price, amount_ht, task_code')
        .eq('quote_id', id)
        .order('position'),
      supabase.from('task_codes').select('code, label_fr, unit').eq('is_active', true).order('code'),
      supabase
        .from('quote_milestones')
        .select('id, position, label, percent, amount_ht, is_retention, validated_at')
        .eq('quote_id', id)
        .order('position'),
    ]);
    setQuote((q as Quote) ?? null);
    setLines((rows as Line[]) ?? []);
    setCodes((catalogue as Code[]) ?? []);
    setMilestones((schedule as Milestone[]) ?? []);
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // While the parser is working the row count climbs; a poll is enough and
  // costs nothing next to the parse itself.
  useFocusEffect(
    useCallback(() => {
      if (quote?.status !== 'parsing') return;
      const timer = setInterval(() => { void load(); }, 4000);
      return () => clearInterval(timer);
    }, [quote?.status, load])
  );

  const readTotal = lines.reduce((sum, line) => sum + Number(line.amount_ht ?? 0), 0);
  const totalsAgree =
    quote?.total_ht != null && Math.abs(readTotal - Number(quote.total_ht)) < 1;

  const results = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return codes;
    return codes.filter(
      (code) =>
        code.code.toLowerCase().includes(needle) ||
        (code.label_fr ?? '').toLowerCase().includes(needle)
    );
  }, [codes, search]);

  async function setCode(line: Line, code: string | null) {
    setPicking(null);
    setSearch('');
    setLines((current) => current.map((row) => (row.id === line.id ? { ...row, task_code: code } : row)));
    const { error: failure } = await supabase.from('quote_lines').update({ task_code: code }).eq('id', line.id);
    if (failure) { setError(failure.message); void load(); }
  }

  async function setQuantity(line: Line, raw: string) {
    const value = raw.trim() === '' ? null : Number(raw.replace(',', '.'));
    if (value !== null && Number.isNaN(value)) return;
    setLines((current) => current.map((row) => (row.id === line.id ? { ...row, quantity: value } : row)));
    const { error: failure } = await supabase.from('quote_lines').update({ quantity: value }).eq('id', line.id);
    if (failure) setError(failure.message);
  }

  async function setLabel(line: Line, value: string) {
    const label = value.trim();
    if (!label || label === line.label) return;
    setLines((current) => current.map((row) => (row.id === line.id ? { ...row, label } : row)));
    const { error: failure } = await supabase.from('quote_lines').update({ label }).eq('id', line.id);
    if (failure) setError(failure.message);
  }

  /** A line the parser missed, or one the devis states in a way it could not
   *  read. It starts empty and unposted-looking on purpose: the chef names it. */
  async function addLine() {
    if (!quote) return;
    const position = lines.reduce((highest, row) => Math.max(highest, row.position), -1) + 1;
    const { data, error: failure } = await supabase
      .from('quote_lines')
      .insert({
        quote_id: quote.id,
        company_id: quote.company_id,
        position,
        label: t.quoteReview.newLine,
        kind: 'work',
      })
      .select('id, position, lot, label, kind, source_unit, unit, quantity, unit_price, amount_ht, task_code')
      .single();
    if (failure) { setError(failure.message); return; }
    setLines((current) => [...current, data as Line]);
  }

  async function removeLine(line: Line) {
    setLines((current) => current.filter((row) => row.id !== line.id));
    const { error: failure } = await supabase.from('quote_lines').delete().eq('id', line.id);
    if (failure) { setError(failure.message); void load(); }
  }

  async function toggleMilestone(milestone: Milestone) {
    const validated_at = milestone.validated_at ? null : new Date().toISOString();
    setMilestones((current) =>
      current.map((row) => (row.id === milestone.id ? { ...row, validated_at } : row))
    );
    const { error: failure } = await supabase
      .from('quote_milestones')
      .update({ validated_at })
      .eq('id', milestone.id);
    if (failure) { setError(failure.message); void load(); }
  }

  async function validate() {
    if (!quote) return;
    setSaving(true);
    const { error: failure } = await supabase
      .from('site_quotes')
      .update({ status: 'validated' })
      .eq('id', quote.id);
    setSaving(false);
    if (failure) { setError(failure.message); return; }
    router.back();
  }

  async function reparse() {
    setError(null);
    const { error: failure } = await supabase.functions.invoke('parse-quote', { body: { quoteId: id } });
    if (failure) setError(String(failure.message));
    else void load();
  }

  if (!quote) {
    return (
      <ThemedView style={[styles.container, styles.centre]}>
        <BrandSpinner />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.toolbar}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={8}
            accessibilityLabel={t.common.back}
            style={({ pressed }) => pressed && styles.pressed}>
            <Ionicons name="chevron-back" size={28} color={theme.text} />
          </Pressable>
          <ThemedText type="subtitle" style={{ flex: 1 }} numberOfLines={1}>
            {t.quoteReview.title}
          </ThemedText>
          <ViewToggle dense={dense} onChange={setDense} />
        </View>

        {quote.status === 'parsing' && (
          <View style={styles.centre}>
            <BrandSpinner size={64} alternate />
            <ThemedText style={styles.centreText}>{t.quoteReview.parsing}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centreText}>
              {t.quoteReview.parsingHint}
            </ThemedText>
          </View>
        )}

        {quote.status === 'failed' && (
          <View style={styles.centre}>
            <ThemedText style={styles.centreText}>{t.quoteReview.failed}</ThemedText>
            {!!quote.parse_error && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.centreText}>
                {quote.parse_error}
              </ThemedText>
            )}
            <Pressable
              onPress={() => { void reparse(); }}
              style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent }, pressed && styles.pressed]}>
              <ThemedText style={{ color: theme.buttonText }}>{t.quoteReview.retry}</ThemedText>
            </Pressable>
          </View>
        )}

        {(quote.status === 'parsed' || quote.status === 'validated') && (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ThemedText type="small" themeColor="textSecondary">{t.quoteReview.subtitle}</ThemedText>

            {/* The devis parsed, but a page returned fewer lines than it
                counted. Named here so the chef knows which page to check
                rather than noticing a missing line on site. */}
            {!!quote.parse_warning && (
              <ThemedText type="small" style={{ color: theme.warning }}>
                {quote.parse_warning}
              </ThemedText>
            )}

            {/* The devis states its own total; ours is the sum of what was
                read. When they disagree, something was missed. */}
            <View style={[styles.card, cardShadow(theme.isDark), { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.row}>
                <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                  {t.quoteReview.totalRead}
                </ThemedText>
                <ThemedText type="smallBold">{money(readTotal, quote.currency)}</ThemedText>
              </View>
              {quote.total_ht != null && (
                <View style={styles.row}>
                  <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                    {t.quoteReview.totalQuoted}
                  </ThemedText>
                  <ThemedText type="smallBold">{money(Number(quote.total_ht), quote.currency)}</ThemedText>
                </View>
              )}
              <ThemedText type="small" style={{ color: totalsAgree ? theme.success : theme.warning }}>
                {totalsAgree ? t.quoteReview.totalsMatch : t.quoteReview.totalsDiffer}
              </ThemedText>
            </View>

            {milestones.length > 0 && (
              <View style={[styles.card, cardShadow(theme.isDark), { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold">{t.quoteReview.milestones}</ThemedText>
                {milestones.map((milestone) => (
                  <Pressable
                    key={milestone.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: !!milestone.validated_at }}
                    onPress={() => { void toggleMilestone(milestone); }}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                    <Ionicons
                      name={milestone.validated_at ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={milestone.validated_at ? theme.success : theme.textPlaceholder}
                    />
                    <View style={{ flex: 1 }}>
                      <ThemedText type="small">{milestone.label}</ThemedText>
                      {milestone.is_retention && (
                        <ThemedText type="small" themeColor="textSecondary">
                          {t.quoteReview.milestoneRetention}
                        </ThemedText>
                      )}
                    </View>
                    {quote.total_ht != null && milestone.percent != null && (
                      <ThemedText type="small" themeColor="textSecondary">
                        {money((Number(quote.total_ht) * Number(milestone.percent)) / 100, quote.currency)}
                      </ThemedText>
                    )}
                  </Pressable>
                ))}
              </View>
            )}

            {lines.map((line) =>
              line.kind === 'work' ? (
                <SwipeToDelete
                  key={line.id}
                  label={t.quoteReview.deleteLine}
                  radius={Spacing.three}
                  onDelete={() => { void removeLine(line); }}>
                  <LineRow
                    line={line}
                    currency={quote.currency}
                    dense={dense}
                    onPickCode={() => setPicking(line)}
                    onQuantity={(value) => { void setQuantity(line, value); }}
                    onLabel={(value) => { void setLabel(line, value); }}
                  />
                </SwipeToDelete>
              ) : (
                <LineRow
                  key={line.id}
                  line={line}
                  currency={quote.currency}
                  dense={dense}
                  onPickCode={() => setPicking(line)}
                  onQuantity={(value) => { void setQuantity(line, value); }}
                  onLabel={(value) => { void setLabel(line, value); }}
                />
              )
            )}

            <ThemedText type="small" themeColor="textSecondary">{t.quoteReview.swipeHint}</ThemedText>

            {/* A devis the parser read short is the case this screen exists
                for; adding the missing line has to be possible here. */}
            <Pressable
              onPress={() => { void addLine(); }}
              style={({ pressed }) => [
                styles.addLine,
                { borderColor: theme.accent },
                pressed && styles.pressed,
              ]}>
              <Ionicons name="add" size={18} color={theme.accentText} />
              <ThemedText type="smallBold" themeColor="accentText">{t.quoteReview.addLine}</ThemedText>
            </Pressable>

            {!!error && <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>}

            <Pressable
              disabled={saving}
              onPress={() => { void validate(); }}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: theme.accent, opacity: pressed || saving ? 0.7 : 1 },
              ]}>
              <ThemedText style={{ color: theme.buttonText }}>
                {saving
                  ? t.quoteReview.validating
                  : quote.status === 'validated'
                    ? t.quoteReview.validated
                    : t.quoteReview.validate}
              </ThemedText>
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>

      <AppModal
        visible={!!picking}
        onClose={() => { setPicking(null); setSearch(''); }}
        title={t.quoteReview.assignCode}
        icon="create-outline"
        actions={
          <ModalButton
            secondary
            label={t.quoteReview.noCode}
            onPress={() => { if (picking) void setCode(picking, null); }}
          />
        }>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {picking?.label}
        </ThemedText>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t.quoteReview.searchCode}
          placeholderTextColor={theme.textPlaceholder}
          autoCapitalize="characters"
          autoCorrect={false}
          style={[styles.search, { backgroundColor: theme.backgroundInput, color: theme.text }]}
        />
        <ScrollView style={styles.codeList} keyboardShouldPersistTaps="handled">
          {results.map((code) => (
            <Pressable
              key={code.code}
              onPress={() => { if (picking) void setCode(picking, code.code); }}
              style={({ pressed }) => [styles.codeRow, pressed && styles.pressed]}>
              <View style={{ flex: 1 }}>
                <ThemedText type="small">{code.label_fr ?? code.code}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {code.code} · {code.unit}
                </ThemedText>
              </View>
              {picking?.task_code === code.code && (
                <Ionicons name="checkmark" size={18} color={theme.success} />
              )}
            </Pressable>
          ))}
        </ScrollView>
      </AppModal>
    </ThemedView>
  );

}

/** Width of one half of the toggle; the thumb travels exactly this far. */
const TOGGLE_HALF = 40;

/**
 * Detailed or compact, as a switch rather than a button that changes meaning:
 * both states are visible at once, and the thumb slides to the one in force so
 * the control says what it is showing rather than what it would do next.
 */
function ViewToggle({ dense, onChange }: { dense: boolean; onChange: (dense: boolean) => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  // Driven from the press, not derived from the prop: deriving made the thumb
  // wait for React to re-render the screen's hundred rows before it began to
  // move, which is the lag. Written here it starts on the same frame as the
  // touch, and the re-render happens behind it.
  const position = useSharedValue(dense ? 1 : 0);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * TOGGLE_HALF }],
  }));

  return (
    <View style={[styles.toggle, { backgroundColor: theme.backgroundInput }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.toggleThumb,
          cardShadow(theme.isDark),
          { backgroundColor: theme.backgroundElement },
          thumbStyle,
        ]}
      />
      {([false, true] as const).map((value) => (
        <Pressable
          key={String(value)}
          accessibilityRole="button"
          accessibilityState={{ selected: dense === value }}
          accessibilityLabel={value ? t.quoteReview.viewList : t.quoteReview.viewCards}
          onPress={() => {
            position.value = withSpring(value ? 1 : 0, { damping: 20, stiffness: 420, mass: 0.6 });
            onChange(value);
          }}
          style={styles.toggleHalf}>
          <Ionicons
            name={value ? 'list-outline' : 'grid-outline'}
            size={18}
            color={dense === value ? theme.text : theme.textPlaceholder}
          />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * One line of the devis, read-only until its corner pencil is pressed.
 *
 * Declared at module scope on purpose: nested inside the screen it would be a
 * new component type on every render, so React would remount each row —
 * dropping edit mode and the keyboard focus with it.
 */
function LineRow({
  line,
  currency,
  dense,
  onPickCode,
  onQuantity,
  onLabel,
}: {
  line: Line;
  currency: string;
  /** One line per row instead of a card. Editing still opens in place. */
  dense: boolean;
  onPickCode: () => void;
  onQuantity: (value: string) => void;
  onLabel: (value: string) => void;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);

  // A heading carries no quantity and a discount is not work: neither takes a
  // code, and neither is worth an edit affordance.
  if (line.kind !== 'work') {
    return (
      <View style={dense ? styles.asideDense : styles.aside}>
        <ThemedText type="smallBold" themeColor={line.kind === 'discount' ? 'danger' : 'textSecondary'}>
          {line.label}
        </ThemedText>
        {line.amount_ht != null && (
          <ThemedText type="small" themeColor="textSecondary">
            {money(Number(line.amount_ht), currency)}
          </ThemedText>
        )}
      </View>
    );
  }

  // Compact: the whole row opens the editor, so there is no corner control to
  // hunt for at this size.
  if (dense && !editing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.quoteReview.editLine}
        onPress={() => setEditing(true)}
        style={({ pressed }) => [
          styles.denseRow,
          { borderBottomColor: theme.backgroundSelected },
          pressed && styles.pressed,
        ]}>
        <ThemedText type="small" numberOfLines={1} style={{ flex: 1 }}>{line.label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {line.quantity ?? '—'} {line.source_unit ?? line.unit ?? ''}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, cardShadow(theme.isDark), { backgroundColor: theme.backgroundElement }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.quoteReview.editLine}
        hitSlop={10}
        onPress={() => setEditing((current) => !current)}
        style={({ pressed }) => [styles.editCorner, pressed && styles.pressed]}>
        <Ionicons
          name={editing ? 'checkmark' : 'create-outline'}
          size={18}
          color={editing ? theme.success : theme.textPlaceholder}
        />
      </Pressable>

      {editing ? (
        <TextInput
          defaultValue={line.label}
          onEndEditing={(event) => onLabel(event.nativeEvent.text)}
          multiline
          autoFocus
          accessibilityLabel={t.quoteReview.lineLabel}
          style={[styles.labelInput, { color: theme.text, backgroundColor: theme.backgroundInput }]}
        />
      ) : (
        <ThemedText type="small" style={styles.labelRead}>{line.label}</ThemedText>
      )}

      <View style={styles.row}>
        {editing ? (
          <TextInput
            defaultValue={line.quantity == null ? '' : String(line.quantity)}
            onEndEditing={(event) => onQuantity(event.nativeEvent.text)}
            keyboardType="decimal-pad"
            accessibilityLabel={t.quoteReview.quantity}
            style={[styles.qty, { backgroundColor: theme.backgroundInput, color: theme.text }]}
          />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {line.quantity ?? '—'}
          </ThemedText>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          {line.source_unit ?? line.unit ?? ''}
        </ThemedText>
        <View style={{ flex: 1 }} />
        {line.amount_ht != null && (
          <ThemedText type="small" themeColor="textSecondary">
            {money(Number(line.amount_ht), currency)}
          </ThemedText>
        )}
      </View>

      {/* The code is shown either way: a line without one will not count, and
          that has to be visible without opening anything. */}
      {editing ? (
        <Pressable
          onPress={onPickCode}
          style={({ pressed }) => [
            styles.codePill,
            { backgroundColor: theme.backgroundInput },
            pressed && styles.pressed,
          ]}>
          <Ionicons name="create-outline" size={15} color={theme.textPlaceholder} />
          <ThemedText type="small" themeColor={line.task_code ? 'text' : 'textSecondary'}>
            {line.task_code ?? t.quoteReview.noCode}
          </ThemedText>
        </Pressable>
      ) : line.task_code ? (
        <ThemedText type="small" themeColor="textSecondary">{line.task_code}</ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  centreText: { textAlign: 'center' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  content: { padding: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.six },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  aside: { paddingTop: Spacing.three, paddingHorizontal: Spacing.one, gap: 2 },
  asideDense: { paddingTop: Spacing.two, paddingHorizontal: Spacing.one },
  denseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  labelInput: {
    fontSize: 14,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
  },
  labelRead: {
    // Room for the corner control, so a long label never runs under it.
    paddingRight: Spacing.four,
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
  },
  toggleHalf: {
    width: TOGGLE_HALF,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleThumb: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: TOGGLE_HALF,
    height: 30,
    borderRadius: 8,
  },
  editCorner: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    zIndex: 1,
  },
  addLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 48,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: Spacing.two,
  },
  qty: {
    minWidth: 88,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
    fontSize: 15,
  },
  codePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  search: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  codeList: { maxHeight: 260 },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  primary: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.three,
  },
  pressed: { opacity: 0.6 },
});
