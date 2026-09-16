import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { fr, supabase, toAuthEmail } from '../lib/supabase';

export function SignIn() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: toAuthEmail(identifier), password: password.trim() });
    if (error) setError(fr(error.message));
    setBusy(false);
  }

  return (
    <AuthLayout>
      <form className="auth__card" onSubmit={submit}>
        <div>
          <p className="mono muted">Espace chef</p>
          <h1>Connexion</h1>
        </div>
        <div className="field">
          <label htmlFor="id">E-mail</label>
          <input id="id" autoComplete="username" autoCapitalize="none" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="pw">Mot de passe</label>
          <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn--solid" disabled={busy || !identifier || !password}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        <p className="hint">Vous êtes chef de chantier ? <Link to="/signup">Créez votre entreprise</Link>.</p>
        <p className="hint">Employé ? L’application CASPROD sur votre téléphone est votre espace : journées, tâches et vérifications s’y font. Cet espace web est réservé aux chefs.</p>
      </form>
    </AuthLayout>
  );
}
