// Every user-visible string in the web app, in one place, grouped by page.
// Messages the server sends back (edge functions) live in
// supabase/functions/_shared/messages.ts; database errors are in the migrations.
//
// Templates take values already formatted (money(), shortDate()), so this file
// imports nothing. Where a sentence holds a link or markup, it's split into
// named parts around it.

/** "1 transaction", "3 transactions". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Shared words: buttons, labels and values that appear on many pages. */
const common = {
  close: 'Close',
  closeSymbol: '×',
  cancel: 'Cancel',
  save: 'Save',
  delete: 'Delete',
  add: 'Add',
  back: 'Back',
  done: 'Done',
  rename: 'Rename',
  edit: 'Edit',
  reset: 'Reset',
  showAll: 'Show all',
  actions: 'Actions',
  typeName: 'Type a name first',
  enterAmount: 'Enter an amount',
  missing: '—',
  uncategorized: 'Uncategorized',
  transfer: 'Transfer',
  noGroup: 'No group',
  noneYet: 'None yet',
  name: 'Name',
  group: 'Group',
  note: 'Note',
  optional: '(optional)',
  amountPlaceholder: '0.00',
  transactions: 'Transactions',
  deleted: (name: string) => `Deleted ${name}.`,
  saved: (name: string) => `Saved ${name}.`,
  renamedTo: (name: string) => `Renamed to ${name}.`,
  couldntSave: (error: string) => `Couldn’t save: ${error}`,
  newTag: (text: string) => `New tag “${text}”`,
  tagName: 'Tag name',
  addTagTo: (name: string) => `Add a tag to ${name}`,
  owes: (who: string, amount: string) => `${who} (owes ${amount})`,
};

/** Values formatted for display (lib/format, lib/months). */
const format = {
  never: 'never',
  justNow: 'just now',
  minutesAgo: (n: number) => `${plural(n, 'minute')} ago`,
  hoursAgo: (n: number) => `${plural(n, 'hour')} ago`,
  allTime: 'All time',
};

/** The shell: wordmark, navigation, the phone menu. */
const app = {
  name: 'Ledger',
  nav: { spending: 'Spending', trends: 'Trends', owed: 'Owed to me', accounts: 'Accounts', settings: 'Settings' },
  mainNav: 'Main',
  toReview: (n: number) => `${n} to review`,
  menu: 'Menu',
  menuToReview: (n: number) => `Menu, ${n} to review`,
  closeMenu: 'Close menu',
};

/** Shown instead of the app when the build has no Supabase settings. Its env var names are code, not copy. */
const notConfigured = {
  title: "Ledger isn't connected to a database yet",
  set: 'Set',
  and: 'and',
  inA: 'in a',
  rest: 'file for local development, or as repository variables for the GitHub Pages build. The README has the steps.',
};

const signIn = {
  title: 'Sign in',
  createTitle: 'Create your account',
  createNote: 'This app is for one person. After you create your account, turn off sign-ups in Supabase so nobody else can.',
  email: 'Email',
  password: 'Password',
  working: 'Working…',
  signIn: 'Sign in',
  createAccount: 'Create account',
  toCreate: 'First time here? Create your account',
  toSignIn: 'Already have an account? Sign in',
  checkEmail: (email: string) => `Check ${email} for a confirmation link, then come back and sign in.`,
};

/** Spending: the month dropdown, Spent / Income / Saved, and the category pie (MonthSpending). */
const month = {
  previous: 'Previous month',
  next: 'Next month',
  previousSymbol: '‹',
  nextSymbol: '›',
  noEarlier: 'No earlier spending',
  isCurrent: 'This is the current month',
  pickMonth: 'Pick a month to step through months',
  month: 'Month',
  spent: 'Spent',
  income: 'Income',
  saved: 'Saved',
  overspent: 'Spent more than earned',
  noSpendingYet: 'No spending yet.',
  noSpendingIn: (month: string) => `No spending in ${month}.`,
  pieLabel: (byGroup: boolean, month: string) => `Spending by ${byGroup ? 'category group' : 'category'}, ${month}`,
  pieHint: 'Shows its transactions',
  showPieBy: 'Show the pie by',
  byCategory: 'Category',
  byGroup: 'Group',
};

