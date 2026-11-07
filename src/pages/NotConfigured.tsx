/** Shown instead of the app when the build has no Supabase settings. */
export default function NotConfigured() {
  return (
    <div className="center-screen">
      <div className="narrow">
        <h1>Ledger isn't connected to a database yet</h1>
        <p className="muted">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in a{' '}
          <code>.env.local</code> file for local development, or as repository variables for the
          GitHub Pages build. The README has the steps.
        </p>
      </div>
    </div>
  );
}
