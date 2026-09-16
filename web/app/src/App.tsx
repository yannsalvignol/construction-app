import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PhoneOnly } from './components/PhoneOnly';
import { Shell } from './components/Shell';
import { AuthProvider, useAuth } from './lib/auth';
import { Account } from './pages/Account';
import { Dashboard } from './pages/Dashboard';
import { EmployeeDetail } from './pages/EmployeeDetail';
import { Employees } from './pages/Employees';
import { Live } from './pages/Live';
import { Onboarding } from './pages/Onboarding';
import { Planning } from './pages/Planning';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { Sites } from './pages/Sites';

function Router() {
  const { session, profile, loading } = useAuth();
  if (loading) return <div className="loading mono">Chargement…</div>;

  // Signed out: only the auth pages.
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  // Signed in, no profile yet: finish creating the company.
  if (!profile) {
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }
  // Employees have no web workspace.
  if (profile.role !== 'chef') return <PhoneOnly />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/employees/:id" element={<EmployeeDetail />} />
        <Route path="/sites" element={<Sites />} />
        <Route path="/planning" element={<Planning />} />
        <Route path="/live" element={<Live />} />
        <Route path="/account" element={<Account />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Router />
      </AuthProvider>
    </BrowserRouter>
  );
}
