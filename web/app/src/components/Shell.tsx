import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const links = [
  { to: '/dashboard', label: 'Accueil' },
  { to: '/employees', label: 'Employés' },
  { to: '/sites', label: 'Chantiers' },
  { to: '/planning', label: 'Planning' },
  { to: '/live', label: 'En direct' },
  { to: '/account', label: 'Compte' },
];

export function Shell() {
  const { profile, signOut } = useAuth();
  return (
    <div className="shell">
      <aside className="side">
        <a className="brand" href="/dashboard"><img src="/logo.png" alt="" />CASPROD</a>
        <nav>{links.map((l) => <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>{l.label}</NavLink>)}</nav>
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
