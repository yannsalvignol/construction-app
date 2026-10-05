import { useCallback, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';
import { Action, Card, Feedback, Field, WorkPage } from '@/components/work-ui';
import { ThemedText } from '@/components/themed-text';
import { PresenceHistory } from '@/components/screens/presence-history';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { supabase } from '@/lib/supabase';
import { invalidate, useCached } from '@/hooks/use-cached';
import { loadSites, sitesKey } from '@/lib/tab-data';
import { SitePicker } from '@/components/site-picker';
import { SiteNotesCard } from '@/components/site-notes-card';
import { SiteRow } from '@/components/site-row';
import { workCopy } from '@/lib/work-copy';

export default function SitesScreen() {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const [name, setName] = useState('');
  const [located, setLocated] = useState<{ latitude: number; longitude: number; address: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const companyId = profile?.company_id;
  // Served from the cache the home screen warmed, then revalidated on focus,
  // so arriving here shows the chantiers rather than an empty page.
  const loader = useCallback(() => loadSites(companyId ?? ''), [companyId]);
  const cached = useCached(sitesKey(companyId ?? ''), loader);
  const refresh = cached.refresh;
  const sites = cached.data ?? [];
  const loadError = cached.error ? workCopy(locale).failed : null;
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
      setName(''); setLocated(null); setAdding(false);
      invalidate(sitesKey(companyId)); await refresh();
    } catch { setError(copy.failed); }
    finally { lock.current = false; setBusy(false); }
  }
  return <WorkPage title={copy.sitesTitle}>
    <Feedback message={error ?? loadError} />
    {/* The message card stands against each chantier and owns the row, so the
        note is written where the chantier is read. */}
    {sites.map(site => <SiteNotesCard key={site.id} siteId={site.id}>
      <SiteRow site={site} onRemoved={refresh} />
    </SiteNotesCard>)}
    {!!sites.length && <ThemedText type="small" themeColor="textSecondary">{copy.removeSiteHint}</ThemedText>}
    {adding ? <Card>
      {/* Labelled rather than placeheld: a placeholder is gone the moment you
          type, and these two fields sat next to each other looking the same —
          one naming the chantier, the other finding it on a map. The name is
          the bigger of the two because it is the one being invented; the
          address is being looked up. */}
      <View style={{ gap: 8 }}>
        <ThemedText type="smallBold">{copy.siteName}</ThemedText>
        <Field
          accessibilityLabel={copy.siteName}
          placeholder={copy.siteNameExample}
          value={name}
          onChangeText={setName}
          style={{ minHeight: 60, fontSize: 19 }}
          maxLength={120} />
      </View>
      <SitePicker onChange={setLocated} />
      <Action label={copy.save} busy={busy} disabled={!name.trim() || !located} onPress={save} />
      <Action secondary label={copy.cancel} disabled={busy} onPress={() => { setLocated(null); setAdding(false); }} />
    </Card> : <Action label={copy.addSite} onPress={() => setAdding(true)} />}
    <PresenceHistory />
  </WorkPage>;
}
