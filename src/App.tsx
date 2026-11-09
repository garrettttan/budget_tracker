// The app shell: the sign-in gate, navigation (a rail on desktop, a menu
// drawer on phones) and the routes. Also keeps the nav's to-review count.
import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { isConfigured, supabase } from './lib/supabase';
import SignIn from './pages/SignIn';
import Spending from './pages/Spending';
import Accounts from './pages/Accounts';
import Owed from './pages/Owed';
import Trends from './pages/Trends';
import Settings from './pages/Settings';
import SettingsSection from './pages/SettingsSection';
import NotConfigured from './pages/NotConfigured';
import Button from './components/Button';
import Modal from './components/Modal';

/** How many posted transactions wait for review; refreshed on every page change and on demand. */
function useUnreviewedCount(enabled: boolean) {
  const [count, setCount] = useState<number | null>(null);
  const location = useLocation();
  const refresh = useCallback(async () => {
    if (!enabled || !supabase) return;
    const { count } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('approved', false)
      .eq('pending', false); // pending rows can't be approved yet, so they aren't counted
    setCount(count ?? 0);
  }, [enabled]);
  useEffect(() => {
    refresh();
  }, [refresh, location.pathname]);
  return { count, refresh };
}

/** Old page URLs (Review, then Transactions) go to Spending, keeping their filters. */
function ToSpending() {
  return <Navigate to={`/spending${useLocation().search}`} replace />;
}

/** The pages, in nav order. */
const NAV: { to: string; label: string }[] = [
  { to: '/spending', label: 'Spending' },
  { to: '/trends', label: 'Trends' },
  { to: '/owed', label: 'Owed to me' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/settings', label: 'Settings' },
];

/** The pages, with the to-review badge on Spending: the desktop rail and the phone drawer. */
function NavList({ unreviewed, onNavigate }: { unreviewed: number | null; onNavigate?: () => void }) {
  return (
    <ul className="nav-list">
      {NAV.map((item) => (
        <li key={item.to}>
          <NavLink to={item.to} className={({ isActive }) => (isActive ? 'active' : undefined)} onClick={onNavigate}>
            <span>{item.label}</span>
            {item.to === '/spending' && unreviewed !== null && unreviewed > 0 && (
              <span className="badge" aria-label={`${unreviewed} to review`}>
                {unreviewed}
              </span>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/** Phones: a top bar with ☰ (the to-review count beside it) that opens the pages in a left drawer. */
function PhoneMenu({ unreviewed }: { unreviewed: number | null }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  // any navigation closes it (links close it too; this covers back/forward)
  useEffect(() => setOpen(false), [pathname]);
  const waiting = unreviewed !== null && unreviewed > 0;
  return (
    <header className="topbar">
      <Button
        variant="icon"
        className="menu-button"
        aria-label={waiting ? `Menu, ${unreviewed} to review` : 'Menu'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg className="icon" viewBox="0 0 20 16" width="20" height="16" aria-hidden="true">
          <path d="M1 2h18M1 8h18M1 14h18" />
        </svg>
      </Button>
      {waiting && (
        <span className="badge" aria-hidden="true">
          {unreviewed}
        </span>
      )}
      <span className="wordmark">Ledger</span>
      {open && (
        <Modal labelledBy="drawer-title" className="drawer" onClose={() => setOpen(false)}>
          {(close) => (
            <>
              <div className="modal-head">
                <h2 id="drawer-title" className="wordmark">
                  Ledger
                </h2>
                <Button variant="icon" aria-label="Close menu" onClick={close}>
                  ×
                </Button>
              </div>
              <nav aria-label="Main">
                <NavList unreviewed={unreviewed} onNavigate={close} />
              </nav>
            </>
          )}
        </Modal>
      )}
    </header>
  );
}

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
        <NavList unreviewed={unreviewed} />
      </nav>
      <PhoneMenu unreviewed={unreviewed} />
      <main className="page">
        <Routes>
          <Route path="/spending" element={<Spending unreviewed={unreviewed} onApprovalsChanged={refreshUnreviewed} />} />
          <Route path="/transactions" element={<ToSpending />} />
          <Route path="/review" element={<ToSpending />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/owed" element={<Owed />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/settings" element={<Settings email={session.user.email ?? ''} onSynced={refreshUnreviewed} />} />
          <Route path="/settings/categories" element={<SettingsSection title="Categories" />} />
          <Route path="/settings/merchants" element={<SettingsSection title="Merchants" />} />
          <Route path="/settings/tags" element={<SettingsSection title="Tags" />} />
          <Route path="*" element={<Navigate to="/spending" replace />} />
        </Routes>
      </main>
    </div>
  );
}
