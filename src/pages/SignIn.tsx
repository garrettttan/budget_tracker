import { useState, type FormEvent } from 'react';
import { db } from '../lib/supabase';
import Button from '../components/Button';
import { strings } from '../lib/strings';

const t = strings.signIn;

type Mode = 'sign-in' | 'create';

/**
 * Email + password sign-in. "Create your account" is for the first run only;
 * after that, sign-ups are turned off in Supabase.
 */
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
        setNotice(t.checkEmail(email));
        setMode('sign-in');
      }
    }
    setBusy(false);
  }

  return (
    <div className="center-screen">
      <form className="narrow auth" onSubmit={submit}>
        <div className="wordmark large">{strings.app.name}</div>
        <h1>{mode === 'sign-in' ? t.title : t.createTitle}</h1>
        {mode === 'create' && <p className="muted">{t.createNote}</p>}
        <label>
          {t.email}
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t.password}
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
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t.working : mode === 'sign-in' ? t.signIn : t.createAccount}
        </Button>
        <Button
          variant="link"
          onClick={() => {
            setMode(mode === 'sign-in' ? 'create' : 'sign-in');
            setError(null);
          }}
        >
          {mode === 'sign-in' ? t.toCreate : t.toSignIn}
        </Button>
      </form>
    </div>
  );
}
