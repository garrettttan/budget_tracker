// Usage: npm run test:db
// Runs every migration (in filename order) against an in-memory Postgres with
// stubbed Supabase auth and Vault schemas, then checks RLS isolation, starter
// categories, the reporting views, and the Vault helpers.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const db = new PGlite();
const dir = process.argv[2];
const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const stub = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
-- Mirror the live project's defaults for objects created by migrations:
-- no read/write on tables and no function execute for any API role, so
-- every grant the app or edge functions rely on must be explicit
alter default privileges in schema public grant truncate, references, trigger on tables to anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public;
-- Vault stand-in with the same function signatures (no encryption)
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
  returns uuid language sql as $$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
  returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
`;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

await db.exec(stub);
const legacy = '33333333-3333-3333-3333-333333333333';
let legacyUncatTxn, legacyMerchant;
for (const file of migrations) {
  if (file.endsWith('_uncategorized_is_no_category.sql')) {
    // an approved row in the old Uncategorized category, remembered by its merchant
    legacyMerchant = (await db.query(`insert into public.merchants (user_id, name, last_category_id)
      select '${legacy}', 'Mystery', id from public.categories where user_id = '${legacy}' and name = 'Uncategorized' returning id`)).rows[0].id;
    legacyUncatTxn = (await db.query(`insert into public.transactions (user_id, account_id, source, posted_date, amount, category_id, merchant_id, approved)
      select '${legacy}', a.id, 'manual', '2026-10-01', -9, c.id, $1, true
      from public.accounts a, public.categories c
      where a.user_id = '${legacy}' and a.name = 'Old card' and c.user_id = '${legacy}' and c.name = 'Uncategorized' returning id`, [legacyMerchant])).rows[0].id;
  }
  if (file.includes('account_classes')) {
    // rows written with the old accounts.type column, to check the backfill
    await db.exec(`insert into auth.users (id) values ('${legacy}');
      insert into public.accounts (user_id, name, type) values ('${legacy}', 'Old card', 'credit'), ('${legacy}', 'Old Venmo', 'manual');`);
  }
  await db.exec(readFileSync(join(dir, file), 'utf8'));
}
check(`migrations apply (${migrations.length})`, true);
const backfilled = Object.fromEntries((await db.query(`select name, class from public.accounts where user_id = $1`, [legacy])).rows.map((r) => [r.name, r.class]));
check('account classes backfilled from type (credit → liability, manual → cash)', backfilled['Old card'] === 'liability' && backfilled['Old Venmo'] === 'cash', JSON.stringify(backfilled));
await db.exec(readFileSync(join(dir, migrations.find((f) => f.includes('account_classes'))), 'utf8'));
check('account classes migration is safe to re-run', true);
let badClass = false;
try { await db.exec(`insert into public.accounts (user_id, name, class) values ('${legacy}', 'X', 'other')`); badClass = true; } catch {}
check('account class must be cash, investment or liability', !badClass);

const a = '11111111-1111-1111-1111-111111111111';
const b = '22222222-2222-2222-2222-222222222222';
await db.exec(`insert into auth.users (id, email) values ('${a}','a@x.com'), ('${b}','b@x.com');`);

const cats = await db.query(`select count(*)::int n from public.categories where user_id = $1`, [a]);
check('starter categories seeded on sign-up (no Uncategorized: that is no category)', cats.rows[0].n === 14, `${cats.rows[0].n} categories`);
const legacyTxn = (await db.query(`select category_id, approved from public.transactions where id = $1`, [legacyUncatTxn])).rows[0];
check('Uncategorized rows become no category, approval kept', legacyTxn.category_id === null && legacyTxn.approved, JSON.stringify(legacyTxn));
check('merchants forget Uncategorized',
  (await db.query(`select last_category_id from public.merchants where id = $1`, [legacyMerchant])).rows[0].last_category_id === null);
check('the Uncategorized category is gone',
  (await db.query(`select count(*)::int n from public.categories where name = 'Uncategorized'`)).rows[0].n === 0);
await db.exec(readFileSync(join(dir, migrations.find((f) => f.endsWith('_uncategorized_is_no_category.sql'))), 'utf8'));
check('uncategorized-is-no-category migration is safe to re-run', true);
const gas = await db.query(`select count(*)::int n from public.categories where name ilike 'gas%'`);
check('no Gas category', gas.rows[0].n === 0);

// Act as user A through RLS
const asUser = async (uid, sql, params) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role;`); }
};

// User A sets up data
const acct = (await asUser(a, `insert into public.accounts (name, class) values ('Rewards Card','liability') returning id`)).rows[0].id;
const venmo = (await asUser(a, `insert into public.accounts (name) values ('Venmo') returning id`)).rows[0].id;
const dining = (await asUser(a, `select id from public.categories where name='Dining'`)).rows[0].id;
const income = (await asUser(a, `select id from public.categories where name='Income'`)).rows[0].id;

const dinner = (await asUser(a,
  `insert into public.transactions (account_id, source, external_id, posted_date, amount, description, category_id)
   values ($1,'simplefin','TX1','2026-10-10',-120,'CARBONE NYC',$2) returning id`, [acct, dining])).rows[0].id;
await asUser(a, `insert into public.transactions (account_id, source, posted_date, amount, description, category_id)
   values ($1,'manual','2026-10-15',3000,'Paycheck',$2)`, [acct, income]);
const pay = (await asUser(a,
  `insert into public.transactions (account_id, source, posted_date, amount, description)
   values ($1,'manual','2026-10-12',40,'Sam paid you')  returning id`, [venmo])).rows[0].id;
const reimb = (await asUser(a,
  `insert into public.reimbursements (transaction_id, who, amount) values ($1,'Sam',40) returning id`, [dinner])).rows[0].id;
await asUser(a, `insert into public.reimbursement_payments (reimbursement_id, payment_transaction_id, amount) values ($1,$2,40)`, [reimb, pay]);
// transfer: card payment, excluded
await asUser(a, `insert into public.transactions (account_id, source, posted_date, amount, description, is_transfer)
   values ($1,'manual','2026-10-20',500,'Payment thank you', true)`, [acct]);
