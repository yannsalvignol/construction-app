import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fr, supabase } from '../lib/supabase';

type Dashboard = {
  date: string; employees: number; active_employees: number; confirmed: number; to_review: number;
  declared_hours: number; declarations: number; contributors: number;
  productivity: { code: string; label_fr: string; unit: string; quantity: number; employees: number }[];
  flags: { employee_id: string; employee_name: string; label_fr: string; quantity: number; unit: string; site_name: string }[];
};
const UNIT: Record<string, string> = { unit: 'u', m: 'm', m2: 'm²', m3: 'm³', kg: 'kg' };

export function Dashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('chef_dashboard');
      if (!active) return;
      if (error) setError(fr(error.message)); else setData(data as Dashboard);
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Chargement…</p>;

  return (
    <>
      <div className="page__head">
        <div>
          <p className="mono muted">Aujourd’hui · {data.date}</p>
          <h1>Votre équipe, en un regard.</h1>
        </div>
        <Link className="btn" to="/employees">Employés →</Link>
      </div>
      <div className="stats">
        <div className="stat"><b>{data.employees}</b><span>Employés dans l’entreprise · {data.active_employees} actifs</span></div>
        <div className="stat"><b>{data.confirmed}</b><span>Présences confirmées aujourd’hui</span></div>
        <div className="stat"><b>{data.to_review}</b><span>À vérifier</span></div>
        <div className="stat"><b>{data.declared_hours} h</b><span>Heures déclarées</span></div>
      </div>
      <p className="hint" style={{ marginBottom: 32 }}>Durée des journées déclarées. Une vérification ponctuelle ne mesure pas le temps réellement travaillé.</p>

      <div className="panel" style={{ marginBottom: 20 }}>
        <h2>Productivité du jour</h2>
        {data.productivity.length === 0 ? <p className="muted">Aucune tâche déclarée pour le moment.</p> : (
          <table className="table">
            <thead><tr><th>Tâche</th><th>Quantité</th><th>Employés</th></tr></thead>
            <tbody>{data.productivity.map((p) => (
              <tr key={p.code}><td>{p.label_fr} <span className="muted num">{p.code}</span></td><td className="num">{p.quantity} {UNIT[p.unit] ?? p.unit}</td><td className="num">{p.employees}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {data.flags.length > 0 && (
        <div className="panel">
          <h2>Signal · déclarations identiques trois jours de suite</h2>
          <p className="hint">Un indicateur, pas une accusation : même tâche, même chantier, même quantité sur les trois dernières journées.</p>
          <table className="table">
            <thead><tr><th>Employé</th><th>Tâche</th><th>Quantité</th><th>Chantier</th></tr></thead>
            <tbody>{data.flags.map((f) => (
              <tr key={f.employee_id + f.label_fr}><td><Link to={`/employees/${f.employee_id}`}>{f.employee_name}</Link></td><td>{f.label_fr}</td><td className="num">{f.quantity} {UNIT[f.unit] ?? f.unit}</td><td>{f.site_name}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
