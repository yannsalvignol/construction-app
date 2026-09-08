import { useCallback, useState } from 'react';
import { Modal } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { Action, Card, Feedback, WorkPage } from '@/components/work-ui';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { supabase } from '@/lib/supabase';
import { workCopy } from '@/lib/work-copy';
import type { CheckIn } from '@/lib/presence';

type Row = CheckIn & { site: { name: string }; employee: { first_name: string; last_name: string } };
export function PresenceHistory() {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<{ row: Row; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const userId = profile?.id;
  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data, error: failure } = await supabase.from('presence_check_ins').select('*, site:sites(name), employee:profiles(first_name,last_name)').order('submitted_at', { ascending: false }).limit(30);
    setLoading(false);
    if (failure) setError(workCopy(locale).failed);
    else { setRows((data ?? []) as unknown as Row[]); setError(null); }
  }, [userId, locale]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  async function view(row: Row) {
    setBusy(row.id); setError(null);
    try {
      const { data, error: failure } = await supabase.storage.from('presence-proofs').createSignedUrl(row.photo_path, 60);
      if (failure) throw failure;
      setProof({ row, url: data.signedUrl });
    } catch { setError(copy.failed); }
    finally { setBusy(null); }
  }
  return <>
    <ThemedText style={{ fontSize: 24, fontWeight: '700' }}>{copy.history}</ThemedText>
    <ThemedText themeColor="textSecondary">{copy.historyHint}</ThemedText>
    <Feedback message={error} />
    {error && <Action secondary label={copy.retry} onPress={() => { void refresh(); }} />}
    {loading ? <ThemedText>{copy.loading}</ThemedText> : !rows.length && !error && <ThemedText themeColor="textSecondary">{copy.noChecks}</ThemedText>}
    {rows.map(row => <Card key={row.id}>
      <ThemedText type="smallBold">{row.employee.first_name} {row.employee.last_name} · {row.site.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{new Date(row.submitted_at).toLocaleString(locale)}</ThemedText>
      <Action secondary label={copy.viewProof} busy={busy === row.id} onPress={() => { void view(row); }} />
    </Card>)}
    <Modal visible={!!proof} onRequestClose={() => setProof(null)} presentationStyle="pageSheet" animationType="slide">
      <WorkPage title={copy.presence}>
        <Action secondary label={copy.close} onPress={() => setProof(null)} />
        {proof && <>
          <Image source={{ uri: proof.url }} style={{ width: '100%', height: 360, borderRadius: 20 }} contentFit="contain" cachePolicy="none" />
          <ThemedText>{proof.row.site.name}</ThemedText>
          <ThemedText>{new Date(proof.row.submitted_at).toLocaleString(locale)}</ThemedText>
          <ThemedText themeColor="textSecondary">{proof.row.latitude.toFixed(5)}, {proof.row.longitude.toFixed(5)} · {copy.accuracy} ±{Math.round(proof.row.accuracy_meters)} m</ThemedText>
        </>}
      </WorkPage>
    </Modal>
  </>;
}
