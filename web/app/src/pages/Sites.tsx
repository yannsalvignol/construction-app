import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { fr, supabase } from '../lib/supabase';

type Site = { id: string; name: string; address: string | null; latitude: number | null; longitude: number | null; is_active: boolean };
type Located = { address: string; latitude: number; longitude: number };
type Team = { employee_id: string; employee_name: string; is_active: boolean; last_day: string | null; days: number; present_today: boolean; on_site: boolean | null };

/** OpenStreetMap Nominatim: free, no key; fine for a chef adding a few sites. */
async function geocode(query: string): Promise<Located[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Géocodage indisponible');
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((r) => ({ address: r.display_name, latitude: Number(r.lat), longitude: Number(r.lon) }));
}

export function Sites() {
  const { profile } = useAuth();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Located[]>([]);
  const [located, setLocated] = useState<Located | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [team, setTeam] = useState<Record<string, Team[]>>({});

  const load = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await supabase.from('sites').select('id, name, address, latitude, longitude, is_active')
      .eq('company_id', profile.company_id).order('is_active', { ascending: false }).order('name');
    if (error) setError(fr(error.message)); else setSites(data as Site[]);
  }, [profile]);
  useEffect(() => { void load(); }, [load]);

  async function search(e: FormEvent) {
    e.preventDefault();
    setFormError(null); setLocated(null);
    try { setCandidates(await geocode(query)); } catch (err) { setFormError((err as Error).message); }
  }
  async function save() {
    if (!profile || !name.trim() || !located) return;
    setBusy(true); setFormError(null);
    const { error } = await supabase.from('sites').insert({ company_id: profile.company_id, name: name.trim(), address: located.address, latitude: located.latitude, longitude: located.longitude });
    if (error) { setFormError(fr(error.message)); setBusy(false); return; }
    setName(''); setQuery(''); setCandidates([]); setLocated(null); setAdding(false); setBusy(false);
    await load();
  }
  async function archive(site: Site) {
    if (!confirm(`Retirer « ${site.name} » ? Un chantier où du travail a été déclaré est archivé, sinon supprimé.`)) return;
    const { error } = await supabase.rpc('remove_site', { site: site.id });
    if (error) setError(fr(error.message)); else await load();
  }
  async function toggleTeam(site: Site) {
    if (open === site.id) { setOpen(null); return; }
    setOpen(site.id);
    if (!team[site.id]) {
      const { data, error } = await supabase.rpc('site_team', { site: site.id });
      if (!error) setTeam((t) => ({ ...t, [site.id]: (data as Team[]) ?? [] }));
    }
  }

  return (
    <>
      <div className="page__head">
        <div><p className="mono muted">{sites ? `${sites.filter((s) => s.is_active).length} actifs` : ' '}</p><h1>Chantiers</h1></div>
        <button className="btn btn--solid" onClick={() => setAdding((v) => !v)}>{adding ? 'Fermer' : 'Nouveau chantier'}</button>
      </div>

      {adding && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <h2>Nouveau chantier</h2>
          <div className="field"><label>Nom</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Résidence Les Oliviers" /></div>
          <form onSubmit={search} className="field">
            <label>Adresse</label>
            <div className="row"><input style={{ flex: 1 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Boulevard Zerktouni, Casablanca" /><button className="btn" disabled={!query.trim()}>Localiser</button></div>
          </form>
          {candidates.length > 0 && !located && (
            <div style={{ display: 'grid', gap: 6 }}>
              {candidates.map((c) => <button key={c.address} type="button" className="btn" style={{ justifyContent: 'flex-start', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font)', fontSize: 14 }} onClick={() => setLocated(c)}>{c.address}</button>)}
            </div>
          )}
          {located && <p className="ok">{located.address} · <span className="num">{located.latitude.toFixed(5)}, {located.longitude.toFixed(5)}</span></p>}
          {formError && <p className="error">{formError}</p>}
          <div className="row"><button className="btn btn--solid" onClick={save} disabled={busy || !name.trim() || !located}>{busy ? 'Enregistrement…' : 'Créer le chantier'}</button><span className="hint">Géocodage OpenStreetMap ; vérifiez l’adresse proposée avant d’enregistrer.</span></div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {sites && sites.length === 0 && <div className="empty">Aucun chantier. Créez le premier pour que l’équipe puisse déclarer ses journées.</div>}
      {sites && sites.map((s) => (
        <div key={s.id} className="panel" style={{ marginBottom: 12, opacity: s.is_active ? 1 : 0.55 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h2>{s.name} {!s.is_active && <span className="pill">Archivé</span>}</h2>
              <p className="muted">{s.address ?? 'Adresse non renseignée'}</p>
            </div>
            <div className="row">
              <button className="btn btn--sm" onClick={() => toggleTeam(s)}>{open === s.id ? 'Masquer l’équipe' : 'Équipe'}</button>
              {s.is_active && <button className="btn btn--sm btn--danger" onClick={() => archive(s)}>Retirer</button>}
            </div>
          </div>
          {open === s.id && (
            !team[s.id] ? <p className="muted">Chargement…</p> : team[s.id].length === 0 ? <p className="muted">Personne n’a encore déclaré de journée ici.</p> : (
              <table className="table">
                <thead><tr><th>Employé</th><th>Journées</th><th>Dernière</th><th>Aujourd’hui</th></tr></thead>
                <tbody>{team[s.id].map((m) => (
                  <tr key={m.employee_id}><td>{m.employee_name}</td><td className="num">{m.days}</td><td className="num">{m.last_day ?? '—'}</td>
                    <td>{m.present_today ? <span className={`pill ${m.on_site === false ? 'pill--off' : 'pill--on'}`}>{m.on_site === false ? 'Hors site' : 'Journée ouverte'}</span> : <span className="pill">—</span>}</td></tr>
                ))}</tbody>
              </table>
            )
          )}
        </div>
      ))}
    </>
  );
}
