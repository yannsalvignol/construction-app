import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fr, functionError, supabase } from '../lib/supabase';

type Employee = { id: string; first_name: string; last_name: string; phone: string | null; username: string | null; is_active: boolean; location_mode: 'checkpoint' | 'live' };
const USERNAME = /^[a-z0-9_.]{3,20}$/;

export function Employees() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Employee[] | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', username: '', password: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const [emps, co] = await Promise.all([
      supabase.from('profiles').select('id, first_name, last_name, phone, username, is_active, location_mode')
        .eq('company_id', profile.company_id).eq('role', 'employee').is('deleted_at', null).order('first_name'),
      supabase.from('companies').select('join_code').eq('id', profile.company_id).single(),
    ]);
    if (emps.error) setError(fr(emps.error.message)); else setRows(emps.data as Employee[]);
    setJoinCode((co.data as { join_code: string } | null)?.join_code ?? null);
  }, [profile]);
  useEffect(() => { void load(); }, [load]);

  async function copyCode() {
    if (!joinCode) return;
    await navigator.clipboard.writeText(joinCode).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  }
  async function regenerate() {
    if (!confirm('Régénérer le code ? L’ancien cessera de fonctionner immédiatement.')) return;
    const { data, error } = await supabase.rpc('regenerate_company_join_code');
    if (error) setError(fr(error.message)); else setJoinCode(data as string);
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    const username = form.username.trim().toLowerCase();
    if (!USERNAME.test(username)) { setFormError('Identifiant : 3 à 20 caractères, lettres minuscules, chiffres, « _ » ou « . ».'); return; }
    if (form.password.length < 6) { setFormError('Le mot de passe doit contenir au moins 6 caractères.'); return; }
    setBusy(true); setFormError(null);
    const { error } = await supabase.functions.invoke('create-employee', {
      body: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim() || null, username, password: form.password },
    });
    if (error) { setFormError(await functionError(error)); setBusy(false); return; }
    setForm({ firstName: '', lastName: '', phone: '', username: '', password: '' });
    setAdding(false); setBusy(false);
    await load();
  }

  return (
    <>
      <div className="page__head">
        <div><p className="mono muted">{rows ? `${rows.length} employé${rows.length > 1 ? 's' : ''}` : ' '}</p><h1>Employés</h1></div>
        <button className="btn btn--solid" onClick={() => setAdding((v) => !v)}>{adding ? 'Fermer' : 'Ajouter un employé'}</button>
      </div>

      <div className="grid2" style={{ marginBottom: 24 }}>
        <div className="panel">
          <h2>Code d’affiliation</h2>
          <p className="hint">Un employé rejoint l’entreprise depuis l’application avec ce code, sans que vous ayez à créer son compte.</p>
          <p className="code">{joinCode ?? '——————'}</p>
          <div className="row">
            <button className="btn btn--sm" onClick={copyCode} disabled={!joinCode}>{copied ? 'Copié' : 'Copier'}</button>
            <button className="btn btn--sm" onClick={regenerate} disabled={!joinCode}>Régénérer</button>
          </div>
        </div>
        {adding && (
          <form className="panel" onSubmit={add}>
            <h2>Nouvel employé</h2>
            <div className="grid2">
              <div className="field"><label>Prénom</label><input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required /></div>
              <div className="field"><label>Nom</label><input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required /></div>
            </div>
            <div className="field"><label>Téléphone (facultatif)</label><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="grid2">
              <div className="field"><label>Identifiant de connexion</label><input autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></div>
              <div className="field"><label>Mot de passe</label><input type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} /></div>
            </div>
            <p className="hint">Transmettez l’identifiant et le mot de passe à l’employé ; il se connecte dans l’application mobile.</p>
            {formError && <p className="error">{formError}</p>}
            <button className="btn btn--solid" disabled={busy}>{busy ? 'Création…' : 'Créer le compte'}</button>
          </form>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {rows && rows.length === 0 && <div className="empty">Aucun employé pour le moment. Partagez le code d’affiliation ou créez un compte.</div>}
      {rows && rows.length > 0 && (
        <table className="table">
          <thead><tr><th>Nom</th><th>Identifiant</th><th>Téléphone</th><th>Position</th><th>Statut</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/employees/${r.id}`}>{r.first_name} {r.last_name}</Link></td>
              <td className="num">{r.username ?? '—'}</td>
              <td className="num">{r.phone ?? '—'}</td>
              <td><span className={`pill ${r.location_mode === 'live' ? 'pill--on' : ''}`}>{r.location_mode === 'live' ? 'En direct' : 'Ponctuelle'}</span></td>
              <td><span className={`pill ${r.is_active ? '' : 'pill--off'}`}>{r.is_active ? 'Actif' : 'Suspendu'}</span></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}
