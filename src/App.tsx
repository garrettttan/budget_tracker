import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { isConfigured, supabase } from './lib/supabase';
import SignIn from './pages/SignIn';
import Transactions from './pages/Transactions';
import Accounts from './pages/Accounts';
import Settings from './pages/Settings';
import NotConfigured from './pages/NotConfigured';

function useUnreviewedCount(enabled: boolean) {
  const [count, setCount] = useState<number | null>(null);
  const location = useLocation();
  const refresh = useCallback(async () => {
    if (!enabled || !supabase) return;
    const { count } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('approved', false);
    setCount(count ?? 0);
  }, [enabled]);
  useEffect(() => {
    refresh();
  }, [refresh, location.pathname]);
  return { count, refresh };
}

const NAV = [
  { to: '/transactions', label: 'Transactions' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/settings', label: 'Settings' },
];

export default function App() {
  const { session, loading } = useAuth();
  const { count: unreviewed, refresh: refreshUnreviewed } = useUnreviewedCount(Boolean(session));

  if (!isConfigured) return <NotConfigured />;
  if (loading) return <div className="boot" aria-busy="true" />;
  if (!session) return <SignIn />;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="wordmark">Ledger</div>
        <ul>
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                <span>{item.label}</span>
                {item.to === '/transactions' && unreviewed !== null && unreviewed > 0 && (
                  <span className="badge" aria-label={`${unreviewed} to review`}>
                    {unreviewed}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="page">
        <Routes>
          <Route path="/transactions" element={<Transactions count={unreviewed} onChange={refreshUnreviewed} />} />
          {/* Review and Transactions were one page each until Nov 2026 */}
          <Route path="/review" element={<Navigate to="/transactions" replace />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/settings" element={<Settings email={session.user.email ?? ''} />} />
          <Route path="*" element={<Navigate to="/transactions" replace />} />
        </Routes>
      </main>
    </div>
  );
}
