import { useState, type FormEvent } from 'react';
import { db } from '../lib/supabase';

type Mode = 'sign-in' | 'create';

export default function SignIn() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === 'sign-in') {
      const { error } = await db().auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const redirect = window.location.href.split('#')[0];
      const { data, error } = await db().auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirect },
      });
      if (error) setError(error.message);
      else if (!data.session) {
        setNotice(`Check ${email} for a confirmation link, then come back and sign in.`);
        setMode('sign-in');
      }
    }
    setBusy(false);
  }

  return (
    <div className="center-screen">
      <form className="narrow auth" onSubmit={submit}>
        <div className="wordmark large">Ledger</div>
        <h1>{mode === 'sign-in' ? 'Sign in' : 'Create your account'}</h1>
        {mode === 'create' && (
          <p className="muted">
            This app is for one person. After you create your account, turn off sign-ups in
            Supabase so nobody else can.
          </p>
        )}
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === 'sign-in' ? 'create' : 'sign-in');
            setError(null);
          }}
        >
          {mode === 'sign-in' ? 'First time here? Create your account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
