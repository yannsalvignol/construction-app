import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { BrandSpinner } from '@/components/brand-spinner';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/work-ui';
import { Spacing } from '@/constants/theme';
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

type Line = {
  line_id: string;
  lot: string | null;
  label: string;
  unit: string | null;
  quoted: number | null;
  declared_total: number;
  declared_today: number;
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

  const load = useCallback(async () => {
    const { data, error: failure } = await supabase.rpc('day_quote_lines', { day_id: dayId });
    if (failure) { setError(copy.failed); return; }
    setLines((data as Line[]) ?? []);
  }, [dayId, copy.failed]);

  // On focus: a chef may validate the devis while the worker is in the app.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

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
    <Card>
      <ThemedText style={styles.title}>{t.quoteTasks.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{t.quoteTasks.hint}</ThemedText>

      {lines.map((line) => {
        const left = line.quoted == null ? null : Math.max(0, Number(line.quoted) - Number(line.declared_total));
        const complete = left === 0;
        const unit = line.unit ? unitShort(line.unit as never, copy) : '';
        return (
          <View key={line.line_id} style={[styles.row, { borderTopColor: theme.backgroundSelected }]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => { setOpen(open === line.line_id ? null : line.line_id); setTyped(''); setSaved(null); }}
              style={({ pressed }) => [styles.head, pressed && styles.pressed]}>
              <Ionicons
                name={complete ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={complete ? theme.success : theme.textPlaceholder}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText type="small">{line.label}</ThemedText>
                <ThemedText type="small" themeColor={complete ? 'success' : 'textSecondary'}>
                  {complete
                    ? t.quoteTasks.done
                    : left == null
                      ? ''
                      : t.quoteTasks.remaining(`${left} ${unit}`)}
                  {Number(line.declared_today) > 0
                    ? ` · ${t.quoteTasks.todayLabel(`${line.declared_today} ${unit}`)}`
                    : ''}
                </ThemedText>
              </View>
              {saved === line.line_id && <Ionicons name="checkmark" size={18} color={theme.success} />}
            </Pressable>

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

      {!!error && <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700' },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
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
  pressed: { opacity: 0.6 },
});
