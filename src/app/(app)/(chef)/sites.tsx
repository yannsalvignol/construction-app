import { useCallback, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Action, Card, Feedback, Field, WorkPage } from '@/components/work-ui';
import { PresenceHistory } from '@/components/screens/presence-history';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { supabase } from '@/lib/supabase';
import { SitePicker } from '@/components/site-picker';
import { SiteRow } from '@/components/site-row';
import { workCopy } from '@/lib/work-copy';
import type { Site } from '@/lib/presence';

export default function SitesScreen() {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const [sites, setSites] = useState<Site[]>([]);
  const [name, setName] = useState('');
  const [located, setLocated] = useState<{ latitude: number; longitude: number; address: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const companyId = profile?.company_id;
  const refresh = useCallback(async () => {
    if (!companyId) return;
    const { data, error: failure } = await supabase.from('sites')
      .select('id,name,address,is_active,latitude,longitude')
      .eq('company_id', companyId).eq('is_active', true).order('name');
    if (failure) setError(workCopy(locale).failed);
    else { setSites(data ?? []); setError(null); }
  }, [companyId, locale]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  async function save() {
    Keyboard.dismiss();
    if (!companyId || !name.trim() || lock.current) return;
    if (!located) { setError(copy.addressNeeded); return; }
    lock.current = true; setBusy(true); setError(null);
    try {
      const { error: failure } = await supabase.from('sites').insert({
        company_id: companyId, name: name.trim(), address: located.address,
        latitude: located.latitude, longitude: located.longitude,
      });
      if (failure) throw failure;
      setName(''); setLocated(null); setAdding(false); await refresh();
    } catch { setError(copy.failed); }
    finally { lock.current = false; setBusy(false); }
  }
  return <WorkPage title={copy.sitesTitle} subtitle={copy.sitesHint}>
    <Feedback message={error} />
    {sites.map(site => <SiteRow key={site.id} site={site} />)}
    {adding ? <Card>
      <Field accessibilityLabel={copy.siteName} placeholder={copy.siteName} value={name} onChangeText={setName} maxLength={120} />
      <SitePicker onChange={setLocated} />
      <Action label={copy.save} busy={busy} disabled={!name.trim() || !located} onPress={save} />
      <Action secondary label={copy.cancel} disabled={busy} onPress={() => { setLocated(null); setAdding(false); }} />
    </Card> : <Action label={copy.addSite} onPress={() => setAdding(true)} />}
    <PresenceHistory />
  </WorkPage>;
}