// pending, excluded
await asUser(a, `insert into public.transactions (account_id, source, external_id, posted_date, amount, description, pending, category_id)
   values ($1,'simplefin','TX2','2026-10-29',-15,'JOES COFFEE', true, $2)`, [acct, dining]);

// Duplicate external id rejected
let dupRejected = false;
try { await asUser(a, `insert into public.transactions (account_id, source, external_id, posted_date, amount) values ($1,'simplefin','TX1','2026-10-10',-120)`, [acct]); }
catch { dupRejected = true; }
check('duplicate SimpleFIN transaction rejected', dupRejected);
let upsertOk = false;
try {
  await asUser(a, `insert into public.transactions (account_id, source, external_id, posted_date, amount) values ($1,'simplefin','TX1','2026-10-10',-120)
    on conflict (account_id, source, external_id) do nothing`, [acct]);
  upsertOk = true;
} catch {}
check('upsert on (account_id, source, external_id) skips duplicates', upsertOk);

// Totals count only approved rows: unreviewed spending is left out until approved
const unreviewed = await asUser(a, `insert into public.transactions (account_id, source, posted_date, amount, category_id)
   values ($1,'manual','2026-10-11',-70,$2) returning id`, [acct, dining]);
check('unapproved spending is left out of totals',
  (await asUser(a, `select count(*)::int n from public.spending_lines where transaction_id = $1`, [unreviewed.rows[0].id])).rows[0].n === 0);
await asUser(a, `delete from public.transactions where id = $1`, [unreviewed.rows[0].id]);
await asUser(a, `update public.transactions set approved = true where not pending`);

// Views
const spend = (await asUser(a, `select category_name, spent::float from public.monthly_category_spend()`)).rows;
check('dining counts only your share ($80)', spend.length === 1 && spend[0].category_name === 'Dining' && spend[0].spent === 80, JSON.stringify(spend));
const cf = (await asUser(a, `select income::float, spending::float from public.monthly_cashflow()`)).rows;
check('cashflow: income 3000, spending 80 (Venmo payback not income)', cf.length === 1 && cf[0].income === 3000 && cf[0].spending === 80, JSON.stringify(cf));

// Payback tagged Income in Review still isn't income once linked
await asUser(a, `update public.transactions set category_id=$1 where id=$2`, [income, pay]);
const cfTagged = (await asUser(a, `select income::float from public.monthly_cashflow()`)).rows;
check('linked payback tagged Income is not income', cfTagged[0]?.income === 3000, JSON.stringify(cfTagged));

// Write-off of an item never paid: full amount counts again (partly paid: phase 4 checks)
await asUser(a, `delete from public.reimbursement_payments where reimbursement_id=$1`, [reimb]);
await asUser(a, `update public.reimbursements set status='written_off' where id=$1`, [reimb]);
const spend2 = (await asUser(a, `select spent::float from public.monthly_category_spend() where category_name='Dining'`)).rows;
check('written-off reimbursement (never paid) counts full $120', spend2[0]?.spent === 120, JSON.stringify(spend2));

// Tags: tagged spending is left out of normal spending unless toggled on
const travel = (await asUser(a, `select id from public.categories where name='Travel'`)).rows[0].id;
const japan = (await asUser(a, `insert into public.tags (name) values ('Japan 2026') returning id`)).rows[0].id;
const work = (await asUser(a, `insert into public.tags (name) values ('Work') returning id`)).rows[0].id;
const sushi = (await asUser(a, `insert into public.transactions (account_id, source, posted_date, amount, category_id, approved) values ($1,'manual','2026-10-05',-200,$2,true) returning id`, [acct, dining])).rows[0].id;
const flight = (await asUser(a, `insert into public.transactions (account_id, source, posted_date, amount, category_id, approved) values ($1,'manual','2026-10-01',-900,$2,true) returning id`, [acct, travel])).rows[0].id;
await asUser(a, `insert into public.transaction_tags (transaction_id, tag_id) values ($1,$3), ($2,$3), ($2,$4)`, [sushi, flight, japan, work]);
const spendFor = async (tags) => Object.fromEntries((await asUser(a,
  `select category_name, spent::float from public.monthly_category_spend($1::uuid[])`, [tags])).rows.map(r => [r.category_name, r.spent]));
const normal = await spendFor([]);
check('normal spending leaves out tagged transactions', normal.Dining === 120 && normal.Travel === undefined, JSON.stringify(normal));
const withJapan = await spendFor([japan]);
check('toggling a tag on adds its transactions', withJapan.Dining === 320 && withJapan.Travel === 900, JSON.stringify(withJapan));
const withWork = await spendFor([work]);
check('a transaction with several tags shows if any is on', withWork.Travel === 900 && withWork.Dining === 120, JSON.stringify(withWork));
const cfNormal = (await asUser(a, `select spending::float from public.monthly_cashflow()`)).rows;
check('cashflow uses the same tag rule', cfNormal[0]?.spending === 120, JSON.stringify(cfNormal));
const trip = (await asUser(a, `select spent::float, transaction_count::int n from public.tag_spend where tag_id=$1`, [japan])).rows[0];
check('tag_spend totals a trip', trip.spent === 1100 && trip.n === 2, JSON.stringify(trip));
// Money in: a refund lowers its category; an uncategorized deposit isn't spending
const aShopping = (await asUser(a, `select id from public.categories where name='Shopping'`)).rows[0].id;
const ins = async (amount, category) => (await asUser(a, `insert into public.transactions (account_id, source, posted_date, amount, category_id, approved)
   values ($1,'manual','2026-09-10',$2,$3,true) returning id`, [acct, amount, category])).rows[0].id;
