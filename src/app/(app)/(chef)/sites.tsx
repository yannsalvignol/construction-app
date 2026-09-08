import { useCallback, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Action, Card, Feedback, Field, WorkPage } from '@/components/work-ui';
import { ThemedText } from '@/components/themed-text';
import { PresenceHistory } from '@/components/screens/presence-history';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { supabase } from '@/lib/supabase';
import { workCopy } from '@/lib/work-copy';
import type { Site } from '@/lib/presence';

export default function SitesScreen() {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const [sites, setSites] = useState<Site[]>([]);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const companyId = profile?.company_id;
  const refresh = useCallback(async () => {
    if (!companyId) return;
    const { data, error: failure } = await supabase.from('sites').select('id,name,address,is_active').eq('company_id', companyId).eq('is_active', true).order('name');
    if (failure) setError(workCopy(locale).failed);
    else { setSites(data ?? []); setError(null); }
  }, [companyId, locale]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  async function save() {
    Keyboard.dismiss();
    if (!companyId || !name.trim() || lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const { error: failure } = await supabase.from('sites').insert({ company_id: companyId, name: name.trim(), address: address.trim() || null });
      if (failure) throw failure;
      setName(''); setAddress(''); setAdding(false); await refresh();
    } catch { setError(copy.failed); }
    finally { lock.current = false; setBusy(false); }
  }
  return <WorkPage title={copy.sitesTitle} subtitle={copy.sitesHint}>
    <Feedback message={error} />
    {sites.map(site => <Card key={site.id}><ThemedText style={{ fontSize: 20, fontWeight: '700' }}>{site.name}</ThemedText>{site.address && <ThemedText themeColor="textSecondary">{site.address}</ThemedText>}</Card>)}
    {adding ? <Card>
      <Field accessibilityLabel={copy.siteName} placeholder={copy.siteName} value={name} onChangeText={setName} maxLength={120} />
      <Field accessibilityLabel={copy.siteAddress} placeholder={copy.siteAddress} value={address} onChangeText={setAddress} maxLength={300} />
      <Action label={copy.save} busy={busy} disabled={!name.trim()} onPress={save} />
      <Action secondary label={copy.cancel} disabled={busy} onPress={() => setAdding(false)} />
    </Card> : <Action label={copy.addSite} onPress={() => setAdding(true)} />}
    <PresenceHistory />
  </WorkPage>;
}
