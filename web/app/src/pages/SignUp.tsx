import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { fr, supabase } from '../lib/supabase';

export function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) { setError('Le mot de passe doit contenir au moins 6 caractères.'); return; }
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas.'); return; }
    setBusy(true); setError(null);
    // Same metadata as the mobile app: the onboarding step reads intended_role.
    const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { intended_role: 'chef' } } });
    if (error) { setError(fr(error.message)); setBusy(false); }
    // On success the auth listener moves to /onboarding.
  }

  return (
    <AuthLayout>
      <form className="auth__card" onSubmit={submit}>
        <div>
          <p className="mono muted">Chef de chantier</p>
          <h1>Créer un compte</h1>
          <p className="hint" style={{ marginTop: 8 }}>Votre entreprise, vos chantiers et vos employés seront rattachés à ce compte.</p>
        </div>
        <div className="field"><label htmlFor="em">E-mail</label><input id="em" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="field"><label htmlFor="pw">Mot de passe</label><input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></div>
        <div className="field"><label htmlFor="cf">Confirmer le mot de passe</label><input id="cf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn--solid" disabled={busy || !email || !password || !confirm}>{busy ? 'Création…' : 'Continuer'}</button>
        <p className="hint">Déjà un compte ? <Link to="/login">Se connecter</Link>.</p>
        <p className="hint">En continuant vous acceptez les <a href="/terms">conditions d’utilisation</a> et la <a href="/privacy">politique de confidentialité</a>.</p>
      </form>
    </AuthLayout>
  );
}