const septIds = [await ins(-100, aShopping), await ins(30, aShopping), await ins(2500, null)];
const sept = Object.fromEntries((await asUser(a, `select coalesce(category_name, 'none') k, spent::float from public.monthly_category_spend() where month = '2026-09-01'`)).rows.map((r) => [r.k, r.spent]));
check('a refund lowers its category; an uncategorized deposit counts nowhere', sept.Shopping === 70 && sept.none === undefined, JSON.stringify(sept));
const septFlow = (await asUser(a, `select income::float, spending::float from public.monthly_cashflow() where month = '2026-09-01'`)).rows[0];
check('an uncategorized deposit is neither income nor negative spending', septFlow.income === 0 && septFlow.spending === 70, JSON.stringify(septFlow));
await asUser(a, `delete from public.transactions where id = any ($1)`, [septIds]);

let anonRpc = false;
try { await db.exec(`set role anon;`); await db.query(`select * from public.monthly_category_spend()`); anonRpc = true; } catch {} finally { await db.exec(`reset role;`); }
check('signed-out visitors cannot call reporting functions', !anonRpc);

// Merchants: two descriptions, merged into one merchant
const shopping = (await asUser(a, `select id from public.categories where name='Shopping'`)).rows[0].id;
const m2 = (await asUser(a, `insert into public.merchants (name, last_category_id) values ('Amzn Mktp Us',$1) returning id`, [shopping])).rows[0].id;
const m3 = (await asUser(a, `insert into public.merchants (name) values ('Amazon.com') returning id`)).rows[0].id;
await asUser(a, `insert into public.merchant_aliases (merchant_id, match_key) values ($1,'amzn mktp us'), ($2,'amazon.com')`, [m2, m3]);
await asUser(a, `insert into public.transactions (account_id, source, posted_date, amount, merchant_id) values ($1,'manual','2026-10-20',-30,$2)`, [acct, m3]);
let aliasDupRejected = false;
try { await asUser(a, `insert into public.merchant_aliases (merchant_id, match_key) values ($1,'amazon.com')`, [m2]); } catch { aliasDupRejected = true; }
check('a description maps to only one merchant', aliasDupRejected);
await asUser(a, `update public.merchant_aliases set merchant_id=$1 where merchant_id=$2`, [m2, m3]);
await asUser(a, `update public.transactions set merchant_id=$1 where merchant_id=$2`, [m2, m3]);
await asUser(a, `delete from public.merchants where id=$1`, [m3]);
await asUser(a, `update public.merchants set name='Amazon' where id=$1`, [m2]);
const hit = (await asUser(a,
  `select m.name, c.name as category from public.merchant_aliases ma
   join public.merchants m on m.id = ma.merchant_id left join public.categories c on c.id = m.last_category_id
   where ma.match_key = 'amazon.com'`)).rows;
check('after merge, old description pre-fills Amazon / Shopping', hit.length === 1 && hit[0].name === 'Amazon' && hit[0].category === 'Shopping', JSON.stringify(hit));
const amazonTx = (await asUser(a, `select count(*)::int n from public.transactions where merchant_id=$1`, [m2])).rows[0].n;
check('merged transactions regroup under Amazon', amazonTx === 1);

// RLS isolation
const bTx = (await asUser(b, `select count(*)::int n from public.transactions`)).rows[0].n;
const bCats = (await asUser(b, `select count(*)::int n from public.categories`)).rows[0].n;
check('user B sees none of A\'s transactions', bTx === 0);
const bAliases = (await asUser(b, `select count(*)::int n from public.merchant_aliases`)).rows[0].n;
check('user B sees none of A\'s merchant aliases', bAliases === 0);
check('user B sees only own categories', bCats === 14);
let crossWrite = false;
try { await asUser(b, `insert into public.transactions (user_id, account_id, source, posted_date, amount) values ($1,$2,'manual','2026-10-01',-1)`, [a, acct]); crossWrite = true; } catch {}
check('user B cannot write rows as user A', !crossWrite);
const anonRows = await (async () => {
  await db.exec(`set role anon;`);
  try { return (await db.query(`select count(*)::int n from public.transactions`)).rows[0].n; }
  catch { return 'denied'; } finally { await db.exec(`reset role;`); }
})();
check('signed-out visitors see nothing', anonRows === 0 || anonRows === 'denied', String(anonRows));

// connections: read-only from browser, vault id hidden
await db.exec(`insert into public.connections (user_id, vault_secret_id) values ('${a}', gen_random_uuid())`);
let connWrite = false;
try { await asUser(a, `insert into public.connections (label) values ('x')`); connWrite = true; } catch {}
check('browser cannot create connections', !connWrite);
let vaultHidden = false;
try { await asUser(a, `select vault_secret_id from public.connections`); } catch { vaultHidden = true; }
check('vault_secret_id hidden from browser', vaultHidden);
const connStatus = (await asUser(a, `select status from public.connections`)).rows;
check('browser can read connection status', connStatus.length === 1);

let seedCallable = false;
try { await asUser(b, `select public.seed_starter_categories($1)`, [a]); seedCallable = true; } catch {}
check('browser cannot call seed function for another user', !seedCallable);

