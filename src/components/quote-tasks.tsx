import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { BrandSpinner } from '@/components/brand-spinner';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/work-ui';
import { cardShadow, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { unitShort, workCopy } from '@/lib/work-copy';

/**
 * The chantier's devis, as the employee's to-do list.
 *
 * He reads the words his chef quoted, not our catalogue's: "8- CHUTES ET
 * EVACUATION EN PVC" rather than PLB_PVC_DN100. Each line says what is left,
 * and declaring against it is what fills the chef's progress bars.
 *
 * Only a validated devis appears: one still being checked has unverified
 * quantities, and asking somebody to work towards a number that may be wrong
 * is worse than showing nothing.
 */

type Step = {
  step_id: string;
  label: string;
  done: boolean;
  /** Set only when somebody else ticked it; his own tick needs no name. */
  done_by_name: string | null;
  /** The chef put this operation on him by name. */
  mine: boolean;
  /** It is somebody's, his or not. Nobody's means open to whoever gets there. */
  assigned: boolean;
};

/** What the devis still expects on this line, or null when it quoted no figure. */
function remaining(line: Line) {
  if (line.quoted == null) return null;
  return Math.max(0, Number(line.quoted) - Number(line.declared_total));
}

type Line = {
  line_id: string;
  lot: string | null;
  /** The heading the line is printed under — the devis's words, not its numbering. */
  section: string | null;
  label: string;
  unit: string | null;
  quoted: number | null;
  declared_total: number;
  declared_today: number;
  /** His, by the line or by any one of its operations. */
  mine: boolean;
  assigned: boolean;
  steps: Step[];
};

export function QuoteTasks({ dayId, onSaved }: { dayId: string; onSaved: () => Promise<void> }) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const copy = workCopy(locale);

  const [lines, setLines] = useState<Line[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [stepBusy, setStepBusy] = useState<string | null>(null);
  // Closed to begin with. A devis of three hundred lines is unreadable open,
  // and a worker is in one lot at a time; several may be opened at once because
  // a day that spans two of them is not unusual.
  const [openLots, setOpenLots] = useState<ReadonlySet<string>>(new Set());
  // What the chef put his name on, when he put it on anything. The devis is
  // the whole chantier and most of it is somebody else's; a worker who was
  // given four lines should open the app on those four.
  const [onlyMine, setOnlyMine] = useState(true);

  const mineCount = useMemo(() => (lines ?? []).filter((line) => line.mine).length, [lines]);
  const showing = useMemo(
    () => (onlyMine && mineCount > 0 ? (lines ?? []).filter((line) => line.mine) : lines ?? []),
    [lines, onlyMine, mineCount]
  );

  const grouped = useMemo(() => {
    const byLot = new Map<string, Line[]>();
    for (const line of showing) {
      // Insertion order, so the sections follow the devis rather than the
      // alphabet. The heading is what the devis calls this part of the
      // chantier; the lot is only its numbering.
      const lot = line.section?.trim() || line.lot?.trim() || t.quoteTasks.noLot;
      const rows = byLot.get(lot);
      if (rows) rows.push(line);
      else byLot.set(lot, [line]);
    }
    return [...byLot.entries()];
  }, [showing, t.quoteTasks.noLot]);

  const load = useCallback(async () => {
    const { data, error: failure } = await supabase.rpc('day_quote_lines', { day_id: dayId });
    if (failure) { setError(copy.failed); return; }
    setLines((data as Line[]) ?? []);
  }, [dayId, copy.failed]);

  // On focus: a chef may validate the devis while the worker is in the app.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  /**
   * Ticking is optimistic: the list redraws before the server answers, because
   * a tick that waits on a round trip on a chantier's signal feels broken. A
   * refusal puts it back.
   */
  async function toggle(step: Step) {
    if (stepBusy) return;
    setStepBusy(step.step_id);
    setError(null);
    setLines((current) => current?.map((line) => ({
      ...line,
      steps: line.steps.map((s) => (s.step_id === step.step_id ? { ...s, done: !s.done } : s)),
    })) ?? current);
    const { error: failure } = await supabase.rpc('set_quote_line_step', {
      step: step.step_id,
      done: !step.done,
    });
    setStepBusy(null);
    if (failure) { setError(failure.message); }
    await load();
  }

  /**
   * Ticking a line off means its quoted quantity is reached, not that some
   * figure was typed — which is what a worker means when he says a line is
   * done. Unticking takes back today's declaration; an earlier day's is not
   * his to undo from here.
   */
  async function toggleLine(line: Line) {
    if (busy) return;
    const left = remaining(line);
    // A line the devis quoted no figure for has nothing to reach; its steps are
    // the only thing to tick.
    if (left === null) return;
    const before = Number(line.declared_total) - Number(line.declared_today);
    const amount = left > 0 ? Number((Number(line.quoted) - before).toFixed(2)) : 0;
    setBusy(true);
    setError(null);
    // Optimistic, like the steps: a tick that waits on a chantier's signal
    // feels broken.
    setLines((current) => current?.map((row) => row.line_id === line.line_id
      ? { ...row, declared_today: amount, declared_total: before + amount }
      : row) ?? current);
    const { error: failure } = await supabase.rpc('declare_quote_line', {
      day_id: dayId, line_id: line.line_id, amount,
    });
    setBusy(false);
    if (failure) setError(failure.message);
    await load();
    await onSaved();
  }

  async function declare(line: Line) {
    const amount = Number(typed.trim().replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) { setError(copy.invalidQuantity); return; }
    setBusy(true);
    setError(null);
    const { error: failure } = await supabase.rpc('declare_quote_line', {
      day_id: dayId,
      line_id: line.line_id,
      amount,
    });
    setBusy(false);
    if (failure) { setError(failure.message); return; }
    setOpen(null);
    setTyped('');
    setSaved(line.line_id);
    await load();
    await onSaved();
  }

  if (!lines) return <Card><BrandSpinner /></Card>;
  if (!lines.length) return null;

  return (
    // Not one card around the lot: each lot is its own card, and a card inside
    // a card reads as two objects where there is one.
    <View style={styles.list}>
      <View style={{ gap: 4 }}>
        <ThemedText style={styles.title}>{t.quoteTasks.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t.quoteTasks.hint}</ThemedText>
      </View>

      {/* Only when the chef has actually handed something out. A devis nobody
          was named on must look exactly as it did before: unassigned means
          open to whoever gets there, not "not yours". */}
      {mineCount > 0 && (
        <View style={styles.scope}>
          {([true, false] as const).map((value) => (
            <Pressable
              key={String(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: onlyMine === value }}
              onPress={() => setOnlyMine(value)}
              style={({ pressed }) => [
                styles.scopeTab,
                onlyMine === value && { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <ThemedText
                type={onlyMine === value ? 'smallBold' : 'small'}
                themeColor={onlyMine === value ? 'text' : 'textSecondary'}>
                {value ? t.quoteTasks.scopeMine(mineCount) : t.quoteTasks.scopeAll}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      {/* One card per lot of the devis, closed. A worker opens the part of the
          chantier he is on and reads twenty lines rather than three hundred;
          each card says how far that lot has got without being opened. */}
      {grouped.map(([lot, rows]) => {
        const total = rows.length;
        const finished = rows.filter((line) => remaining(line) === 0).length;
        const allDone = finished === total;
        const isOpen = openLots.has(lot);
        return (
          <View
            key={lot}
            style={[
              styles.lotCard,
              cardShadow(theme.isDark),
              { backgroundColor: theme.backgroundElement },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={lot}
              onPress={() => setOpenLots((current) => {
                const next = new Set(current);
                if (next.has(lot)) next.delete(lot); else next.add(lot);
                return next;
              })}
              style={({ pressed }) => [styles.lotHead, pressed && styles.pressed]}>
              <Ionicons
                name={allDone ? 'checkmark-circle' : 'folder-outline'}
                size={22}
                color={allDone ? theme.success : theme.accentText}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText type="smallBold">{lot}</ThemedText>
                <ThemedText type="small" themeColor={allDone ? 'success' : 'textSecondary'}>
                  {allDone ? t.quoteTasks.lotAllDone : t.quoteTasks.lotProgress(finished, total)}
                </ThemedText>
              </View>
              <Ionicons
                name={isOpen ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={theme.textSecondary}
              />
            </Pressable>

            {isOpen && rows.map((line) => {

            const left = remaining(line);
            const complete = left === 0;
            const unit = line.unit ? unitShort(line.unit as never, copy) : '';
            const today = Number(line.declared_today);
            return (
              <View key={line.line_id} style={[styles.row, { borderTopColor: theme.separator }]}>
                <View style={styles.head}>
                  {/* The tick is its own target, so finishing a line is one tap
                      and does not go through a number anybody has to type. */}
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: complete, disabled: left === null }}
                    accessibilityLabel={line.label}
                    disabled={left === null || busy}
                    hitSlop={10}
                    onPress={() => { void toggleLine(line); }}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <Ionicons
                      name={complete ? 'checkmark-circle' : 'ellipse-outline'}
                      size={26}
                      color={complete ? theme.success : left === null ? theme.textPlaceholder : theme.accent}
                    />
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.quoteTasks.quantityFor(line.label)}
                    disabled={left === null}
                    onPress={() => { setOpen(open === line.line_id ? null : line.line_id); setTyped(''); setSaved(null); }}
                    style={({ pressed }) => [styles.headText, pressed && styles.pressed]}>
                    <View style={styles.labelRow}>
                      {/* Marked even in "tout le devis", where it is the only
                          thing telling his four lines from the other three
                          hundred. */}
                      {line.mine && (
                        <Ionicons name="person" size={13} color={theme.accentText} />
                      )}
                      <ThemedText
                        type="small"
                        style={[{ flex: 1 }, complete ? styles.struck : undefined]}
                        themeColor={complete ? 'textSecondary' : 'text'}>
                        {line.label}
                      </ThemedText>
                    </View>
                    <ThemedText type="small" themeColor={complete ? 'success' : 'textSecondary'}>
                      {complete
                        ? t.quoteTasks.done
                        : left == null
                          ? ''
                          : t.quoteTasks.remaining(`${left} ${unit}`)}
                      {today > 0 ? ` · ${t.quoteTasks.todayLabel(`${today} ${unit}`)}` : ''}
                    </ThemedText>
                  </Pressable>

                  {saved === line.line_id && <Ionicons name="checkmark" size={18} color={theme.success} />}
                </View>

                {line.steps.length > 0 && (
                  <View style={styles.steps}>
                    {line.steps.map((step) => (
                      <Pressable
                        key={step.step_id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: step.done, busy: stepBusy === step.step_id }}
                        accessibilityLabel={step.label}
                        disabled={!!stepBusy}
                        onPress={() => { void toggle(step); }}
                        style={({ pressed }) => [styles.step, pressed && styles.pressed]}>
                        <Ionicons
                          name={step.done ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={step.done ? theme.success : theme.textPlaceholder}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={styles.labelRow}>
                            {step.mine && (
                              <Ionicons name="person" size={12} color={theme.accentText} />
                            )}
                            <ThemedText
                              type="small"
                              themeColor={step.done ? 'textSecondary' : 'text'}
                              style={[{ flex: 1 }, step.done ? styles.struck : undefined]}>
                              {step.label}
                            </ThemedText>
                          </View>
                          {/* Whose work it was, when it was not his. */}
                          {!!step.done_by_name && (
                            <ThemedText type="small" themeColor="textSecondary">
                              {t.quoteTasks.doneBy(step.done_by_name)}
                            </ThemedText>
                          )}
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}

                {open === line.line_id && (
                  <View style={styles.form}>
                    <TextInput
                      value={typed}
                      onChangeText={setTyped}
                      keyboardType="decimal-pad"
                      autoFocus
                      accessibilityLabel={t.quoteTasks.quantityFor(line.label)}
                      placeholder={unit}
                      placeholderTextColor={theme.textPlaceholder}
                      style={[styles.input, { backgroundColor: theme.backgroundInput, color: theme.text }]}
                    />
                    <Pressable
                      disabled={busy}
                      onPress={() => { void declare(line); }}
                      style={({ pressed }) => [
                        styles.declare,
                        { backgroundColor: theme.accent, opacity: pressed || busy ? 0.7 : 1 },
                      ]}>
                      <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                        {busy ? t.quoteTasks.saving : t.quoteTasks.declare}
                      </ThemedText>
                    </Pressable>
                  </View>
                )}
              </View>
            );
            })}
          </View>
        );
      })}

      {!!error && <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700' },
  list: { gap: Spacing.two },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  headText: { flex: 1, gap: 2 },
  /** One lot, closed: the devis is browsed by the part of the chantier it covers. */
  lotCard: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingBottom: Spacing.one },
  lotHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three },
  form: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingBottom: Spacing.two },
  input: {
    flex: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  declare: {
    minHeight: 44,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Indented under the line they belong to, so they read as its parts rather
  // than as more lines of the devis.
  steps: { paddingLeft: Spacing.five, paddingBottom: Spacing.two, gap: Spacing.half },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingVertical: Spacing.one },
  /** "Pour moi" / "Tout le devis", when the chef has named him on anything. */
  scope: { flexDirection: 'row', gap: Spacing.one, alignSelf: 'flex-start' },
  scopeTab: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  struck: { textDecorationLine: 'line-through' },
  pressed: { opacity: 0.6 },
});