/** Spending: the page, the transaction list and its filters. */
const spending = {
  title: 'Spending',
  addTransaction: 'Add transaction',
  listTitle: 'Transactions',
  filtersOn: 'Filters are on.',
  loadMore: (n: number) => `Load ${n} more`,

  // column headers (each also names its filter)
  date: 'Date',
  merchant: 'Merchant',
  account: 'Account',
  category: 'Category',
  tags: 'Tags',
  amount: 'Amount',
  approved: 'Approved',
  approvedShort: '✓',
  accountsPlural: 'accounts',
  categoriesPlural: 'categories',
  selectAllShown: 'Select all shown',
  selectAllShownCount: (n: number) => `Select all ${n} shown`,
  clearSelection: 'Clear selection',

  // filter fields and items
  after: 'After',
  before: 'Before',
  nameContains: 'Name contains',
  min: 'Min',
  max: 'Max',
  dollar: '$',
  minPlaceholder: '0',
  any: 'Any',
  toReview: 'To review',
  toReviewCount: (n: number) => `To review (${n})`,
  noTags: 'No tags',

  // the phones' Filters sheet: each row's state
  all: 'All',
  someOf: (shown: number, total: number) => `${shown} of ${total}`,
  quoted: (text: string) => `“${text}”`,

  // empty list
  noMatch: 'No transactions match.',
  noneCarryTag: (what: 'review' | 'approved' | 'all', month: string | null) =>
    `No ${what === 'review' ? 'transactions to review' : what === 'approved' ? 'approved transactions' : 'transactions'}${month ? ` in ${month}` : ''} carry this tag.`,
  nothingWaiting: 'Nothing waiting. New transactions from the daily sync land here until you approve them.',
  noneInMonth: (approved: boolean, month: string) => `No ${approved ? 'approved transactions' : 'transactions'} in ${month}.`,
  noneYet: "No transactions yet. They'll appear here after your first sync or import.",

  // results of actions
  nowTransfer: (name: string) => `${name} is now a transfer and approved.`,
  nowCategory: (name: string, category: string) => `${name} is now ${category}.`,
  otherSideBack: ' The other side of the transfer is back in To review.',
  approvedCount: (n: number) => `Approved ${plural(n, 'transaction')}.`,
  backInReview: (name: string) => `${name} is back in To review.`,
  expected: (who: string, amount: string, name: string) =>
    `${who} owes you ${amount} for ${name}. It's on Owed to me, and only your share counts as spending.`,
  linked: (amount: string) => `Linked ${amount} as paid back. It's approved and doesn't count as income.`,
  unlinked: (name: string) => `Unlinked ${name}. It's back in To review, and what it paid back is owed again.`,
  deleteSummary: (name: string, amount: string, date: string) => `${name} (${amount}, ${date})`,
  deleteReimbursements: 'what people owe you on it is removed too',
  deletePayback: (names: string) => `what it paid back is owed again by ${names}`,
  deleteTransfer: 'the other side of the transfer goes back to To review',
  confirmDelete: (summary: string, also: string[]) => `Delete ${summary}? This can’t be undone${also.length ? `; ${also.join(', and ')}` : ''}.`,
  nowCategoryMany: (n: number, category: string) => `${plural(n, 'transaction')} ${n === 1 ? 'is' : 'are'} now ${category}.`,
  otherSidesBack: ' The other sides of their transfers are back in To review.',
  alreadyTagged: (tag: string) => `All selected transactions already carry ${tag}.`,
  tagged: (n: number, tag: string) => `Tagged ${plural(n, 'transaction')} ${tag}.`,
  untagged: (tag: string, n: number) => `Removed ${tag} from ${plural(n, 'transaction')}.`,
  deletedTag: 'a deleted tag',
  transferConfirmed: 'Transfer confirmed and approved.',
  transferDismissed: 'Dismissed. Both transactions are still in To review.',
};

/** Shared filter controls: a header's checklist or typed form, and the phones' Filters sheet. */
const filters = {
  filter: (label: string, on: boolean) => `Filter ${label}${on ? ', filter on' : ''}`,
  filterTitle: (label: string) => `Filter ${label}`,
  search: (what: string) => `Search ${what}`,
  selectAll: 'Select all',
  selectAllMatches: 'Select all matches',
  only: 'Only',
  onlyItem: (name: string) => `Only ${name}`,
  noMatches: 'No matches.',
  keepOne: 'At least one has to stay ticked',
  upTo: (n: number) => `Up to ${n} at a time`,
  clear: 'Clear',
  apply: 'Apply',
  sheetButton: (n: number) => (n ? `Filters (${n})` : 'Filters'),
  sheetTitle: 'Filters',
  noneOn: 'No filters are on',
};