// Vault helpers: service role only; reconnecting replaces the same secret
const asService = async (sql, params) => {
  await db.exec(`set role service_role;`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role;`); }
};
const url1 = 'https://user:pass1@bridge.example/simplefin';
const conn1 = (await asService(`select public.save_simplefin_access_url($1, $2) as id`, [b, url1])).rows[0].id;
const read1 = (await asService(`select public.get_simplefin_access_url($1) as url`, [conn1])).rows[0].url;
check('service role saves and reads the Access URL', read1 === url1);
const conn2 = (await asService(`select public.save_simplefin_access_url($1, $2) as id`, [b, 'https://user:pass2@bridge.example/simplefin'])).rows[0].id;
const secrets = (await db.query(`select count(*)::int n from vault.secrets`)).rows[0].n;
const read2 = (await asService(`select public.get_simplefin_access_url($1) as url`, [conn2])).rows[0].url;
check('reconnecting reuses the connection and secret', conn2 === conn1 && secrets === 1 && read2.endsWith('pass2@bridge.example/simplefin'));
// The sync edge function writes with the service role
let serviceWrites = true;
const serviceDetail = [];
for (const [table, sql, params] of [
  ['accounts', `insert into public.accounts (user_id, connection_id, external_id, name) values ($1, $2, 'ACT-1', 'Checking') returning id`, [b, conn1]],
  ['sync_runs', `insert into public.sync_runs (user_id, connection_id) values ($1, $2) returning id`, [b, conn1]],
  ['merchants', `insert into public.merchants (user_id, name) values ($1, 'Joes Coffee') returning id`, [b]],
  ['connections', `update public.connections set last_synced_at = now() where id = $1 returning id`, [conn1]],
]) {
  try { await asService(sql, params); } catch (e) { serviceWrites = false; serviceDetail.push(`${table}: ${e.message}`); }
}
try {
  const acctB = (await asService(`select id from public.accounts where external_id = 'ACT-1'`)).rows[0].id;
  await asService(`insert into public.transactions (user_id, account_id, source, external_id, posted_date, amount)
    values ($1, $2, 'simplefin', 'T-1', '2026-11-01', -4.5) on conflict (account_id, source, external_id) do nothing`, [b, acctB]);
  await asService(`insert into public.balance_snapshots (account_id, date, user_id, balance) values ($1, '2026-11-01', $2, 100)
    on conflict (account_id, date) do update set balance = excluded.balance`, [acctB, b]);
  await asService(`delete from public.transactions where external_id = 'T-1'`);
} catch (e) { serviceWrites = false; serviceDetail.push(e.message); }
check('service role can write everything the sync touches', serviceWrites, serviceDetail.join('; '));

let browserReadsUrl = false;
try { await asUser(b, `select public.get_simplefin_access_url($1)`, [conn1]); browserReadsUrl = true; } catch {}
check('browser cannot read the Access URL', !browserReadsUrl);
let browserSavesUrl = false;
try { await asUser(b, `select public.save_simplefin_access_url($1, 'https://x')`, [b]); browserSavesUrl = true; } catch {}
check('browser cannot save an Access URL', !browserSavesUrl);

// ---------------------------------------------------------------------------
// Phase 3: approving, merchant memory, transfers, merging merchants
// (a fresh user with made-up data)
// ---------------------------------------------------------------------------
const d = '44444444-4444-4444-4444-444444444444';
await db.exec(`insert into auth.users (id) values ('${d}')`);
const one = async (sql, params) => (await asUser(d, sql, params)).rows[0];
const catId = async (name) => (await one(`select id from public.categories where name = $1`, [name])).id;
const [dDining, dGroceries] = [await catId('Dining'), await catId('Groceries')];
const checking = (await one(`insert into public.accounts (name) values ('Checking') returning id`)).id;
const card = (await one(`insert into public.accounts (name, class) values ('Card', 'liability') returning id`)).id;
const merchant = async (name) => (await one(`insert into public.merchants (name) values ($1) returning id`, [name])).id;
const coffee = await merchant('Coffee Shop');
const txn = async (fields) => {
  const f = { account_id: card, source: 'manual', posted_date: '2026-10-01', amount: -5, ...fields };
  const cols = Object.keys(f);
  return (await one(
    `insert into public.transactions (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(f),
  )).id;
};
const row = (id) => one(`select approved, category_id, is_transfer, transfer_pair_id, merchant_id from public.transactions where id = $1`, [id]);

// approve_transactions
const c1 = await txn({ merchant_id: coffee, category_id: dDining, posted_date: '2026-10-02' });
const c2 = await txn({ merchant_id: coffee, posted_date: '2026-10-03' }); // uncategorized, unreviewed
const c3 = await txn({ merchant_id: coffee, category_id: dGroceries, posted_date: '2026-10-04' }); // already has a different category
const noCat = await txn({});
const pend = await txn({ category_id: dDining, pending: true });
const approvedCount = (await one(`select public.approve_transactions($1) as n`, [[c1, noCat, pend]])).n;
check('approve: rows with or without a category (Uncategorized), never pending', approvedCount === 2 && (await row(c1)).approved && (await row(noCat)).approved && (await row(noCat)).category_id === null && !(await row(pend)).approved);
check('approve: the merchant remembers the category', (await one(`select last_category_id from public.merchants where id = $1`, [coffee])).last_category_id === dDining);
const c2Row = await row(c2);
check('approve: other unreviewed rows from that merchant are pre-filled, still unapproved', c2Row.category_id === dDining && !c2Row.approved);
check('approve: a row that already has a category keeps it', (await row(c3)).category_id === dGroceries);
const bApproves = (await asUser(b, `select public.approve_transactions($1) as n`, [[c2]])).rows[0].n;
check("approve: another user can't approve your rows", bApproves === 0 && !(await row(c2)).approved);
await one(`select public.approve_transactions($1)`, [[c2, c3]]);
check('approve: the latest approved date wins merchant memory', (await one(`select last_category_id from public.merchants where id = $1`, [coffee])).last_category_id === dGroceries);

// transfers
const payOut = await txn({ account_id: checking, amount: -500, posted_date: '2026-10-10' });
const payIn = await txn({ account_id: card, amount: 500, posted_date: '2026-10-12' });
const farIn = await txn({ account_id: card, amount: 500, posted_date: '2026-10-20' }); // 10 days later
const sameAcct = await txn({ account_id: checking, amount: 500, posted_date: '2026-10-11' });
const suggested = (await asUser(d, `select out_id, in_id from public.transfer_suggestions`)).rows;
check('suggestions: opposite amounts, different accounts, within 5 days',
  suggested.length === 1 && suggested[0].out_id === payOut && suggested[0].in_id === payIn, JSON.stringify(suggested.length));
