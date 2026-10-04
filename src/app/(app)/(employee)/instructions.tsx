import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandSpinner } from '@/components/brand-spinner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/work-ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { readCache, writeCache } from '@/hooks/use-cached';
import { supabase } from '@/lib/supabase';
import { workCopy } from '@/lib/work-copy';

type Note = {
  id: string;
  body: string;
  created_at: string;
  site_name: string;
  author_name: string;
};

const KEY = 'site-notes';

/**
 * What the chef has said about the chantiers this employee is on.
 *
 * The tab was a title and a sentence promising messages that had nowhere to
 * come from. The messages are addressed to the chantier rather than to the
 * man, so this list changes as he is moved from one to another — which is the
 * point: he reads what matters where he is, and does not keep reading
 * instructions for a chantier he left a month ago.
 */
export default function InstructionsScreen() {
  const { t, locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  // Seeded from the cache, so the tab opens on last time's instructions
  // instead of a spinner; they are replaced as soon as the read lands.
  const [notes, setNotes] = useState<Note[] | null>(() => readCache<Note[]>(KEY) ?? null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: failure } = await supabase.rpc('my_site_notes');
    if (failure) { setError(copy.failed); return; }
    const rows = (data ?? []) as Note[];
    writeCache(KEY, rows);
    setNotes(rows);
    setError(null);
  }, [copy.failed]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR',
      { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">{t.instructions.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t.instructions.subtitle}</ThemedText>

          {!notes && !error && <BrandSpinner color={theme.accent} />}
          {error && <ThemedText type="small" themeColor="danger">{error}</ThemedText>}
          {notes && !notes.length && (
            <Card><ThemedText type="small" themeColor="textSecondary">{copy.noteNone}</ThemedText></Card>
          )}

          {notes?.map(note => (
            <Card key={note.id}>
              {/* The chantier first: a man on two of them has to know which
                  one the instruction is about before he reads it. */}
              <ThemedText type="smallBold" themeColor="accentText">{note.site_name}</ThemedText>
              <ThemedText>{note.body}</ThemedText>
              <View style={styles.by}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
                  {when(note.created_at)}
                </ThemedText>
                {!!note.author_name.trim() && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {copy.noteFrom(note.author_name)}
                  </ThemedText>
                )}
              </View>
            </Card>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  by: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
});