/** A searchable picker (Combobox) and the category picker. */
const picker = {
  choose: 'Choose…',
  noMatch: 'No match',
  typeToCreate: 'Type a name to create one',
  create: (text: string) => `Create “${text}”`,
  transferOption: 'Transfer (not spending)',
};

/** A row of the transaction list, its tags, and its ⋯ menu. */
const row = {
  select: (name: string) => `Select ${name}`,
  categoryFor: (name: string) => `Category for ${name}`,
  payback: 'Payback, not income',
  yourShare: (amount: string) => `your share ${amount}`,
  paidBackBy: (names: string) => `Paid back by ${names}`,
  approvedFor: (name: string) => `Approved: ${name}`,
  linkedTitle: 'Linked as a payback; use Unlink payment in its ⋯ menu to change this',
  untickTitle: 'Untick to move it back to To review',
  tickTitle: 'Tick to approve',
  note: (note: string) => `Note: ${note}`,
  pending: 'Pending',
  addTagButton: '+ Tag',
  showTagged: (tag: string) => `Show transactions tagged ${tag}`,
  removeTag: 'Remove tag',
  removeTagFrom: (tag: string, name: string) => `Remove tag ${tag} from ${name}`,
  menuSymbol: '⋯',
  moreFor: (name: string) => `More for ${name}`,
  addTag: 'Add tag',
  expect: 'Expect reimbursement',
  expectTitle: 'Someone owes you part of this',
  expectFullTitle: 'The whole charge is already expected back',
  link: 'Link to what someone owes',
  unlink: 'Unlink payment',
  delete: 'Delete transaction',
  deleteTitle: 'You added this by hand, so you can delete it',
  saveFailed: 'Couldn’t save. Try again.',
};

/** The bar above the list when rows are selected. */
const bulk = {
  region: 'Selected transactions',
  selected: (n: number) => `${n} selected`,
  approve: (n: number) => `Approve${n ? ` ${n}` : ''}`,
  noneToApprove: 'None of the selected rows is waiting for review',
  setCategory: 'Set category',
  setCategoryLabel: 'Set the category of the selected transactions',
  addTag: '+ Add tag',
  addTagLabel: 'Add a tag to the selected transactions',
  removeTag: '− Remove tag',
  removeTagLabel: 'Remove a tag from the selected transactions',
};

/** Possible transfers and Paid back?, above the list. */
const suggestions = {
  transfersTitle: 'Possible transfers',
  from: 'From',
  to: 'To',
  dates: 'Dates',
  action: 'Action',
  arrow: (date: string) => ` → ${date}`,
  confirmTransfer: 'Confirm transfer',
  notTransfer: 'Not a transfer',
  paybacksTitle: 'Paid back?',
  moneyIn: 'Money in',
  paysBack: 'Pays back',
  item: (who: string, label: string, amount: string) => `${who}: ${label} ${amount}`,
  ofTotal: (amount: string) => ` of ${amount}`,
  moreThanOwed: (amount: string) => `${amount} more than they owe; not counted as income`,
  link: 'Link',
  choose: 'Choose…',
};

/** Add transaction (a modal on Spending). */
const addTransaction = {
  title: 'Add transaction',
  intro: 'Saved as approved, since you entered it. Money in can pay back what someone owes you.',
  account: 'Account',
  date: 'Date',
  amount: 'Amount',
  outOrIn: 'Money out or in',
  out: 'Out',
  in: 'In',
  description: 'Description',
  descriptionPlaceholder: 'Dinner with Sam',
  paysBack: 'Pays back',
  nobody: 'Nobody: income or a refund',
  covers: (parts: string[], extra: string | null) =>
    `Covers ${parts.join(', ')}${extra ? `; ${extra} more than they owe` : ''}. Not counted as income.`,
  coversPart: (label: string, amount: string) => `${label} ${amount}`,
  enterToSee: 'Enter the amount to see what it covers.',
  category: 'Category',
  noAccount: 'Add an account first',
  pickDate: 'Pick a date',
  describe: 'Describe it',
  summary: (description: string, amount: string, account: string | undefined) => `${description} (${amount}) on ${account}`,
  payingBack: (who: string) => `, paying back ${who}`,
  notLinkedSummary: (summary: string) => `${summary}, but not linked`,
  addedNotLinked: (summary: string) => `Added ${summary}, but not linked.`,
  linkFailed: (error: string) => `Saved, but linking it failed (it's in To review): ${error}`,
  added: (summary: string, approved: boolean) => `Added ${summary}${approved ? ', approved' : ''}.`,
};