check("suggestions: other users don't see yours", (await asUser(b, `select count(*)::int n from public.transfer_suggestions`)).rows[0].n === 0);
let badPair = false;
try { await one(`select public.confirm_transfer($1, $2)`, [payOut, sameAcct]); badPair = true; } catch {}
check('confirm_transfer: both sides must be in different accounts', !badPair);
try { await one(`select public.confirm_transfer($1, $2)`, [payOut, c1]); badPair = true; } catch {}
check('confirm_transfer: amounts must be opposite', !badPair);
await one(`select public.confirm_transfer($1, $2)`, [payOut, payIn]);
const [o, i] = [await row(payOut), await row(payIn)];
check('confirm_transfer: both flagged, paired to each other, and approved',
  o.is_transfer && i.is_transfer && o.transfer_pair_id === payIn && i.transfer_pair_id === payOut && o.approved && i.approved);
check('suggestions: a confirmed pair disappears', (await asUser(d, `select count(*)::int n from public.transfer_suggestions`)).rows[0].n === 0);
await one(`select public.mark_transfer($1)`, [farIn]);
const f = await row(farIn);
check('mark_transfer: one-sided transfer is flagged and approved without a category', f.is_transfer && f.approved && f.category_id === null);
let pendTransfer = false;
try { await one(`select public.mark_transfer($1)`, [pend]); pendTransfer = true; } catch {}
check('mark_transfer: pending rows wait', !pendTransfer);
const spendNow = (await asUser(d, `select count(*)::int n from public.spending_lines where transaction_id in ($1, $2, $3)`, [payOut, payIn, farIn])).rows[0].n;
check('transfers stay out of spending', spendNow === 0);

// "Not a transfer": dismissing a suggestion
const dOut = await txn({ account_id: checking, amount: -75, posted_date: '2026-10-14' });
const dIn = await txn({ account_id: card, amount: 75, posted_date: '2026-10-15' });
const pairShown = async (who) =>
  (await asUser(who, `select count(*)::int n from public.transfer_suggestions where out_id = $1 and in_id = $2`, [dOut, dIn])).rows[0].n === 1;
check('dismiss: the pair is suggested at first', await pairShown(d));
let foreignDismiss = false;
try { await asUser(b, `insert into public.dismissed_transfer_pairs (out_id, in_id) values ($1, $2)`, [dOut, dIn]); foreignDismiss = true; } catch {}
check("dismiss: nobody else can dismiss your pairs", !foreignDismiss && (await pairShown(d)));
await one(`insert into public.dismissed_transfer_pairs (out_id, in_id) values ($1, $2) returning out_id`, [dOut, dIn]);
check('dismiss: your dismissal hides it', !(await pairShown(d)));
const [dOutRow, dInRow] = [await row(dOut), await row(dIn)];
check('dismiss: both transactions stay unreviewed and unflagged',
  !dOutRow.approved && !dInRow.approved && !dOutRow.is_transfer && !dInRow.is_transfer);
await one(`delete from public.transactions where id = $1 returning id`, [dIn]);
check('dismiss: removed along with its transaction',
  (await asUser(d, `select count(*)::int n from public.dismissed_transfer_pairs where out_id = $1`, [dOut])).rows[0].n === 0);

// merge_merchants
const cafe = await merchant('Coffee Shop Downtown');
await one(`insert into public.merchant_aliases (merchant_id, match_key) values ($1, 'coffee shop downtown')`, [cafe]);
const cafeTxn = await txn({ merchant_id: cafe });
const fresh = await merchant('New Place');
await one(`select public.merge_merchants($1, $2)`, [cafe, coffee]);
const alias = await one(`select merchant_id from public.merchant_aliases where match_key = 'coffee shop downtown'`);
check('merge: descriptions and transactions move to the kept merchant',
  alias.merchant_id === coffee && (await row(cafeTxn)).merchant_id === coffee && !(await one(`select 1 as x from public.merchants where id = $1`, [cafe])));
await one(`select public.merge_merchants($1, $2)`, [coffee, fresh]);
check('merge: the kept merchant inherits a remembered category if it has none',
  (await one(`select last_category_id from public.merchants where id = $1`, [fresh])).last_category_id === dGroceries);
let selfMerge = false;
try { await one(`select public.merge_merchants($1, $1)`, [fresh]); selfMerge = true; } catch {}
check("merge: can't merge a merchant into itself", !selfMerge);
let crossMerge = false;
try { await asUser(b, `select public.merge_merchants($1, $2)`, [fresh, fresh]); crossMerge = true; } catch {}
const bMerchant = (await asUser(b, `insert into public.merchants (name) values ('Mine') returning id`)).rows[0].id;
try { await asUser(b, `select public.merge_merchants($1, $2)`, [bMerchant, fresh]); crossMerge = true; } catch {}
check("merge: can't touch another user's merchants", !crossMerge);

// editing approved rows: recategorize, send back to Review
const dTransit = await catId('Transit');
const bakery = await merchant('Bakery');
const b1 = await txn({ merchant_id: bakery, category_id: dDining, posted_date: '2026-10-05' });
const b2 = await txn({ merchant_id: bakery, posted_date: '2026-10-06' }); // unreviewed, no category yet
await one(`select public.approve_transactions($1)`, [[b1]]);
await one(`update public.transactions set category_id = null where id = $1 returning id`, [b2]);
const changed = (await one(`select public.recategorize_transactions($1, $2) as n`, [[b1], dGroceries])).n;
const b1Row = await row(b1);
check('recategorize: an approved row gets the new category and stays approved', changed === 1 && b1Row.category_id === dGroceries && b1Row.approved);
await one(`select public.recategorize_transactions($1, null)`, [[b1]]);
check('recategorize to Uncategorized: no category, still approved, merchant memory kept',
  (await row(b1)).category_id === null && (await row(b1)).approved &&
  (await one(`select last_category_id from public.merchants where id = $1`, [bakery])).last_category_id === dGroceries);
await one(`select public.recategorize_transactions($1, $2)`, [[b1], dGroceries]);
check('recategorize: the merchant remembers the new category, and pre-fills unreviewed rows',
  (await one(`select last_category_id from public.merchants where id = $1`, [bakery])).last_category_id === dGroceries
  && (await row(b2)).category_id === dGroceries);
