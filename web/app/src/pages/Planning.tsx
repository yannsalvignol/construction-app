import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { fr, functionError, supabase } from '../lib/supabase';

type Person = { id: string; first_name: string; last_name: string; role: 'chef' | 'employee'; is_active: boolean };
type Site = { id: string; name: string };
type Shift = { id: string; employee_id: string; site_id: string; work_date: string; start_time: string; end_time: string; note: string | null; published_at: string | null };
type Send = { from_date: string; to_date: string; sent_at: string; shifts: number; recipients: number };
type Draft = { id?: string; employee_id: string; site_id: string; work_date: string; start_time: string; end_time: string; note: string; everyone: boolean; wholeWeek: boolean };

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
const hm = (t: string) => t.slice(0, 5);
const hours = (s: Shift) => { const [a, b] = [s.start_time, s.end_time].map((t) => { const [h, m] = t.split(':').map(Number); return h + m / 60; }); return Math.round((b - a) * 10) / 10; };
const longDate = (s: string) => { const d = parse(s); return `${DAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const when = (isoTs: string) => new Date(isoTs).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function Planning() {
  const { profile } = useAuth();
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [people, setPeople] = useState<Person[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [lastSend, setLastSend] = useState<Send | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const to = days[6];
  const today = iso(new Date());

  const load = useCallback(async () => {
    if (!profile) return;
    const [p, s, sh, snd] = await Promise.all([
      supabase.from('profiles').select('id, first_name, last_name, role, is_active').eq('company_id', profile.company_id).is('deleted_at', null).order('role').order('first_name'),
      supabase.from('sites').select('id, name').eq('company_id', profile.company_id).eq('is_active', true).order('name'),
      supabase.from('planned_shifts').select('id, employee_id, site_id, work_date, start_time, end_time, note, published_at').eq('company_id', profile.company_id).gte('work_date', week).lte('work_date', to).order('start_time'),
      supabase.from('planning_sends').select('from_date, to_date, sent_at, shifts, recipients').eq('company_id', profile.company_id).lte('from_date', to).gte('to_date', week).order('sent_at', { ascending: false }).limit(1),
    ]);
    const failure = p.error ?? s.error ?? sh.error ?? snd.error;
    if (failure) { setError(fr(failure.message)); return; }
    setPeople((p.data as Person[]).sort((a, b) => (a.role === 'chef' ? -1 : b.role === 'chef' ? 1 : 0)));
    setSites(s.data as Site[]);
    setShifts(sh.data as Shift[]);
    setLastSend((snd.data as Send[])[0] ?? null);
    setError(null);
  }, [profile, week, to]);
  useEffect(() => { void load(); }, [load]);

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? '—';
  const visible = filter === 'all' ? people : people.filter((p) => p.id === filter);
  const pending = shifts.filter((s) => !s.published_at).length;
  const at = (person: string, day: string) => shifts.filter((s) => s.employee_id === person && s.work_date === day);

  function open(person: string, day: string, shift?: Shift) {
    setDraft(shift
      ? { id: shift.id, employee_id: shift.employee_id, site_id: shift.site_id, work_date: shift.work_date, start_time: hm(shift.start_time), end_time: hm(shift.end_time), note: shift.note ?? '', everyone: false, wholeWeek: false }
      : { employee_id: person, site_id: sites[0]?.id ?? '', work_date: day, start_time: '08:00', end_time: '17:00', note: '', everyone: false, wholeWeek: false });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || !profile) return;
    if (draft.end_time <= draft.start_time) { setError('L’heure de fin doit être après l’heure de début.'); return; }
    setBusy(true); setError(null);
    if (draft.id) {
      const { error } = await supabase.from('planned_shifts').update({ site_id: draft.site_id, work_date: draft.work_date, start_time: draft.start_time, end_time: draft.end_time, note: draft.note.trim() || null }).eq('id', draft.id);
      if (error) setError(fr(error.message));
    } else {
      const targets = draft.everyone ? people.filter((p) => p.is_active).map((p) => p.id) : [draft.employee_id];
      const dates = draft.wholeWeek ? days.filter((d) => { const dow = parse(d).getDay(); return dow >= 1 && dow <= 5; }) : [draft.work_date];
      const rows = targets.flatMap((employee_id) => dates.map((work_date) => ({
        company_id: profile.company_id, employee_id, site_id: draft.site_id, work_date,
        start_time: draft.start_time, end_time: draft.end_time, note: draft.note.trim() || null, created_by: profile.id,
      })));
      const { error } = await supabase.from('planned_shifts').insert(rows);
      if (error) setError(fr(error.message));
    }
    setBusy(false); setDraft(null); await load();
  }
  async function remove(id: string) {
    if (!confirm('Supprimer ce créneau ?')) return;
    const { error } = await supabase.from('planned_shifts').delete().eq('id', id);
    if (error) setError(fr(error.message)); else { setDraft(null); await load(); }
  }
  async function copyPreviousWeek() {
    if (!profile) return;
    const prevFrom = addDays(week, -7), prevTo = addDays(week, -1);
    const { data, error } = await supabase.from('planned_shifts').select('employee_id, site_id, work_date, start_time, end_time, note').eq('company_id', profile.company_id).gte('work_date', prevFrom).lte('work_date', prevTo);
    if (error) { setError(fr(error.message)); return; }
    if (!data?.length) { setError('La semaine précédente est vide.'); return; }
    if (shifts.length && !confirm(`Cette semaine contient déjà ${shifts.length} créneau(x). Ajouter ceux de la semaine précédente en plus ?`)) return;
    const rows = data.map((s) => ({ company_id: profile.company_id, employee_id: s.employee_id, site_id: s.site_id, work_date: addDays(s.work_date, 7), start_time: s.start_time, end_time: s.end_time, note: s.note, created_by: profile.id }));
    const { error: insertError } = await supabase.from('planned_shifts').insert(rows);
    if (insertError) setError(fr(insertError.message)); else await load();
  }
  async function send(from: string, until: string) {
    setSending(from); setSentMsg(null); setError(null);
    const { data, error } = await supabase.functions.invoke('send-planning', { body: { from, to: until } });
    if (error) setError(await functionError(error));
    else setSentMsg(`Envoyé : ${data.shifts} créneau(x) à ${data.recipients} personne(s), ${data.notified} notification(s) délivrée(s) à Expo.`);
    setSending(null); await load();
  }

  return (
    <>
      <div className="page__head">
        <div>
          <p className="mono muted">Semaine du {longDate(week)} au {longDate(to)}</p>
          <h1>Planning</h1>
        </div>
        <div className="row">
          <button className="btn btn--sm" onClick={() => setWeek(addDays(week, -7))}>‹ Précédente</button>
          <button className="btn btn--sm" onClick={() => setWeek(mondayOf(new Date()))}>Aujourd’hui</button>
          <button className="btn btn--sm" onClick={() => setWeek(addDays(week, 7))}>Suivante ›</button>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
        <div className="row">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">Toute l’équipe</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}{p.role === 'chef' ? ' (moi)' : ''}</option>)}
          </select>
          <button className="btn btn--sm" onClick={copyPreviousWeek}>Copier la semaine précédente</button>
        </div>
        <div className="row">
          <span className="mono muted">
            {lastSend ? `Dernier envoi ${when(lastSend.sent_at)} · ${lastSend.recipients} pers.` : 'Jamais envoyé'}
            {pending > 0 && <span style={{ color: 'var(--warn)' }}> · {pending} non envoyé(s)</span>}
          </span>
          <button className="btn btn--solid" onClick={() => send(week, to)} disabled={sending !== null || shifts.length === 0}>{sending === week ? 'Envoi…' : 'Envoyer la semaine'}</button>
        </div>
      </div>
      {sentMsg && <p className="ok" style={{ marginBottom: 12 }}>{sentMsg}</p>}
      {error && <p className="error" style={{ marginBottom: 12 }}>{error}</p>}
      {sites.length === 0 && <div className="empty" style={{ marginBottom: 16 }}>Créez d’abord un chantier : un créneau est toujours rattaché à un chantier.</div>}

      <div className="planning">
        <table className="grid">
          <thead>
            <tr>
              <th className="grid__who"></th>
              {days.map((d) => {
                const dayShifts = shifts.filter((s) => s.work_date === d);
                const dayPending = dayShifts.some((s) => !s.published_at);
                return (
                  <th key={d} className={d === today ? 'is-today' : ''}>
                    <span className="mono">{longDate(d)}</span>
                    {dayShifts.length > 0 && (
                      <button className="grid__send" title={dayPending ? 'Envoyer cette journée' : 'Journée envoyée · renvoyer'} onClick={() => send(d, d)} disabled={sending !== null}>
                        {sending === d ? '…' : dayPending ? '↑ envoyer' : '✓ envoyé'}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id} className={p.is_active ? '' : 'is-off'}>
                <td className="grid__who">
                  <span>{p.first_name} {p.last_name}</span>
                  <span className="mono muted">{p.role === 'chef' ? 'Chef' : p.is_active ? 'Employé' : 'Suspendu'}</span>
                  <span className="mono muted">{shifts.filter((s) => s.employee_id === p.id).reduce((n, s) => n + hours(s), 0)} h</span>
                </td>
                {days.map((d) => (
                  <td key={d} className={d === today ? 'is-today' : ''} onClick={() => sites.length && open(p.id, d)}>
                    {at(p.id, d).map((s) => (
                      <button key={s.id} type="button" className={`chip ${s.published_at ? '' : 'chip--pending'}`} onClick={(e) => { e.stopPropagation(); open(p.id, d, s); }} title={s.note ?? undefined}>
                        <b>{hm(s.start_time)}–{hm(s.end_time)}</b><span>{siteName(s.site_id)}</span>
                      </button>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>Cliquez une case pour ajouter un créneau, un créneau pour le modifier. Les créneaux en pointillé n’ont pas encore été envoyés : les téléphones ne les voient pas.</p>

      {draft && (
        <div className="modal" onClick={() => setDraft(null)}>
          <form className="modal__card" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{draft.id ? 'Modifier le créneau' : 'Nouveau créneau'}</h2>
              <span className="mono muted">{longDate(draft.work_date)}</span>
            </div>
            {!draft.id && (
              <div className="field"><label>Personne</label>
                <select value={draft.employee_id} onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })} disabled={draft.everyone}>
                  {people.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}{p.role === 'chef' ? ' (moi)' : ''}</option>)}
                </select>
              </div>
            )}
            <div className="field"><label>Chantier</label>
              <select value={draft.site_id} onChange={(e) => setDraft({ ...draft, site_id: e.target.value })}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </div>
            <div className="grid2">
              <div className="field"><label>Date</label><input type="date" value={draft.work_date} onChange={(e) => setDraft({ ...draft, work_date: e.target.value })} required /></div>
              <div className="grid2">
                <div className="field"><label>Début</label><input type="time" value={draft.start_time} onChange={(e) => setDraft({ ...draft, start_time: e.target.value })} required /></div>
                <div className="field"><label>Fin</label><input type="time" value={draft.end_time} onChange={(e) => setDraft({ ...draft, end_time: e.target.value })} required /></div>
              </div>
            </div>
            <div className="field"><label>Consigne (facultatif)</label><input maxLength={300} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Ex. : apporter le niveau laser" /></div>
            {!draft.id && (
              <div className="row">
                <label className="check"><input type="checkbox" checked={draft.everyone} onChange={(e) => setDraft({ ...draft, everyone: e.target.checked })} /> Toute l’équipe active</label>
                <label className="check"><input type="checkbox" checked={draft.wholeWeek} onChange={(e) => setDraft({ ...draft, wholeWeek: e.target.checked })} /> Du lundi au vendredi de cette semaine</label>
              </div>
            )}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row">
                <button className="btn btn--solid" disabled={busy || !draft.site_id}>{busy ? 'Enregistrement…' : draft.id ? 'Enregistrer' : 'Ajouter'}</button>
                <button type="button" className="btn" onClick={() => setDraft(null)}>Annuler</button>
              </div>
              {draft.id && <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(draft.id!)}>Supprimer</button>}
            </div>
          </form>
        </div>
      )}
    </>
  );
}
