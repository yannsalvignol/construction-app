import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { fr, functionError, supabase } from '../lib/supabase';

export function Account() {
  const { session, profile, signOut } = useAuth();
  const [pw, setPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok?: string; error?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 6) { setPwMsg({ error: 'Au moins 6 caractères.' }); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwMsg(error ? { error: fr(error.message) } : { ok: 'Mot de passe mis à jour.' });
    if (!error) setPw('');
  }
  async function deleteAccount() {
    setDeleting(true); setDelError(null);
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) { setDelError(await functionError(error)); setDeleting(false); return; }
    await supabase.auth.signOut({ scope: 'local' });
  }

  return (
    <>
      <div className="page__head"><div><p className="mono muted">Chef</p><h1>{profile?.first_name} {profile?.last_name}</h1></div></div>
      <div className="grid2" style={{ marginBottom: 20 }}>
        <div className="panel">
          <h2>Compte</h2>
          <p>E-mail : <span className="num">{session?.user.email}</span></p>
          <p>Téléphone : <span className="num">{profile?.phone ?? '—'}</span></p>
          <p className="hint">Le nom, le téléphone et la photo se modifient depuis l’application mobile pour l’instant.</p>
          <div><button className="btn" onClick={signOut}>Se déconnecter</button></div>
        </div>
        <form className="panel" onSubmit={changePassword}>
          <h2>Mot de passe</h2>
          <div className="field"><label>Nouveau mot de passe</label><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          {pwMsg.error && <p className="error">{pwMsg.error}</p>}
          {pwMsg.ok && <p className="ok">{pwMsg.ok}</p>}
          <div><button className="btn" disabled={!pw}>Mettre à jour</button></div>
        </form>
      </div>
      <div className="panel">
        <h2>Supprimer le compte</h2>
        <p className="hint">Vous êtes le seul chef de cette entreprise. Supprimer votre compte supprime l’entreprise : ses chantiers, toutes les déclarations et vérifications de présence, et les comptes de tous les employés. Irréversible.</p>
        {!confirming ? <div><button className="btn btn--danger" onClick={() => setConfirming(true)}>Supprimer mon compte</button></div> : (
          <div className="row">
            <button className="btn btn--danger" onClick={deleteAccount} disabled={deleting}>{deleting ? 'Suppression…' : 'Confirmer la suppression définitive'}</button>
            <button className="btn" onClick={() => setConfirming(false)} disabled={deleting}>Annuler</button>
          </div>
        )}
        {delError && <p className="error">{delError}</p>}
        <p className="hint">Documents : <a href="https://casprod.app/privacy">confidentialité</a> · <a href="https://casprod.app/terms">conditions</a> · <a href="https://casprod.app/support">assistance</a></p>
      </div>
    </>
  );
}