check('recategorize: unreviewed rows are left alone', (await one(`select public.recategorize_transactions($1, $2) as n`, [[b2], dTransit])).n === 0);
let foreignCat = false;
const bCat = (await asUser(b, `select id from public.categories limit 1`)).rows[0].id;
try { await one(`select public.recategorize_transactions($1, $2)`, [[b1], bCat]); foreignCat = true; } catch {}
check("recategorize: can't use another user's category", !foreignCat);
check("recategorize: another user can't change your rows",
  (await asUser(b, `select public.recategorize_transactions($1, $2) as n`, [[b1], bCat])).rows[0].n === 0 && (await row(b1)).category_id === dGroceries);

const tOut = await txn({ account_id: checking, amount: -40, posted_date: '2026-10-16' });
const tIn = await txn({ account_id: card, amount: 40, posted_date: '2026-10-16' });
await one(`select public.confirm_transfer($1, $2)`, [tOut, tIn]);
await one(`select public.recategorize_transactions($1, $2)`, [[tOut], dTransit]);
const [tOutRow, tInRow] = [await row(tOut), await row(tIn)];
check('recategorize: a transfer becomes spending; its other side goes back to Review',
  !tOutRow.is_transfer && tOutRow.transfer_pair_id === null && tOutRow.category_id === dTransit && tOutRow.approved
  && !tInRow.is_transfer && tInRow.transfer_pair_id === null && !tInRow.approved);

check('send_to_review: unapproved, keeping the category as a pre-fill',
  (await one(`select public.send_to_review($1) as n`, [[b1]])).n === 1 && !(await row(b1)).approved && (await row(b1)).category_id === dGroceries);
const sOut = await txn({ account_id: checking, amount: -60, posted_date: '2026-10-18' });
const sIn = await txn({ account_id: card, amount: 60, posted_date: '2026-10-18' });
await one(`select public.confirm_transfer($1, $2)`, [sOut, sIn]);
const moved = (await one(`select public.send_to_review($1) as n`, [[sIn]])).n;
const [sOutRow, sInRow] = [await row(sOut), await row(sIn)];
check('send_to_review: a transfer loses its flag, and both sides go back',
  moved === 1 && !sOutRow.approved && !sInRow.approved && !sOutRow.is_transfer && !sInRow.is_transfer && sOutRow.transfer_pair_id === null);
check('send_to_review: the pair is suggested again', (await asUser(d,
  `select count(*)::int n from public.transfer_suggestions where out_id = $1 and in_id = $2`, [sOut, sIn])).rows[0].n === 1);
await one(`select public.approve_transactions($1)`, [[b1]]);
check("send_to_review: another user can't send your rows back",
  (await asUser(b, `select public.send_to_review($1) as n`, [[b1]])).rows[0].n === 0 && (await row(b1)).approved);

let anonRpc3 = false;
try { await db.exec(`set role anon;`); await db.query(`select public.approve_transactions('{}')`); anonRpc3 = true; } catch {} finally { await db.exec(`reset role;`); }
check('signed-out visitors cannot call the review functions', !anonRpc3);
let anonRpc4 = false;
try { await db.exec(`set role anon;`); await db.query(`select public.send_to_review('{}')`); anonRpc4 = true; } catch {} finally { await db.exec(`reset role;`); }
check('signed-out visitors cannot send rows back to Review', !anonRpc4);

// ---- Phase 3 wrap-up: manual accounts, Add transaction, bulk tagging (direct writes from the browser)
const cash = (await asUser(a, `insert into public.accounts (name, class, balance, balance_date) values ('Cash', 'cash', 40, now()) returning id, connection_id`)).rows[0];
check('a manual account has no connection', cash.connection_id === null);
const entered = (await asUser(a,
  `insert into public.transactions (account_id, source, posted_date, amount, description, category_id, note, approved, approved_at)
   values ($1, 'manual', '2026-11-03', -12.5, 'Bagels', $2, 'with Sam', true, now()) returning id, approved`, [cash.id, dining])).rows[0];
const enteredTransfer = (await asUser(a,
  `insert into public.transactions (account_id, source, posted_date, amount, description, is_transfer, approved, approved_at)
   values ($1, 'manual', '2026-11-03', 100, 'ATM withdrawal', true, true, now()) returning id`, [cash.id])).rows[0].id;
check('Add transaction: saved approved, with a category or as a transfer', entered.approved && Boolean(enteredTransfer));
const bulkTag = (await asUser(a, `insert into public.tags (name) values ('Weekend') returning id`)).rows[0].id;
await asUser(a, `insert into public.transaction_tags (transaction_id, tag_id) values ($1, $2)`, [entered.id, bulkTag]);
await asUser(a, `insert into public.transaction_tags (transaction_id, tag_id) values ($1, $3), ($2, $3) on conflict (transaction_id, tag_id) do nothing`,
  [entered.id, enteredTransfer, bulkTag]);
check('bulk tag: rows that already carry the tag are skipped, the rest tagged', (await asUser(a,
  `select count(*)::int n from public.transaction_tags where tag_id = $1`, [bulkTag])).rows[0].n === 2);
await asUser(a, `delete from public.transaction_tags where tag_id = $1 and transaction_id = any($2)`, [bulkTag, [entered.id, enteredTransfer]]);
check('bulk untag: removes the tag from every selected row', (await asUser(a,
  `select count(*)::int n from public.transaction_tags where tag_id = $1`, [bulkTag])).rows[0].n === 0);
let crossTag = false;
try { await asUser(b, `insert into public.transaction_tags (transaction_id, tag_id) values ($1, $2) on conflict do nothing`, [entered.id, bulkTag]); crossTag = (await asUser(a, `select count(*)::int n from public.transaction_tags where tag_id = $1`, [bulkTag])).rows[0].n > 0; } catch {}
check("bulk tag: another user can't tag your rows", !crossTag);
await asUser(a, `update public.accounts set balance = 55.25, balance_date = now() where id = $1`, [cash.id]);
check('a manual account balance can be edited', Number((await asUser(a, `select balance from public.accounts where id = $1`, [cash.id])).rows[0].balance) === 55.25);
await asUser(a, `delete from public.accounts where id = $1`, [cash.id]);
check('deleting a manual account deletes its transactions', (await asUser(a,
  `select count(*)::int n from public.transactions where id = any($1)`, [[entered.id, enteredTransfer]])).rows[0].n === 0);

