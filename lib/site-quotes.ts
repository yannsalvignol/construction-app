import { decode } from 'base64-arraybuffer';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';
import type { Locale } from '@/lib/i18n/locale';
import { workCopy } from '@/lib/work-copy';

/**
 * Devis attached to a chantier. This is the document half of the devis →
 * avancement feature (docs/DEVIS_AVANCEMENT.md): a chef photographs or picks
 * the devis and it stays with the chantier. Reading the lots out of it is a
 * later step that will add columns to the same row.
 *
 * Files go to the private site-quotes bucket under <company>/<site>/<uuid>,
 * which is the shape the storage policies match on.
 */

export type SiteQuote = {
  id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  status: 'stored' | 'parsing' | 'parsed' | 'validated' | 'failed';
  total_ht: number | null;
};

/** 20 MB, matching the bucket's own limit — refused here with a real message. */
const MAX_BYTES = 20 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
};

export async function listSiteQuotes(siteId: string): Promise<SiteQuote[]> {
  const { data, error } = await supabase
    .from('site_quotes')
    .select('id, file_path, file_name, mime_type, size_bytes, created_at, status, total_ht')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** A short-lived link, since the bucket is private. */
export async function siteQuoteUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('site-quotes').createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data.signedUrl;
}

/** A file chosen or captured, before it is uploaded. */
export type Picked = { uri: string; name: string; mimeType: string; size: number | null };

/** The devis as a file the chef chose from Files, iCloud or Drive. */
export async function pickQuoteDocument(): Promise<Picked[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'],
    copyToCacheDirectory: true,
    // A devis scanned page by page arrives as several files; picking them one
    // at a time would make each page look like a separate devis.
    multiple: true,
  });
  if (result.canceled || !result.assets?.length) return [];
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType ?? 'application/pdf',
    size: asset.size ?? null,
  }));
}

/** One page of a paper devis. The caller keeps calling this until the chef
 *  says there are no more pages. */
export async function scanQuotePhoto(locale: Locale): Promise<Picked | null> {
  const copy = workCopy(locale);
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error(copy.cameraDenied);
  const photo = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, exif: false });
  if (photo.canceled || !photo.assets?.length) return null;
  const asset = photo.assets[0];
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    uri: asset.uri,
    name: `Devis ${stamp}.jpg`,
    mimeType: asset.mimeType ?? 'image/jpeg',
    size: asset.fileSize ?? null,
  };
}

/**
 * Uploads the pages of one devis and records them as a single quote.
 *
 * The rows are written after the bytes, so a failed transfer never leaves a
 * devis in the list that nobody can open; a failed insert removes what was
 * uploaded rather than orphaning it.
 */
export async function uploadSiteQuote(
  pages: Picked[],
  { siteId, companyId, locale }: { siteId: string; companyId: string; locale: Locale }
): Promise<SiteQuote> {
  const copy = workCopy(locale);
  if (!pages.length) throw new Error(copy.failed);

  const uploaded: { path: string; mimeType: string; bytes: number }[] = [];
  const undo = async () => {
    if (uploaded.length) await supabase.storage.from('site-quotes').remove(uploaded.map((p) => p.path));
  };

  for (const page of pages) {
    const file = new File(page.uri);
    const base64 = await file.base64();
    const bytes = decode(base64);
    if (bytes.byteLength > MAX_BYTES) { await undo(); throw new Error(copy.quoteTooLarge); }

    const extension = EXTENSIONS[page.mimeType] ?? 'pdf';
    const path = `${companyId}/${siteId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from('site-quotes')
      .upload(path, bytes, { contentType: page.mimeType, upsert: false });
    if (uploadError) { await undo(); throw new Error(copy.quoteUploadFailed); }
    uploaded.push({ path, mimeType: page.mimeType, bytes: bytes.byteLength });
  }

  const first = uploaded[0];
  const { data, error } = await supabase
    .from('site_quotes')
    .insert({
      company_id: companyId,
      site_id: siteId,
      uploaded_by: (await supabase.auth.getUser()).data.user?.id,
      file_path: first.path,
      file_name: pages.length > 1 ? `${pages[0].name} (+${pages.length - 1})` : pages[0].name.slice(0, 200),
      mime_type: first.mimeType,
      size_bytes: uploaded.reduce((total, page) => total + page.bytes, 0),
    })
    .select('id, file_path, file_name, mime_type, size_bytes, created_at, status, total_ht')
    .single();

  if (error) { await undo(); throw new Error(copy.quoteUploadFailed); }

  const { error: pageError } = await supabase.from('quote_pages').insert(
    uploaded.map((page, index) => ({
      quote_id: data.id,
      company_id: companyId,
      position: index,
      file_path: page.path,
      mime_type: page.mimeType,
      size_bytes: page.bytes,
    }))
  );
  if (pageError) {
    await supabase.from('site_quotes').delete().eq('id', data.id);
    await undo();
    throw new Error(copy.quoteUploadFailed);
  }

  return data;
}

/**
 * Asks the parser to read a stored devis. Returns as soon as the work has
 * started: reading a hundred lines takes far longer than anyone should watch
 * a spinner, so the screen follows `status` instead of this call.
 */
export async function requestQuoteParse(quoteId: string) {
  const { error } = await supabase.functions.invoke('parse-quote', { body: { quoteId } });
  if (error) console.error('[site-quotes] parse could not be started', error);
}

/** Removes the row and the bytes; a leftover file would never be reachable. */
export async function deleteSiteQuote(quote: SiteQuote) {
  const { data: pages } = await supabase
    .from('quote_pages')
    .select('file_path')
    .eq('quote_id', quote.id);
  // Through the guard rather than straight at the table: a devis with work
  // declared against it cannot go, and the database was refusing it with a
  // constraint violation that the screen turned into "impossible de charger
  // les données". The rule has a reason, and the chef should hear it.
  const { error } = await supabase.rpc('delete_site_quote', { quote: quote.id });
  if (error) throw error;
  const paths = (pages ?? []).map((page) => page.file_path);
  await supabase.storage
    .from('site-quotes')
    .remove(paths.length ? paths : [quote.file_path]);
}