/** Expect reimbursement and Link to what someone owes (ReimbursementForms). */
const reimbursements = {
  expectForm: 'Expect reimbursement',
  linkForm: 'Link to what someone owes',
  whoOwes: 'Who owes you',
  howMuch: 'How much',
  half: 'Half',
  theRest: 'The rest',
  sayWho: 'Say who owes it',
  atMost: (amount: string) => `At most ${amount} is left on this charge`,
  nobodyOwes: 'Nobody owes you anything right now. Use Expect reimbursement on a charge first.',
  paidBackBy: 'Paid back by',
  covers: 'Covers',
  item: (label: string, amount: string) => `${label}: ${amount}`,
  partOf: (amount: string) => ` (${amount} of it)`,
  usedUp: ' (payment used up)',
  extra: (amount: string) => `${amount} of this payment is more than they owe; it won’t count as income.`,
  link: (amount: string) => `Link ${amount}`,
  tickOne: 'Tick at least one item',
  // a charge's line: "Sam owes $40 · Alex paid back $30"
  status: { owed: 'owes', received: 'paid back', written_off: 'written off:' },
  separator: ' · ',
  // who a payment paid back: "Sam", "Sam and Alex", "Sam, Alex and Kim"
  and: ' and ',
  listSeparator: ', ',
};

const trends = {
  title: 'Trends',
  ranges: { '12m': 'Last 12 months', ytd: 'This year', '6m': 'Last 6 months', '3m': 'Last 3 months' },
  months: 'Months',
  tags: 'Tags',
  includeTagged: 'Include tagged:',
  all: 'All',
  none: 'None',
  more: (n: number) => ` +${n}`,
  everyTag: 'Every tag is included',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  averageMonth: 'Average month',
  includeHousing: 'Include Housing',
  housing: 'Housing',
  paceLabel: 'Spending so far this month, day by day',
  cashFlow: 'Cash flow',
  income: 'Income',
  spending: 'Spending',
  cashFlowLabel: 'Income and spending by month',
  opensTransactions: 'Opens its transactions',
  categoriesOverTime: 'Categories over time',
  groupsOverTime: 'Category groups over time',
  categories: 'Categories',
  groups: 'Groups',
  biggestAlready: 'Showing the biggest already',
  overTimeLabel: (names: string[]) => `${names.join(', ')} spending by month`,
  opensMonth: "Enter opens that month's transactions",
  netWorth: 'Net worth',
  netWorthLabel: 'Net worth by month',
  noBalances: 'No balances yet. They appear after the first sync.',
};

/** Hand-rolled charts (components/charts). */
const charts = {
  // axis labels: $0, $750, $1.5K, $12K, −$500
  axisMoney: (negative: boolean, value: string) => `${negative ? '−' : ''}$${value}`,
  thousands: (value: string) => `${value}K`,
  monthLabel: (month: string, values: string[], hint: string | null) => `${month}: ${values.join(', ')}${hint ? `. ${hint}` : ''}`,
  seriesValue: (name: string, value: string) => `${name} ${value}`,
  arrowMonths: (label: string, hint: string) => `${label}. Arrow keys move between months; ${hint.toLowerCase()}`,
  arrowDays: (label: string) => `${label}. Arrow keys move between days`,
  other: (n: number) => `Other (${n})`,
  pieLabel: (label: string, slices: string[]) => `${label}: ${slices.join(', ')}`,
  sliceShare: (name: string, share: string) => `${name} ${share}`,
  sliceTip: (name: string, share: string) => `${name} · ${share}`,
  rowLabel: (name: string, value: string, share: string, hint: string) => `${name}: ${value}, ${share}. ${hint}`,
};