// ---- Phase 4: reimbursements (as user D)
const fails = async (sql, params) => { try { await one(sql, params); return false; } catch { return true; } };
const dDiningR = (await one(`select id from public.categories where name = 'Dining'`)).id;
const dIncome = (await one(`select id from public.categories where name = 'Income'`)).id;
const feast = await txn({ account_id: card, amount: -120, posted_date: '2026-10-10', category_id: dDiningR, approved: true });
const dSpentOn = async (id) => Number((await one(`select spent from public.spending_lines where transaction_id = $1`, [id]))?.spent);
const rSam = (await one(`select public.expect_reimbursement($1, 'Sam', 40) as id`, [feast])).id;
const rAlex = (await one(`select public.expect_reimbursement($1, ' Alex ', 30, 'drinks') as id`, [feast])).id;
check('expect_reimbursement: category spending counts only your share', (await dSpentOn(feast)) === 50);
check('expect_reimbursement: trims the name', (await one(`select who from public.reimbursements where id = $1`, [rAlex])).who === 'Alex');
check('expect_reimbursement: no more than the charge in total', await fails(`select public.expect_reimbursement($1, 'Kim', 50.01)`, [feast]));
check('expect_reimbursement: not on money in, transfers or pending rows',
  await fails(`select public.expect_reimbursement($1, 'Sam', 1)`, [await txn({ amount: 10 })]) &&
  await fails(`select public.expect_reimbursement($1, 'Sam', 1)`, [await txn({ amount: -10, is_transfer: true })]) &&
  await fails(`select public.expect_reimbursement($1, 'Sam', 1)`, [await txn({ amount: -10, pending: true, external_id: 'P1', source: 'simplefin' })]));
check('expect_reimbursement: needs a name and an amount above zero',
  await fails(`select public.expect_reimbursement($1, ' ', 5)`, [feast]) && await fails(`select public.expect_reimbursement($1, 'Sam', 0)`, [feast]));
check("expect_reimbursement: can't add to another user's charge",
  await (async () => { try { await asUser(b, `select public.expect_reimbursement($1, 'Sam', 1)`, [feast]); return false; } catch { return true; } })());

// Sam pays $60 for a $40 item: $40 linked, $20 of the payment left over
const samPays = await txn({ account_id: checking, amount: 60, posted_date: '2026-10-12', description: 'VENMO SAM' });
const linked = Number((await one(`select public.link_reimbursement_payment($1, $2) as n`, [samPays, [rSam, rAlex]])).n);
check('link: covers items oldest first, each up to what is still owed', linked === 60);
const st = async (id) => (await one(`select status from public.reimbursements where id = $1`, [id])).status;
const paidOn = async (id) => Number((await one(`select coalesce(sum(amount), 0) as n from public.reimbursement_payments where reimbursement_id = $1`, [id])).n);
check('link: an item paid in full is received; one paid in part stays owed',
  (await st(rSam)) === 'received' && (await st(rAlex)) === 'owed' && (await paidOn(rSam)) === 40 && (await paidOn(rAlex)) === 20);
const samRow = await row(samPays);
check('link: the payment is approved with no category', samRow.approved && samRow.category_id === null && !samRow.is_transfer);
check('link: a linked payment is neither spending nor income',
  (await one(`select count(*)::int n from public.spending_lines where transaction_id = $1`, [samPays])).n === 0 &&
  (await asUser(d, `select income::float from public.monthly_cashflow() where month = '2026-10-01'`)).rows.every((r) => r.income === 0));
check('link: a used-up payment links nothing more', await fails(`select public.link_reimbursement_payment($1, $2)`, [samPays, [rAlex]]));
check('link: not from money out', await fails(`select public.link_reimbursement_payment($1, $2)`, [await txn({ amount: -10 }), [rAlex]]));
check("link: another user can't link your payment",
  await (async () => { try { await asUser(b, `select public.link_reimbursement_payment($1, $2)`, [samPays, [rAlex]]); return false; } catch { return true; } })());

// Alex never pays the other $10: written off, only the unpaid part counts again
await one(`update public.reimbursements set status = 'written_off' where id = $1`, [rAlex]);
check('written off after a partial payment: only the unpaid part is your spending again', (await dSpentOn(feast)) === 60);
check('link: skips written-off items', await fails(`select public.link_reimbursement_payment($1, $2)`, [await txn({ amount: 10 }), [rAlex]]));

// Undo Sam's link
const unlinked = (await one(`select public.unlink_reimbursement_payment($1) as n`, [samPays])).n;
const samAfter = await row(samPays);
check('unlink: removes the links; paid items are owed again, written-off ones stay',
  unlinked === 2 && (await st(rSam)) === 'owed' && (await st(rAlex)) === 'written_off' && (await paidOn(rSam)) === 0);
check('unlink: the payment goes back to To review', !samAfter.approved);
check('unlink: written off and unpaid counts in full again; owed still comes off', (await dSpentOn(feast)) === 80);
check('unlink: a payment with no links returns 0', (await one(`select public.unlink_reimbursement_payment($1) as n`, [samPays])).n === 0);

// Received by hand (cash): no payment needed, still only your share
await one(`update public.reimbursements set status = 'received' where id = $1`, [rSam]);
check('received by hand: still counts only your share', (await dSpentOn(feast)) === 80);
await one(`update public.transactions set category_id = $1 where id = $2`, [dIncome, samPays]);

