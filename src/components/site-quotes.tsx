import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BrandSpinner } from '@/components/brand-spinner';
import { AppModal, ModalButton } from '@/components/app-modal';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { translateServerError } from '@/lib/i18n/server-errors';
import { useTheme } from '@/hooks/use-theme';
import {
  deleteSiteQuote,
  listSiteQuotes,
  pickQuoteDocument,
  requestQuoteParse,
  scanQuotePhoto,
  siteQuoteUrl,
  uploadSiteQuote,
  type Picked,
  type SiteQuote,
} from '@/lib/site-quotes';
import { workCopy } from '@/lib/work-copy';

/**
 * The devis held against one chantier: photograph it or pick the PDF, open it
 * again later, remove it. Reading the lots and quantities out of the document
 * is the next step (docs/DEVIS_AVANCEMENT.md); keeping the devis where the
 * work is already answers "what did we quote for this?" on site.
 *
 * Employees see the list; only a chef may add or remove, which is what the
 * RLS policies enforce — this only decides what is worth drawing.
 */
/** AppModal slides out over 180 ms; the native modal needs a moment more to
 *  hand the screen back before another controller can be presented over it. */
const SHEET_EXIT_MS = 260;

export function SiteQuotes({ siteId, onChange }: { siteId: string; onChange?: () => void }) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const copy = workCopy(locale);
  const { profile } = useAuth();
  const router = useRouter();
  const isChef = profile?.role === 'chef';

  const [quotes, setQuotes] = useState<SiteQuote[] | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  // Choosing and uploading are different states: the button said "Envoi en
  // cours" while the picker was still open, before there was anything to send.
  const [stage, setStage] = useState<'idle' | 'picking' | 'uploading'>('idle');
  const busy = stage !== 'idle';
  // Pages photographed so far, waiting for the chef to say the devis is
  // complete. A paper devis is rarely one sheet.
  const [pages, setPages] = useState<Picked[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SiteQuote | null>(null);

  const reload = useCallback(async () => {
    try { setQuotes(await listSiteQuotes(siteId)); }
    catch { setError(copy.failed); }
  }, [siteId, copy.failed]);

  // On focus rather than on mount: a devis added from another screen, or on
  // another phone, should be there when the chef comes back to this one.
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  async function add(source: 'camera' | 'file') {
    if (busy || !profile) return;
    setSourceOpen(false);
    setError(null);
    setStage('picking');
    try {
      // The sheet has to finish dismissing first: iOS refuses to present the
      // camera or the file picker while another controller is still animating
      // away, and the call then never settles — which left this button stuck
      // on "Envoi en cours" with no picker ever appearing.
      await new Promise<void>((resolve) => setTimeout(resolve, SHEET_EXIT_MS));

      if (source === 'camera') {
        const page = await scanQuotePhoto(locale);
        if (!page) { setStage('idle'); return; }
        // One page at a time, and the chef decides when the devis is whole.
        setPages((current) => [...current, page]);
        setStage('idle');
        return;
      }

      const picked = await pickQuoteDocument();
      if (picked.length) await send(picked);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.failed);
    } finally {
      setStage((current) => (current === 'picking' ? 'idle' : current));
    }
  }

  /** Uploads a complete devis: one PDF, or every photographed page at once. */
  async function send(all: Picked[]) {
    if (!profile || !all.length) return;
    setStage('uploading');
    try {
      const stored = await uploadSiteQuote(all, { siteId, companyId: profile.company_id, locale });
      await requestQuoteParse(stored.id);
      setPages([]);
      await reload();
      onChange?.();
      router.push(`/quote/${stored.id}`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? translateServerError(failure.message, locale)
          : copy.failed
      );
    } finally {
      setStage('idle');
    }
  }

  async function open(quote: SiteQuote) {
    const url = await siteQuoteUrl(quote.file_path);
    if (!url) { setError(copy.failed); return; }
    await WebBrowser.openBrowserAsync(url);
  }

  async function remove(quote: SiteQuote) {
    setPendingDelete(null);
    setStage('uploading');
    try { await deleteSiteQuote(quote); await reload(); onChange?.(); }
    catch (failure) {
      // What the server refused and why, not "impossible de charger les
      // données": a devis is refused for one reason, and it is a reason the
      // chef can act on.
      const message = failure && typeof failure === 'object' && 'message' in failure
        ? String((failure as { message: unknown }).message)
        : '';
      setError(message ? translateServerError(message, locale) : copy.failed);
    }
    finally { setStage('idle'); }
  }

  return (
    <View style={styles.wrap}>
      {quotes?.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">{t.siteDetail.quoteEmpty}</ThemedText>
      )}

      {quotes?.map((quote) => (
        <View key={quote.id} style={styles.row}>
          <Ionicons
            name={quote.mime_type === 'application/pdf' ? 'document-text-outline' : 'image-outline'}
            size={22}
            color={theme.accentText}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/quote/${quote.id}`)}
            onLongPress={() => { void open(quote); }}
            style={({ pressed }) => [styles.rowLabel, pressed && styles.pressed]}>
            <ThemedText type="small" numberOfLines={1}>{quote.file_name}</ThemedText>
            <ThemedText type="small" themeColor={quote.status === 'validated' ? 'success' : 'textSecondary'}>
              {t.quoteStatus[quote.status]}
              {' · '}
              {t.siteDetail.quoteAddedOn(new Date(quote.created_at).toLocaleDateString(locale))}
            </ThemedText>
          </Pressable>
          {isChef && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.siteDetail.quoteDelete}
              hitSlop={10}
              onPress={() => setPendingDelete(quote)}
              style={({ pressed }) => pressed && styles.pressed}>
              <Ionicons name="trash-outline" size={20} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>
      ))}

      {pages.length > 0 && (
        <View style={[styles.pending, { borderColor: theme.accent }]}>
          <ThemedText type="smallBold">{t.siteDetail.quotePages(pages.length)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t.siteDetail.quotePagesHint}</ThemedText>
          <View style={styles.pendingRow}>
            <Pressable
              disabled={busy}
              onPress={() => { void add('camera'); }}
              style={({ pressed }) => [
                styles.pendingButton,
                { borderColor: theme.accent },
                (pressed || busy) && styles.pressed,
              ]}>
              <Ionicons name="camera-outline" size={18} color={theme.accentText} />
              <ThemedText type="smallBold" themeColor="accentText">{t.siteDetail.quoteAddPage}</ThemedText>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => { void send(pages); }}
              style={({ pressed }) => [
                styles.pendingButton,
                { backgroundColor: theme.accent, borderColor: theme.accent },
                (pressed || busy) && styles.pressed,
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                {stage === 'uploading' ? t.siteDetail.quoteUploading : t.siteDetail.quoteFinish}
              </ThemedText>
            </Pressable>
          </View>
          <Pressable onPress={() => setPages([])} disabled={busy}>
            <ThemedText type="small" themeColor="textSecondary">{t.common.cancel}</ThemedText>
          </Pressable>
        </View>
      )}

      {isChef && pages.length === 0 && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => setSourceOpen(true)}
          style={({ pressed }) => [
            styles.add,
            { borderColor: theme.accent },
            (pressed || busy) && styles.pressed,
          ]}>
          {stage === 'uploading'
            ? <BrandSpinner color={theme.accentText} />
            : <Ionicons name="add" size={20} color={theme.accentText} />}
          <ThemedText type="smallBold" themeColor="accentText">
            {stage === 'uploading' ? t.siteDetail.quoteUploading : t.siteDetail.quoteAdd}
          </ThemedText>
        </Pressable>
      )}

      {error && <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>}

      <AppModal
        visible={sourceOpen}
        onClose={() => setSourceOpen(false)}
        title={t.siteDetail.quoteSourceTitle}
        icon="document-attach-outline"
        actions={
          <>
            <ModalButton label={t.siteDetail.quoteScan} onPress={() => { void add('camera'); }} />
            <ModalButton secondary label={t.siteDetail.quotePick} onPress={() => { void add('file'); }} />
          </>
        }>
        <ThemedText type="small" themeColor="textSecondary">{t.siteDetail.quoteSourceBody}</ThemedText>
      </AppModal>

      <AppModal
        visible={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title={t.siteDetail.quoteDeleteTitle}
        icon="trash-outline"
        actions={
          <>
            <ModalButton
              label={t.siteDetail.quoteDelete}
              onPress={() => { if (pendingDelete) void remove(pendingDelete); }}
            />
            <ModalButton secondary label={t.common.cancel} onPress={() => setPendingDelete(null)} />
          </>
        }>
        <ThemedText type="small" themeColor="textSecondary">{t.siteDetail.quoteDeleteBody}</ThemedText>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.three,
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  rowLabel: {
    flex: 1,
    gap: 2,
  },
  pending: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'flex-start',
  },
  pendingRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignSelf: 'stretch',
  },
  pendingButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 52,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  pressed: {
    opacity: 0.6,
  },
});