const owed = {
  title: 'Owed to me',
  emptyBefore: 'Nobody owes you anything. On',
  emptyLink: 'Spending',
  emptyAfter: ', open a charge’s details and choose Expect reimbursement when someone owes you part of it.',
  totalOwed: 'Total owed',
  help: 'When someone pays you back, link the payment on Spending (it’s suggested under Paid back?), or enter a Venmo payment with Add transaction. Paid in cash? Mark it received.',
  owes: (amount: string) => `owes ${amount}`,
  date: 'Date',
  for: 'For',
  owedCol: 'Owed',
  paid: 'Paid',
  left: 'Left',
  who: 'Who',
  amount: 'Amount',
  status: 'Status',
  received: 'Received',
  receivedTitle: 'Paid outside your accounts, like cash',
  writeOff: 'Write off',
  writeOffPartTitle: 'The unpaid part counts as your spending again',
  writeOffTitle: 'It counts as your spending again',
  remove: 'Remove',
  stopExpecting: (amount: string, who: string, label: string) => `Stop expecting ${amount} from ${who} for ${label}`,
  confirmRemove: (amount: string, who: string, label: string) =>
    `Stop expecting ${amount} from ${who} for ${label}? The whole charge counts as yours again.`,
  removed: (label: string) => `Removed. ${label} counts in full again.`,
  markedReceived: (label: string, who: string) => `Marked ${label} received from ${who}.`,
  wroteOff: (amount: string, who: string) => `Wrote off ${amount} from ${who}; it counts as your spending again.`,
  settled: 'Settled',
  writtenOff: 'Written off',
  writtenOffAfter: (amount: string) => `Written off after ${amount} paid`,
  paidBackOn: (date: string) => `Paid back ${date}`,
  reopen: 'Reopen',
  reopened: (who: string, amount: string, label: string) => `${who} owes ${amount} for ${label} again.`,
  reopenNote: 'Fully paid items reopen by unlinking their payment on Spending.',
};

const accounts = {
  title: 'Accounts',
  lastSynced: (time: string) => `Last synced ${time}.`,
  netWorth: 'Net worth',
  updateFailed: (error: string) => `Couldn't update accounts: ${error}`,
  noBanks: 'No banks connected yet.',
  connectLink: 'Connect SimpleFIN Bridge in Settings.',
  staleBefore:
    'The daily sync hasn\'t run in over a day and a half. Check the "Daily SimpleFIN sync" workflow in GitHub Actions (it may have been disabled), or the',
  staleLink: 'sync log',
  staleAfter: '.',
  classes: { cash: 'Cash', investment: 'Investments', liability: 'Liabilities' },
  manual: 'Manual',
  hiddenTag: ' · Hidden',
  editName: (name: string) => `Edit ${name}`,
  total: (label: string) => `Total ${label.toLowerCase()}`,
  showHidden: (n: number) => `Show ${plural(n, 'hidden account')}`,
  hideHidden: 'Hide hidden accounts',
  addManual: 'Add manual account',
  added: (name: string) => `Added ${name}. Add its transactions from the Spending page.`,

  // Add manual account / Edit account modals
  addTitle: 'Add manual account',
  addIntro: 'For accounts SimpleFIN can’t see, like Venmo. Enter their transactions with Add transaction on the Spending page.',
  namePlaceholder: 'Venmo',
  class: 'Class',
  currentBalance: 'Current balance',
  addButton: 'Add account',
  badBalance: 'The balance isn’t a number',
  editTitle: 'Edit account',
  manualAccount: 'Manual account',
  balance: 'Balance',
  hide: 'Hide this account',
  deleteButton: 'Delete account',
  confirmInvestment: (name: string, n: number) =>
    `Move ${name} to Investments? Only its balance is kept: its ${plural(n, 'transaction')} ` +
    `(and any notes, reimbursements or tags on them) will be deleted.`,
  confirmDelete: (name: string, n: number) =>
    `Delete ${name}? This can’t be undone; ${
      n ? `its ${plural(n, 'transaction')} (and any tags or reimbursements on them) will be deleted too.` : 'it has no transactions.'
    }`,
};

