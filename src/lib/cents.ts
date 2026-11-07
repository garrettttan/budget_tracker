// Money math in whole cents. Amounts come from the database as numeric
// strings and are added up as floats, so every total is rounded back to cents.
//
// No imports, so Node's test runner can load it (see reimbursementMatch.ts).

/** Rounds to cents: 0.1 + 0.2 → 0.3. */
export const round = (n: number) => Math.round(n * 100) / 100;

/** Adds numbers, rounded to cents. */
export const sum = (ns: number[]) => round(ns.reduce((a, b) => a + b, 0));
