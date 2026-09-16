import { useState, type FormEvent } from 'react';
import { AuthLayout } from '../components/AuthLayout';
import { useAuth } from '../lib/auth';
import { fr, supabase } from '../lib/supabase';

/** Second step of chef sign-up: the account exists, the company does not yet. */
export function Onboarding() {
  const { session, refreshProfile, signOut } = useAuth();
  const [companyName, setCompanyName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmployeeAccount = session?.user.user_metadata?.intended_role === 'employee';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.rpc('create_company_and_chef_profile', {
      company_name: companyName.trim(), chef_first_name: firstName.trim(), chef_last_name: lastName.trim(), chef_phone: phone.trim() || null,
    });
    if (error) { setError(fr(error.message)); setBusy(false); return; }
    await refreshProfile();
  }

  if (isEmployeeAccount) {
    return (
      <AuthLayout>
        <div className="auth__card">
          <h1>Terminez sur votre téléphone</h1>
          <p className="fg2">Ce compte a été créé avec un code d’affiliation employé. L’inscription se termine dans l’application CASPROD sur iPhone ou Android.</p>
          <button className="btn" onClick={signOut}>Se déconnecter</button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="auth__card" onSubmit={submit}>
        <div>
          <p className="mono muted">Étape 2 / 2</p>
          <h1>Votre entreprise</h1>
        </div>
        <div className="field"><label htmlFor="co">Nom de l’entreprise</label><input id="co" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="fn">Prénom</label><input id="fn" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required /></div>
          <div className="field"><label htmlFor="ln">Nom</label><input id="ln" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} required /></div>
        </div>
        <div className="field"><label htmlFor="ph">Téléphone (facultatif)</label><input id="ph" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn--solid" disabled={busy || !companyName || !firstName || !lastName}>{busy ? 'Création…' : 'Créer l’entreprise'}</button>
        <button type="button" className="btn" onClick={signOut}>Annuler et se déconnecter</button>
      </form>
    </AuthLayout>
  );
}