const settings = {
  title: 'Settings',
  loadFailed: (error: string) => `Couldn't load settings: ${error}`,
  bankConnection: 'Bank connection',
  syncing: 'Syncing…',
  connected: 'Connected',
  // a connection that isn't active
  status: {
    needs_attention: 'Needs attention',
    rate_limited: 'Paused for a day after a rate-limit warning',
    disabled: 'Disabled',
  } as Record<string, string>,
  upToAMinute: 'Can take up to a minute',
  lastSynced: (time: string) => `Last synced ${time}`,
  syncNow: 'Sync now',
  alreadySyncing: 'Already syncing',
  syncLog: 'Sync log',
  reconnect: 'Reconnect',
  syncError: (error: string) => `Couldn't sync: ${error}`,
  syncSkipped: (reason: string) => `Sync skipped: ${reason}.`,
  syncFailed: (messages: string[]) => `Sync failed: ${messages.join(' ')}`,
  synced: (added: number, updated: number, removed: number, messages: string[]) =>
    `Synced: ${added} new, ${updated} updated, ${removed} removed.${messages.length ? ` ${messages.join(' ')}` : ''}`,
  sections: { Categories: 'Categories', Merchants: 'Merchants', Tags: 'Tags' },
  account: 'Account',
  signedInAs: (email: string) => `Signed in as ${email}`,
  signOut: 'Sign out',
  backToSettings: '‹ Settings',

  // connecting SimpleFIN
  connectIntro:
    'In SimpleFIN Bridge, create a Setup Token and paste it here. It works only once; the app trades it for access that stays encrypted on the server.',
  setupToken: 'Setup Token',
  connect: 'Connect SimpleFIN',
  connecting: 'Connecting and syncing…',
  firstSyncWait: 'The first sync can take up to a minute.',
  connectedSkipped: (reason: string) => `Connected. The first sync was skipped: ${reason}.`,
  connectedSynced: (n: number) => `Connected. First sync: ${n} new transactions.`,
  reconnectTitle: 'Reconnect SimpleFIN',
  waitForConnection: 'Wait for the connection to finish',

  // the sync log
  when: 'When',
  result: 'Result',
  new: 'New',
  updated: 'Updated',
  removed: 'Removed',
  trigger: (trigger: string) => ` (${trigger})`,
};

const categories = {
  find: 'Find a category',
  addButton: 'Add category',
  newPlaceholder: 'New category',
  newLabel: 'New category name',
  groupPlaceholder: 'Group',
  groupLabel: 'New category\'s group',
  category: 'Category',
  income: 'Income',
  showEvery: (name: string) => `Show every ${name} transaction`,
  noMatch: (text: string) => `No category matches "${text}".`,
  duplicate: 'You already have a category with that name.',
  added: (name: string, group: string | null) => (group ? `Added ${name} to ${group}.` : `Added ${name}.`),
  editTitle: 'Edit category',
  incomeCheckbox: 'Income (not spending)',
  deleteButton: 'Delete category',
  deleteTitle: (name: string) => `Delete ${name}?`,
  moveTo: (n: number) => `Move its ${plural(n, 'transaction')} to`,
  unused: 'No transactions use it.',
  couldntDelete: (error: string) => `Couldn’t delete: ${error}`,
  deletedInto: (name: string, target: string) => `Deleted ${name}; its transactions are now ${target}.`,
};

const merchants = {
  empty: 'Merchants appear here after your first sync.',
  find: 'Find a merchant',
  merchant: 'Merchant',
  rememberedCategory: 'Remembered category',
  bankDescriptions: (n: number) => plural(n, 'bank description'),
  newNameFor: (name: string) => `New name for ${name}`,
  merge: 'Merge',
  mergeLabel: (name: string) => `Merge ${name} into another merchant`,
  noOther: 'There is no other merchant to merge into',
  mergeInto: (name: string) => `Merge ${name} into`,
  mergeTarget: (name: string) => `Merchant to merge ${name} into`,
  chooseFirst: 'Choose a merchant first',
  mergeExplain: (transactions: number, aliases: number, name: string) =>
    `Its ${plural(transactions, 'transaction')} and ${plural(aliases, 'bank description')} move to the merchant you pick, and ${name} is removed.`,
  noMatch: (text: string) => `No merchant matches "${text}".`,
  merged: (from: string, into: string | undefined) => `Merged ${from} into ${into}.`,
};

const tags = {
  newPlaceholder: 'New tag, e.g. Japan 2026',
  newLabel: 'New tag name',
  addButton: 'Add tag',
  empty: 'No tags yet. Add one here, or with + Tag on any transaction.',
  tag: 'Tag',
  showEvery: (name: string) => `Show every transaction tagged ${name}`,
  deleteButton: 'Delete…',
  confirmDelete: (name: string, n: number) =>
    `Delete ${name}? ${n > 0 ? `It comes off its ${plural(n, 'transaction')}; the transactions stay.` : 'No transactions carry it.'}`,
  duplicate: 'You already have a tag with that name.',
  added: (name: string) => `Added ${name}. Tag transactions with it on Spending.`,
};

export const strings = {
  common,
  format,
  app,
  notConfigured,
  signIn,
  month,
  spending,
  filters,
  picker,
  row,
  bulk,
  suggestions,
  addTransaction,
  reimbursements,
  trends,
  charts,
  owed,
  accounts,
  settings,
  categories,
  merchants,
  tags,
};
