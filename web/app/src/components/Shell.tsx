import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const links = [
  { to: '/', label: 'Accueil', end: true },
  { to: '/employees', label: 'Employés' },
  { to: '/sites', label: 'Chantiers' },
  { to: '/live', label: 'En direct' },
  { to: '/account', label: 'Compte' },
];

export function Shell() {
  const { profile, signOut } = useAuth();
  return (
    <div className="shell">
      <aside className="side">
        <a className="brand" href="/"><img src="/logo.png" alt="" />CASPROD</a>
        <nav>{links.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>{l.label}</NavLink>)}</nav>
        <div className="side__foot">
          <span className="fg2">{profile?.first_name} {profile?.last_name}</span>
          <span className="mono muted">Chef</span>
          <button className="btn btn--sm" onClick={signOut}>Se déconnecter</button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}