let anonRpc5 = false;
try { await db.exec(`set role anon;`); await db.query(`select public.unlink_reimbursement_payment(gen_random_uuid())`); anonRpc5 = true; } catch {} finally { await db.exec(`reset role;`); }
check('signed-out visitors cannot call the reimbursement functions', !anonRpc5);
await db.exec(readFileSync(join(dir, migrations.find((f) => f.endsWith('_reimbursements.sql'))), 'utf8'));
check('reimbursements migration is safe to re-run', true);

// ---- Delete a manually added transaction (as user D)
const gone = async (id) => (await one(`select count(*)::int n from public.transactions where id = $1`, [id])).n === 0;
const del = (id) => one(`select public.delete_manual_transaction($1)`, [id]);
const typo = await txn({ amount: -9.99, description: 'Typo' });
await del(typo);
check('delete_manual_transaction: deletes a manual row', await gone(typo));
const synced = await txn({ amount: -5, source: 'simplefin', external_id: 'SYNCED1' });
check('delete_manual_transaction: refuses synced rows', (await fails(`select public.delete_manual_transaction($1)`, [synced])) && !(await gone(synced)));
check("delete_manual_transaction: another user can't delete your row",
  await (async () => { const t = await txn({ amount: -1 }); try { await asUser(b, `select public.delete_manual_transaction($1)`, [t]); } catch {} return !(await gone(t)); })());

// a manual charge with an unpaid reimbursement: both go
const lunch = await txn({ amount: -30, category_id: dDiningR, approved: true });
const rLunch = (await one(`select public.expect_reimbursement($1, 'Jo', 15) as id`, [lunch])).id;
await del(lunch);
check('delete_manual_transaction: unpaid reimbursements on it go too', await gone(lunch) &&
  (await one(`select count(*)::int n from public.reimbursements where id = $1`, [rLunch])).n === 0);

// a manual charge whose reimbursement has a payment linked: refused
const brunch = await txn({ amount: -40, category_id: dDiningR, approved: true });
const rBrunch = (await one(`select public.expect_reimbursement($1, 'Lee', 20) as id`, [brunch])).id;
const leePays = await txn({ account_id: checking, amount: 20, description: 'Lee' });
await one(`select public.link_reimbursement_payment($1, $2)`, [leePays, [rBrunch]]);
check('delete_manual_transaction: refuses a charge with a linked payment',
  (await fails(`select public.delete_manual_transaction($1)`, [brunch])) && !(await gone(brunch)));

// deleting the payback itself: unlinked first, so Lee owes it again
await del(leePays);
check('delete_manual_transaction: deleting a payback reopens what it paid',
  (await gone(leePays)) && (await st(rBrunch)) === 'owed' && (await paidOn(rBrunch)) === 0);

// one side of a confirmed transfer: the other side goes back to review, unpaired
const delOut = await txn({ account_id: checking, amount: -75, posted_date: '2026-10-20' });
const delIn = await txn({ account_id: card, amount: 75, posted_date: '2026-10-20' });
await one(`select public.confirm_transfer($1, $2)`, [delOut, delIn]);
await del(delIn);
const otherSide = await row(delOut);
check('delete_manual_transaction: the other side of a transfer goes back to review',
  (await gone(delIn)) && !otherSide.approved && !otherSide.is_transfer && otherSide.transfer_pair_id === null);

let anonDel = false;
try { await db.exec(`set role anon;`); await db.query(`select public.delete_manual_transaction(gen_random_uuid())`); anonDel = true; } catch {} finally { await db.exec(`reset role;`); }
check('signed-out visitors cannot delete transactions', !anonDel);
await db.exec(readFileSync(join(dir, migrations.find((f) => f.endsWith('_delete_manual_transactions.sql'))), 'utf8'));
check('delete migration is safe to re-run', true);

// ---------------------------------------------------------------------------
// Editing categories (Settings → Categories): direct writes + delete_category
// ---------------------------------------------------------------------------
const pets = (await one(`insert into public.categories (name, group_name, sort_order) values ('Pets', 'Lifestyle', 150) returning id`)).id;
check('add a category', Boolean(pets));
await one(`update public.categories set name = 'Pet care', is_income = false where id = $1`, [pets]);
check('rename a category', (await one(`select name from public.categories where id = $1`, [pets])).name === 'Pet care');
check('category names are unique per user', await fails(`insert into public.categories (name) values ('Dining')`));
const vet = await txn({ amount: -80, category_id: pets, approved: true });
const petShop = await merchant('Pet Shop');
await one(`update public.merchants set last_category_id = $1 where id = $2`, [pets, petShop]);
check('delete_category: refuses moving into itself', await fails(`select public.delete_category($1, $1)`, [pets]));
await one(`select public.delete_category($1, $2)`, [pets, dGroceries]);
const vetAfter = await row(vet);
check('delete_category: transactions move over and stay approved', vetAfter.category_id === dGroceries && vetAfter.approved);
check('delete_category: merchant memory moves over',
  (await one(`select last_category_id from public.merchants where id = $1`, [petShop])).last_category_id === dGroceries);
check('delete_category: the category is gone',
  (await one(`select count(*)::int n from public.categories where name = 'Pet care'`)).n === 0);
const toys = (await one(`insert into public.categories (name) values ('Toys') returning id`)).id;
const ball = await txn({ amount: -12, category_id: toys, approved: true });
await one(`select public.delete_category($1)`, [toys]);
check('delete_category: without a target, its transactions become Uncategorized (no category), still approved',
  (await row(ball)).category_id === null && (await row(ball)).approved);
const unused = (await one(`insert into public.categories (name) values ('Unused') returning id`)).id;
await one(`select public.delete_category($1)`, [unused]);
check('delete_category: an unused category goes without a target',
  (await one(`select count(*)::int n from public.categories where id = $1`, [unused])).n === 0);
check("delete_category: another user can't delete your category", await (async () => {
  try { await asUser(b, `select public.delete_category($1, $2)`, [dDining, dGroceries]); } catch {}
  return Boolean(await catId('Dining'));
})());
await db.exec(readFileSync(join(dir, migrations.find((f) => f.endsWith('_delete_category.sql'))), 'utf8'));
check('delete_category migration is safe to re-run', true);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
