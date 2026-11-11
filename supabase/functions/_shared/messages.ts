// Every message the edge functions send back to a person, in one place. The web
// app shows them in its error and result lines (Settings → Bank connection, the
// sync log, Accounts). The browser's own text is in src/lib/strings.ts.
//
// No imports, so simplefin.ts can use this under Node's test runner too.

export const messages = {
  // http: what a request did wrong
  usePost: 'Use POST.',
  unauthorized: 'unauthorized',
  signInAgain: 'Sign in again and retry.',

  // connecting (simplefin-claim)
  pasteSetupToken: 'Paste your SimpleFIN Setup Token.',
  notASetupToken: "That doesn't look like a SimpleFIN Setup Token.",
  setupTokenNotHttps: 'The Setup Token must point to an https address.',
  setupTokenUsed:
    'SimpleFIN says this Setup Token was already used or does not exist. If you did not use it ' +
    'yourself, someone else may have: disable it in SimpleFIN Bridge and create a new one.',
  claimFailed: (status: number) => `SimpleFIN could not claim the token (HTTP ${status}).`,
  simplefinUnreachable: 'Could not reach SimpleFIN. Try again.',
  saveAccessFailed: 'Connected, but saving the access failed. Try a new Setup Token.',

  // syncing (sync-now, sync, run-sync)
  loadConnectionFailed: 'Could not load your bank connection.',
  noConnection: 'No bank connection. Connect SimpleFIN first.',
  noAccessSaved: 'No SimpleFIN access saved. Connect in Settings.',
  accessUrlMalformed: 'The SimpleFIN Access URL is malformed.',
  accessRejected: 'SimpleFIN rejected the saved access. Reconnect in Settings with a new Setup Token.',
  requestFailed: (status: number) => `SimpleFIN request failed (HTTP ${status}).`,
  invalidAmount: (id: string) => `Transaction ${id} has an invalid amount.`,

  // why a sync was skipped (shown as "Sync skipped: …")
  skipTooManyRequests: (max: number) => `would exceed ${max} SimpleFIN requests in 24 h`,
  skipAfterRateLimit: 'skipping a day after a SimpleFIN rate-limit warning',
};
