import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fr, functionError, supabase } from '../lib/supabase';

type Employee = {
  id: string; first_name: string; last_name: string; phone: string | null; username: string | null; employee_password: string | null;
  is_active: boolean; notifications_enabled: boolean; location_mode: 'checkpoint' | 'live';
};
type Day = { id: string; work_date: string; site_name: string; started_at: string; planned_end_at: string; ended_at: string | null; declarations: number };

export function EmployeeDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [emp, setEmp] = useState<Employee | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [pwState, setPwState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [pwError, setPwError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('profiles')
      .select('id, first_name, last_name, phone, username, employee_password, is_active, notifications_enabled, location_mode')
      .eq('id', id).single();
    if (error) { setError(fr(error.message)); return; }
    setEmp(data as Employee);
    const { data: rows } = await supabase.from('work_days')
      .select('id, work_date, started_at, planned_end_at, ended_at, sites(name), task_declarations(count)')
      .eq('employee_id', id).order('work_date', { ascending: false }).limit(30);
    setDays(((rows ?? []) as unknown as { id: string; work_date: string; started_at: string; planned_end_at: string; ended_at: string | null; sites: { name: string } | null; task_declarations: { count: number }[] }[])
      .map((r) => ({ id: r.id, work_date: r.work_date, started_at: r.started_at, planned_end_at: r.planned_end_at, ended_at: r.ended_at, site_name: r.sites?.name ?? '—', declarations: r.task_declarations?.[0]?.count ?? 0 })));
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function patch(fields: Partial<Employee>) {
    if (!emp) return;
    const previous = emp;
    setEmp({ ...emp, ...fields });
    const { error } = await supabase.from('profiles').update(fields).eq('id', id);
    if (error) { setEmp(previous); setError(fr(error.message)); }
  }
  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) { setPwError('Au moins 6 caractères.'); return; }
    setPwState('busy'); setPwError(null);
    const { error } = await supabase.functions.invoke('reset-employee-password', { body: { employeeId: id, password: newPassword } });
    if (error) { setPwError(await functionError(error)); setPwState('idle'); return; }
    setPwState('done'); setNewPassword(''); await load();
    setTimeout(() => setPwState('idle'), 2000);
  }
  async function remove() {
    if (!emp || !confirm(`Supprimer définitivement ${emp.first_name} ${emp.last_name} ? Son compte et son accès seront effacés.`)) return;
    setRemoving(true);
    const { error } = await supabase.rpc('remove_employee', { employee: id });
    if (error) { setError(fr(error.message)); setRemoving(false); return; }
    navigate('/employees');
  }

  if (error && !emp) return <p className="error">{error}</p>;
  if (!emp) return <p className="muted">Chargement…</p>;

  const hours = (d: Day) => Math.round(((Date.parse(d.ended_at ?? d.planned_end_at) - Date.parse(d.started_at)) / 36e5) * 10) / 10;

  return (
    <>
      <p className="mono muted" style={{ marginBottom: 10 }}><Link to="/employees">Employés</Link> / {emp.username ?? emp.id.slice(0, 8)}</p>
      <div className="page__head">
        <div><h1>{emp.first_name} {emp.last_name}</h1><p className="muted">{emp.phone ?? 'Pas de téléphone'}</p></div>
        <div className="row">
          <span className={`pill ${emp.is_active ? '' : 'pill--off'}`}>{emp.is_active ? 'Actif' : 'Suspendu'}</span>
        </div>
      </div>
      {error && <p className="error" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="grid2" style={{ marginBottom: 20 }}>
        <div className="panel">
          <h2>Accès</h2>
          <div className="row" style={{ justifyContent: 'space-between' }}><span>Compte actif</span><button className="btn btn--sm" onClick={() => patch({ is_active: !emp.is_active })}>{emp.is_active ? 'Suspendre' : 'Réactiver'}</button></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span>Notifications de présence</span><button className="btn btn--sm" onClick={() => patch({ notifications_enabled: !emp.notifications_enabled })}>{emp.notifications_enabled ? 'Désactiver' : 'Activer'}</button></div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>Position en direct <span className="hint">(démarre seulement avec l’accord de l’employé)</span></span>
            <button className="btn btn--sm" onClick={() => patch({ location_mode: emp.location_mode === 'live' ? 'checkpoint' : 'live' })}>{emp.location_mode === 'live' ? 'Repasser en ponctuel' : 'Activer'}</button>
          </div>
        </div>
        <div className="panel">
          <h2>Connexion mobile</h2>
          <p>Identifiant : <span className="num">{emp.username ?? '—'}</span></p>
          {emp.employee_password && <p>Mot de passe actuel : <span className="num">{emp.employee_password}</span></p>}
          <form onSubmit={resetPassword} className="row">
            <input style={{ flex: 1, minWidth: 160 }} placeholder="Nouveau mot de passe" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <button className="btn btn--sm" disabled={pwState === 'busy' || !newPassword}>{pwState === 'busy' ? '…' : pwState === 'done' ? 'Réinitialisé' : 'Réinitialiser'}</button>
          </form>
          {pwError && <p className="error">{pwError}</p>}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <h2>Journées déclarées</h2>
        {days.length === 0 ? <p className="muted">Aucune journée déclarée.</p> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Chantier</th><th>Durée</th><th>Tâches</th><th>État</th></tr></thead>
            <tbody>{days.map((d) => (
              <tr key={d.id}><td className="num">{d.work_date}</td><td>{d.site_name}</td><td className="num">{hours(d)} h</td><td className="num">{d.declarations}</td><td><span className={`pill ${d.ended_at ? '' : 'pill--on'}`}>{d.ended_at ? 'Terminée' : 'En cours'}</span></td></tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Zone sensible</h2>
        <p className="hint">La suppression n’est possible que si l’employé n’a rien déclaré ; sinon, suspendez le compte.</p>
        <div><button className="btn btn--danger" onClick={remove} disabled={removing}>{removing ? 'Suppression…' : 'Supprimer cet employé'}</button></div>
      </div>
    </>
  );
}
