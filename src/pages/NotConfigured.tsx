import { strings } from '../lib/strings';

const t = strings.notConfigured;

/** Shown instead of the app when the build has no Supabase settings. */
export default function NotConfigured() {
  return (
    <div className="center-screen">
      <div className="narrow">
        <h1>{t.title}</h1>
        <p className="muted">
          {t.set} <code>VITE_SUPABASE_URL</code> {t.and} <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> {t.inA}{' '}
          <code>.env.local</code> {t.rest}
        </p>
      </div>
    </div>
  );
}
