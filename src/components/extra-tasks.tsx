import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ThemedText } from './themed-text';
import { Action, Card } from './work-ui';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { workCopy } from '@/lib/work-copy';

type Entry = { id: string; description: string; declared_at: string };

const MAX = 500;

/**
 * Work that is in neither list.
 *
 * The devis says what was sold and the catalogue says what the company
 * usually does; a chantier produces a third thing every week. The shuttering
 * rebuilt after a bad pour, the half-day lost to a late crane, the
 * neighbour's wall patched. It has no code and it is still work, and without
 * somewhere to put it the man tells his chef on the phone or not at all.
 *
 * Deliberately a blank box. The point is the cases nobody anticipated, and a
 * list of anticipated ones would be the catalogue again.
 */
export function ExtraTasks({ dayId, onSaved }: { dayId: string; onSaved?: () => void }) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const palette = useAuthPalette();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('extra_declarations')
      .select('id, description, declared_at')
      .eq('work_day_id', dayId)
      .order('declared_at');
    setEntries((data ?? []) as Entry[]);
  }, [dayId]);

  // On focus rather than on mount: the card is opened from a heading on a
  // screen that stays mounted, and a day declared on another device should
  // not be invisible here.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function add() {
    const description = draft.trim();
    if (!description || busy) return;
    setBusy(true); setError(null);
    const { error: failure } = await supabase.rpc('declare_extra', { day_id: dayId, description });
    setBusy(false);
    if (failure) { setError(copy.failed); return; }
    setDraft('');
    await load();
    onSaved?.();
  }

  async function remove(entry: Entry) {
    const { error: failure } = await supabase.rpc('delete_extra', { entry: entry.id });
    if (failure) { setError(copy.failed); return; }
    await load();
    onSaved?.();
  }

  return <Card>
    {entries.map((entry) => (
      <View
        key={entry.id}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 14,
          paddingLeft: 14, borderLeftWidth: 3, borderLeftColor: theme.backgroundSelected,
        }}>
        <ThemedText type="small" style={{ flex: 1 }}>{entry.description}</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.extraRemove}
          hitSlop={12}
          onPress={() => { void remove(entry); }}
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Ionicons name="trash-outline" size={22} color={theme.textSecondary} />
        </Pressable>
      </View>
    ))}

    {!!error && <ThemedText type="small" themeColor="danger">{error}</ThemedText>}

    <TextInput
      style={{
        backgroundColor: palette.field,
        borderColor: theme.backgroundSelected,
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        minHeight: 96,
        fontSize: 16,
        color: theme.text,
        textAlignVertical: 'top',
      }}
      allowFontScaling={false}
      multiline
      maxLength={MAX}
      value={draft}
      onChangeText={setDraft}
      placeholder={copy.extraPlaceholder}
      placeholderTextColor={theme.textPlaceholder}
    />
    <Action label={copy.extraAdd} busy={busy} disabled={!draft.trim()} onPress={() => { void add(); }} />
  </Card>;
}
