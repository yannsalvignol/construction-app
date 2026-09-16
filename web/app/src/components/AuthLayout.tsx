import type { ReactNode } from 'react';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth__aside">
        <a className="brand" href="https://casprod.app"><img src="/logo.png" alt="" />CASPROD</a>
        <div style={{ display: 'grid', gap: 18 }}>
          <p className="mono muted">Espace chef · Web</p>
          <h2>Voir le chantier tel qu’il est.</h2>
          <p className="fg2" style={{ maxWidth: '44ch' }}>Chantiers, employés, journées déclarées et présences confirmées, depuis un navigateur. Les employés restent sur l’application mobile.</p>
        </div>
        <p className="mono muted">© 2026 CASPROD</p>
      </aside>
      <main className="auth__main">{children}</main>
    </div>
  );
}
