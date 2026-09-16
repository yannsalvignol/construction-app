import { useEffect, useState } from 'react';
import { fr, supabase } from '../lib/supabase';

type Position = { employee_id: string; employee_name: string; latitude: number; longitude: number; accuracy_meters: number; recorded_at: string; site_name: string | null };

/** Live positions as a table with map links; a full map is a later step. */
export function Live() {
  const [rows, setRows] = useState<Position[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('live_team');
      if (!active) return;
      if (error) setError(fr(error.message)); else setRows((data as Position[]) ?? []);
    };
    void load();
    const timer = setInterval(() => { void load(); setTick((t) => t + 1); }, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'à l’instant' : `il y a ${m} min`; };

  return (
    <>
      <div className="page__head">
        <div><p className="mono muted">Actualisé toutes les 30 s · {tick}</p><h1>En direct</h1></div>
      </div>
      <p className="hint" style={{ marginBottom: 24 }}>Seuls les employés dont le partage est activé et accepté, avec une journée ouverte, apparaissent ici. Une position disparaît après 15 minutes sans mise à jour.</p>
      {error && <p className="error">{error}</p>}
      {rows && rows.length === 0 && <div className="empty">Personne ne partage sa position actuellement.</div>}
      {rows && rows.length > 0 && (
        <table className="table">
          <thead><tr><th>Employé</th><th>Chantier</th><th>Position</th><th>Précision</th><th>Reçue</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.employee_id}>
              <td>{r.employee_name}</td><td>{r.site_name ?? '—'}</td>
              <td className="num"><a href={`https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=17/${r.latitude}/${r.longitude}`} target="_blank" rel="noreferrer">{r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}</a></td>
              <td className="num">± {Math.round(r.accuracy_meters)} m</td><td className="num">{ago(r.recorded_at)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}
