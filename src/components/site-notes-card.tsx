import { useCallback, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { BrandSpinner } from './brand-spinner';
import { ThemedText } from './themed-text';
import { Action, Card } from './work-ui';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { workCopy } from '@/lib/work-copy';

type Note = { id: string; body: string; created_at: string };

const MAX = 1000;

/**
 * A chef's word to the men on one chantier, reached from beside it.
 *
 * Collapsed it is a column the width of its icon, standing against the
 * chantier card — no label, because a speech bubble next to a chantier is not
 * ambiguous, and a second line of words on every row would make the list
 * harder to read, not easier. Open, it unfolds full width underneath, where
 * there is room to write: it shows what has already been said, since a chef
 * should see the last instruction before adding another, and be able to take
 * one back.
 */
export function SiteNotesCard({ siteId, children }: { siteId: string; children: React.ReactNode }) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const palette = useAuthPalette();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: failure } = await supabase.rpc('site_notes', { site: siteId });
    if (failure) { setError(copy.failed); return; }
    setNotes((data ?? []) as Note[]);
    setError(null);
  }, [siteId, copy.failed]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !notes) void load();
  }

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setError(null);
    // Through the Edge Function rather than the RPC directly: it writes the
    // note as the chef and then notifies the men on the chantier, which needs
    // the service role and so cannot happen from here.
    const { error: failure } = await supabase.functions.invoke('post-site-note', {
      body: { site: siteId, body },
    });
    setBusy(false);
    if (failure) { setError(copy.failed); return; }
    setDraft('');
    await load();
  }

  function confirmDelete(note: Note) {
    Alert.alert(copy.noteDelete, copy.noteDeleteConfirm, [
      { text: copy.cancel, style: 'cancel' },
      {
        text: copy.noteDelete,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const { error: failure } = await supabase.rpc('delete_site_note', { note: note.id });
            if (failure) { setError(copy.failed); return; }
            await load();
          })();
        },
      },
    ]);
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR',
      { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 8 }}>
      <View style={{ flex: 1 }}>{children}</View>
      {/* As tall as the chantier beside it, as wide as its icon. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={copy.noteTitle}
        onPress={toggle}
        style={({ pressed }) => ({
          width: 56,
          borderRadius: 20,
          borderWidth: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          backgroundColor: open ? theme.backgroundSelected : theme.backgroundElement,
          // Dark grey rather than the card tone: the chantier card beside it
          // has no border at all, so this one has to draw its own edge.
          borderColor: theme.textSecondary,
          opacity: pressed ? 0.6 : 1,
        })}>
        <Ionicons
          name={notes?.length ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
          size={22}
          color={notes?.length ? theme.accentText : theme.textSecondary}
        />
        {!!notes?.length && (
          <ThemedText type="small" themeColor="accentText">{notes.length}</ThemedText>
        )}
      </Pressable>
    </View>

    {open && <Card>
      {!notes && !error && <BrandSpinner color={theme.accent} />}
      {error && <ThemedText type="small" themeColor="danger">{error}</ThemedText>}

      {notes?.map(note => (
        <View
          key={note.id}
          style={{
            gap: 4, paddingLeft: 14, borderLeftWidth: 3, borderLeftColor: theme.backgroundSelected,
          }}>
          <ThemedText type="small">{note.body}</ThemedText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
              {when(note.created_at)}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.noteDelete}
              hitSlop={10}
              onPress={() => confirmDelete(note)}>
              <Ionicons name="trash-outline" size={16} color={theme.textSecondary} />
            </Pressable>
          </View>
        </View>
      ))}

      <TextInput
        style={{
          backgroundColor: palette.field,
          borderColor: theme.backgroundSelected,
          borderWidth: 1,
          borderRadius: 14,
          padding: 14,
          minHeight: 88,
          fontSize: 16,
          color: theme.text,
          textAlignVertical: 'top',
        }}
        allowFontScaling={false}
        multiline
        maxLength={MAX}
        value={draft}
        onChangeText={setDraft}
        placeholder={copy.noteTitle}
        placeholderTextColor={theme.textPlaceholder}
      />
      <Action label={copy.noteSend} busy={busy} disabled={!draft.trim()} onPress={() => { void send(); }} />
    </Card>}
  </View>;
}
