let tokenClient;
let accessToken = null;

function initGoogleAuth() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    callback: onTokenResponse,
  });
}

function onTokenResponse(response) {
  if (response.error) {
    showStatus('Authentication failed: ' + response.error, 'error');
    return;
  }
  accessToken = response.access_token;
  sessionStorage.setItem('access_token', accessToken);
  showAppSection();
}

function handleSignIn() {
  if (CONFIG.CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
    showStatus('Please set your CLIENT_ID in config.js first.', 'error');
    return;
  }
  tokenClient.requestAccessToken();
}

function handleSignOut() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken);
    accessToken = null;
  }
  sessionStorage.removeItem('access_token');
  showLoginSection();
}

function showAppSection() {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('app-section').style.display = 'block';
  document.getElementById('user-info').style.display = 'flex';
  if (CONFIG.DEFAULT_SHEET_ID) loadSheet();
}

function showLoginSection() {
  document.getElementById('login-section').style.display = 'flex';
  document.getElementById('app-section').style.display = 'none';
  document.getElementById('user-info').style.display = 'none';
  document.getElementById('data-container').innerHTML = '';
  hideStatus();
}

function showStatus(message, type) {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = type;
}

function hideStatus() {
  const el = document.getElementById('status');
  el.className = '';
  el.textContent = '';
}

async function loadSheet() {
  const sheetId = CONFIG.DEFAULT_SHEET_ID;
  if (!sheetId) {
    showStatus('No sheet ID configured.', 'error');
    return;
  }

  showStatus('Loading sheet data...', 'loading');
  document.getElementById('data-container').innerHTML = '';

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/Transactions`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const err = await response.json();
      const message = err.error?.message || `HTTP ${response.status}`;
      if (response.status === 403 || response.status === 404) {
        showStatus('Access denied or sheet not found.', 'error');
      } else if (response.status === 401) {
        showStatus('Session expired. Please sign in again.', 'error');
        accessToken = null;
        sessionStorage.removeItem('access_token');
        showLoginSection();
      } else {
        showStatus('Error: ' + message, 'error');
      }
      return;
    }

    const data = await response.json();
    const rows = data.values || [];
    rawRows = rows;

    // Fetch Categories sheet
    let categoryMeta = {};
    try {
      const catUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/Categories`;
      const catResponse = await fetch(catUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (catResponse.ok) {
        const catData = await catResponse.json();
        categoryMeta = parseCategorySheet(catData.values || []);
      }
    } catch (e) { /* Categories sheet is optional */ }

    hideStatus();
    renderAll(rows, categoryMeta);
  } catch (err) {
    showStatus('Network error: ' + err.message, 'error');
  }
}

function parseCategorySheet(rows) {
  if (rows.length < 2) return { nameToInfo: {}, parentCategories: [] };

  const headers = rows[0].map(h => h.trim());
  const catIdx = headers.indexOf('Category');
  const subIdx = headers.indexOf('Subcategory');
  const nameIdx = headers.indexOf('Name');

  const nameToInfo = {};
  const parentSet = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const parentCat = row[catIdx]?.trim() || '';
    const subCat = row[subIdx]?.trim() || '';
    const name = row[nameIdx]?.trim() || '';
    if (!name) continue;
    nameToInfo[name] = { parent: parentCat, isSubcategory: !!subCat };
    parentSet.add(parentCat);
  }

  return { nameToInfo, parentCategories: [...parentSet] };
}

// --- State ---
let chartInstance = null;
let barChartInstance = null;
let parsedData = null;
let rawRows = null;
let selectedMonths = new Set();
let selectedCategory = null;
let currentActiveCategories = [];
let hiddenCategories = new Set();
let enabledTags = new Set();
let catMeta = { nameToInfo: {}, parentCategories: [] };

// Disable animations
try { Chart.defaults.animation = false; } catch (e) {}

const CATEGORY_COLORS = [
  '#4a82c5', '#4ecdc4', '#f7b731', '#e77f67', '#778beb',
  '#63cdda', '#cf6a87', '#786fa6', '#f3a683', '#3dc1d3',
  '#e15f41', '#c44569', '#574b90', '#f78fb3', '#0fb9b1',
  '#a29bfe', '#ffeaa7', '#b8e994', '#6c5ce7', '#fd9644',
];

// --- Parse ---
function parseTransactions(rows) {
  if (rows.length < 2) return { transactions: [], months: [], displayMonths: [], categories: [], tags: [] };

  const headers = rows[0].map(h => h.trim());
  const dateIdx = headers.indexOf('Transaction Date');
  const debitIdx = headers.indexOf('Debit');
  const creditIdx = headers.indexOf('Credit');
  const catIdx = headers.indexOf('Category') !== -1 ? headers.indexOf('Category') : headers.indexOf('Category v2');
  const tagIdx = headers.indexOf('Tags');

  const transactions = [];
  const monthSet = new Set();
  const categorySet = new Set();
  const tagSet = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateStr = row[dateIdx];
    const debit = parseFloat((row[debitIdx] || '').replace(/[$,]/g, '')) || 0;
    const credit = parseFloat((row[creditIdx] || '').replace(/[$,]/g, '')) || 0;
    const category = row[catIdx]?.trim();
    const tag = row[tagIdx]?.trim() || '';

    if (!dateStr || (!debit && !credit) || !category) continue;

    let month, year;
    if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      year = parts[0];
      month = parseInt(parts[1], 10);
    } else {
      const parts = dateStr.split('/');
      month = parseInt(parts[0], 10);
      year = parts[2];
    }
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;

    monthSet.add(monthKey);
    categorySet.add(category);
    if (tag) tagSet.add(tag);

    const amount = debit || -credit;
    transactions.push({ monthKey, category, amount, tag, row });
  }

  const months = [...monthSet].sort();
  const categories = [...categorySet].sort();
  const tags = [...tagSet].sort();

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const displayMonths = months.map(m => {
    const [y, mo] = m.split('-');
    return `${monthNames[parseInt(mo, 10) - 1]} ${y}`;
  });

  return { transactions, months, displayMonths, categories, tags };
}

// --- Dropdown helper ---
function setupDropdown(container, onMenuClick) {
  const dropdown = container.querySelector('.dropdown');
  container.querySelector('.dropdown-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    // Close any other open dropdowns
    document.querySelectorAll('.dropdown.open').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
    dropdown.classList.toggle('open');
  });
  container.querySelector('.dropdown-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    onMenuClick(e, dropdown);
  });
}

// Close all dropdowns on outside click (single global listener)
document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
});

// --- Filters ---
function renderMonthSelector() {
  const { months, displayMonths } = parsedData;
  const container = document.getElementById('month-selector');

  function getLabel() {
    if (selectedMonths.size === 0 || selectedMonths.size === months.length) return 'All months';
    if (selectedMonths.size === 1) {
      const m = [...selectedMonths][0];
      return displayMonths[months.indexOf(m)] || m;
    }
    return `${selectedMonths.size} of ${months.length} months`;
  }

  container.innerHTML = `
    <div class="dropdown">
      <button class="dropdown-toggle">
        <span class="filter-label">Month</span>
        <span class="dropdown-value">${getLabel()}</span>
      </button>
      <div class="dropdown-menu">
        <div class="dropdown-item toggle-all" data-action="all">Select all</div>
        <div class="dropdown-item toggle-all" data-action="none">Select none</div>
        <div class="dropdown-divider"></div>
        ${months.map((m, i) => {
          const checked = selectedMonths.has(m);
          return `<label class="dropdown-item"><input type="checkbox" ${checked ? 'checked' : ''} data-month="${m}"> ${displayMonths[i]}</label>`;
        }).join('')}
      </div>
    </div>`;

  setupDropdown(container, (e) => {
    const action = e.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'all') months.forEach(m => selectedMonths.add(m));
      else selectedMonths.clear();
      selectedCategory = null;
      container.querySelectorAll('input[data-month]').forEach(cb => { cb.checked = selectedMonths.has(cb.dataset.month); });
      container.querySelector('.dropdown-value').textContent = getLabel();
      refreshViews();
      return;
    }
    const checkbox = e.target.closest('input[data-month]');
    if (checkbox) {
      checkbox.checked ? selectedMonths.add(checkbox.dataset.month) : selectedMonths.delete(checkbox.dataset.month);
      selectedCategory = null;
      container.querySelector('.dropdown-value').textContent = getLabel();
      refreshViews();
    }
  });
}

function renderTagSelector() {
  const { tags } = parsedData;
  const container = document.getElementById('tag-selector');

  if (tags.length === 0) { container.innerHTML = ''; return; }

  const allTags = ['__untagged__', ...tags];
  const tagLabels = { '__untagged__': 'Untagged' };

  function getLabel() {
    if (enabledTags.size === allTags.length) return 'All tags';
    if (enabledTags.size === 0) return 'No tags';
    if (enabledTags.size === 1) {
      const t = [...enabledTags][0];
      return tagLabels[t] || t;
    }
    return `${enabledTags.size} of ${allTags.length} tags`;
  }

  container.innerHTML = `
    <div class="dropdown">
      <button class="dropdown-toggle">
        <span class="filter-label">Tags</span>
        <span class="dropdown-value">${getLabel()}</span>
      </button>
      <div class="dropdown-menu">
        <div class="dropdown-item toggle-all" data-action="all">Select all</div>
        <div class="dropdown-item toggle-all" data-action="none">Select none</div>
        <div class="dropdown-divider"></div>
        ${allTags.map(tag => {
          const label = tagLabels[tag] || tag;
          const checked = enabledTags.has(tag);
          return `<label class="dropdown-item"><input type="checkbox" ${checked ? 'checked' : ''} data-tag="${tag}"> ${label}</label>`;
        }).join('')}
      </div>
    </div>`;

  setupDropdown(container, (e) => {
    const action = e.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'all') allTags.forEach(t => enabledTags.add(t));
      else enabledTags.clear();
      selectedCategory = null;
      container.querySelectorAll('input[data-tag]').forEach(cb => { cb.checked = enabledTags.has(cb.dataset.tag); });
      container.querySelector('.dropdown-value').textContent = getLabel();
      refreshViews();
      return;
    }
    const checkbox = e.target.closest('input[data-tag]');
    if (checkbox) {
      checkbox.checked ? enabledTags.add(checkbox.dataset.tag) : enabledTags.delete(checkbox.dataset.tag);
      selectedCategory = null;
      container.querySelector('.dropdown-value').textContent = getLabel();
      refreshViews();
    }
  });
}

function renderCategorySelector() {
  const { categories } = parsedData;
  const container = document.getElementById('category-selector');

  const activeCount = categories.length - hiddenCategories.size;
  const label = activeCount === categories.length ? 'All categories' : `${activeCount} of ${categories.length} categories`;

  container.innerHTML = `
    <div class="dropdown">
      <button class="dropdown-toggle">
        <span class="filter-label">Categories</span>
        <span class="dropdown-value">${label}</span>
      </button>
      <div class="dropdown-menu">
        <div class="dropdown-item toggle-all" data-action="all">Select all</div>
        <div class="dropdown-item toggle-all" data-action="none">Select none</div>
        <div class="dropdown-divider"></div>
        ${categories.map(cat => {
          const checked = !hiddenCategories.has(cat);
          return `<label class="dropdown-item"><input type="checkbox" ${checked ? 'checked' : ''} data-cat="${cat}"> ${cat}</label>`;
        }).join('')}
      </div>
    </div>`;

  function updateLabel() {
    const ac = categories.length - hiddenCategories.size;
    container.querySelector('.dropdown-value').textContent =
      ac === categories.length ? 'All categories' : `${ac} of ${categories.length} categories`;
  }

  setupDropdown(container, (e) => {
    const action = e.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'all') hiddenCategories.clear();
      else categories.forEach(c => hiddenCategories.add(c));
      selectedCategory = null;
      container.querySelectorAll('input[data-cat]').forEach(cb => { cb.checked = !hiddenCategories.has(cb.dataset.cat); });
      updateLabel();
      refreshViews();
      return;
    }
    const checkbox = e.target.closest('input[data-cat]');
    if (checkbox) {
      checkbox.checked ? hiddenCategories.delete(checkbox.dataset.cat) : hiddenCategories.add(checkbox.dataset.cat);
      if (selectedCategory === checkbox.dataset.cat) selectedCategory = null;
      updateLabel();
      refreshViews();
    }
  });
}

// --- Refresh all views ---
function refreshViews() {
  renderDonutChart();
  renderCategoryList();
  renderSummaryStats();
  renderBarChart();
  renderFilteredTable();
}

// --- Init ---
function renderAll(rows, categoryMeta) {
  catMeta = categoryMeta || catMeta;
  parsedData = parseTransactions(rows);
  if (parsedData.months.length === 0) return;
  selectedMonths = new Set([parsedData.months[parsedData.months.length - 1]]);
  selectedCategory = null;
  hiddenCategories = new Set();
  enabledTags = new Set(['__untagged__']);
  renderMonthSelector();
  renderTagSelector();
  renderCategorySelector();
  refreshViews();
}

// --- Tabs ---
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });
}

// --- Filtered transactions helpers ---
function getMonthTagFiltered() {
  return parsedData.transactions.filter(t => {
    if (selectedMonths.size > 0 && !selectedMonths.has(t.monthKey)) return false;
    const tagKey = t.tag || '__untagged__';
    if (!enabledTags.has(tagKey)) return false;
    return true;
  });
}

function getFullyFiltered() {
  return getMonthTagFiltered().filter(t => {
    if (hiddenCategories.has(t.category)) return false;
    if (selectedCategory) {
      // Match if transaction category matches directly OR its parent matches
      const parent = getParentCategory(t.category);
      if (t.category !== selectedCategory && parent !== selectedCategory) return false;
    }
    return true;
  });
}

function getParentCategory(name) {
  const info = catMeta.nameToInfo[name];
  return info ? info.parent : name;
}

// --- Donut Chart ---
function renderDonutChart() {
  const filtered = getMonthTagFiltered();

  if (chartInstance) chartInstance.destroy();

  // Aggregate by parent category
  const parentTotals = {};
  for (const t of filtered) {
    if (hiddenCategories.has(t.category)) continue;
    const parent = getParentCategory(t.category);
    parentTotals[parent] = (parentTotals[parent] || 0) + t.amount;
  }

  const activeCategories = Object.keys(parentTotals)
    .filter(c => parentTotals[c] > 0)
    .sort((a, b) => parentTotals[b] - parentTotals[a]);
  currentActiveCategories = activeCategories;

  const total = activeCategories.reduce((sum, c) => sum + parentTotals[c], 0);
  document.getElementById('donut-label').textContent = 'Total Spending';
  document.getElementById('donut-total').textContent =
    '$' + total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const ctx = document.getElementById('budget-chart').getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: activeCategories,
      datasets: [{
        data: activeCategories.map(c => Math.round(parentTotals[c] * 100) / 100),
        backgroundColor: activeCategories.map((c, i) => {
          const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
          if (selectedCategory && c !== selectedCategory) return color + '40';
          return color;
        }),
        borderWidth: 2,
        borderColor: '#fff',
        hoverBorderWidth: 2,
        hoverBorderColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      cutout: '65%',
      onClick: (event, elements) => {
        if (elements.length === 0) {
          selectedCategory = null;
        } else {
          const idx = elements[0].index;
          const clickedCat = activeCategories[idx];
          selectedCategory = selectedCategory === clickedCat ? null : clickedCat;
        }
        updateDonutSelection(activeCategories);
        renderCategoryList();
        renderFilteredTable();
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#232b3e',
          titleFont: { family: 'DM Sans', weight: '600' },
          bodyFont: { family: 'DM Sans' },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed;
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((val / total) * 100).toFixed(1);
              return ` ${ctx.label}: $${val.toFixed(2)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function updateDonutSelection(activeCategories) {
  if (!chartInstance) return;
  const ds = chartInstance.data.datasets[0];
  ds.backgroundColor = activeCategories.map((c, i) => {
    const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
    if (selectedCategory && c !== selectedCategory) return color + '40';
    return color;
  });
  chartInstance.update('none');
}

// --- Category List ---
function renderCategoryList() {
  const container = document.getElementById('category-list');
  const filtered = getMonthTagFiltered().filter(t => !hiddenCategories.has(t.category));

  // Build parent → subcategory totals
  const parentTotals = {};
  const subTotals = {}; // { parent: { subName: amount } }
  for (const t of filtered) {
    const parent = getParentCategory(t.category);
    parentTotals[parent] = (parentTotals[parent] || 0) + t.amount;
    if (!subTotals[parent]) subTotals[parent] = {};
    subTotals[parent][t.category] = (subTotals[parent][t.category] || 0) + t.amount;
  }

  const total = Object.values(parentTotals).reduce((a, b) => a + b, 0);
  const sortedParents = Object.entries(parentTotals)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  let html = `<div class="category-list-header">
    <span>Categories</span>
    <span>Total Spending</span>
  </div>`;

  const fmtAmt = (v) => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  sortedParents.forEach(([parent, amount]) => {
    const pct = total > 0 ? ((amount / total) * 100).toFixed(0) : 0;
    const colorIdx = currentActiveCategories.indexOf(parent);
    const color = CATEGORY_COLORS[colorIdx >= 0 ? colorIdx % CATEGORY_COLORS.length : 0];
    const isSelected = selectedCategory === parent;
    const isDimmed = selectedCategory && !isSelected;
    const classes = ['category-row'];
    if (isSelected) classes.push('selected');
    if (isDimmed) classes.push('dimmed');
    html += `<div class="${classes.join(' ')}" data-cat="${parent}">
      <div class="category-dot" style="background: ${color}"></div>
      <span class="category-name">${parent}</span>
      <span class="category-amount">${fmtAmt(amount)} (${pct}%)</span>
    </div>`;

    // Render subcategories if there are multiple distinct names under this parent
    const subs = Object.entries(subTotals[parent] || {})
      .filter(([name]) => name !== parent) // don't show parent as its own sub
      .sort((a, b) => b[1] - a[1]);

    if (subs.length > 0) {
      subs.forEach(([subName, subAmt]) => {
        const subPct = total > 0 ? ((subAmt / total) * 100).toFixed(0) : 0;
        const subClasses = ['category-row', 'subcategory-row'];
        if (isDimmed) subClasses.push('dimmed');

        html += `<div class="${subClasses.join(' ')}" data-cat="${subName}">
          <span class="category-name">${subName}</span>
          <span class="category-amount">${fmtAmt(subAmt)} (${subPct}%)</span>
        </div>`;
      });
    }
  });

  container.innerHTML = html;

  // Click to select/deselect category (parent or sub)
  container.querySelectorAll('.category-row').forEach(row => {
    row.addEventListener('click', () => {
      const cat = row.dataset.cat;
      selectedCategory = selectedCategory === cat ? null : cat;
      updateDonutSelection(currentActiveCategories);
      renderCategoryList();
      renderFilteredTable();
    });
  });
}

// --- Summary Stats ---
function renderSummaryStats() {
  const container = document.getElementById('summary-stats');
  const filtered = getMonthTagFiltered().filter(t => !hiddenCategories.has(t.category));

  const expenses = filtered.filter(t => t.amount > 0);
  const totalSpent = expenses.reduce((sum, t) => sum + t.amount, 0);

  // Count unique months
  const monthsSet = new Set(expenses.map(t => t.monthKey));
  const numMonths = monthsSet.size || 1;

  // Count unique days
  const daysSet = new Set(filtered.map(t => {
    const row = t.row;
    return row[0]; // Transaction Date
  }));
  const numDays = daysSet.size || 1;

  const avgMonthly = totalSpent / numMonths;
  const avgDaily = totalSpent / numDays;

  const fmt = (v) => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Spending</div>
      <div class="stat-value">${fmt(totalSpent)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg Monthly Spending</div>
      <div class="stat-value">${fmt(avgMonthly)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg Daily Spending</div>
      <div class="stat-value">${fmt(avgDaily)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Transactions</div>
      <div class="stat-value">${expenses.length}</div>
    </div>
  `;
}

// --- Bar Chart ---
function renderBarChart() {
  const { months, displayMonths, transactions } = parsedData;

  if (barChartInstance) barChartInstance.destroy();

  const filtered = transactions.filter(t => {
    const tagKey = t.tag || '__untagged__';
    if (!enabledTags.has(tagKey)) return false;
    if (hiddenCategories.has(t.category)) return false;
    return true;
  });

  const monthlyTotals = {};
  for (const t of filtered) {
    monthlyTotals[t.monthKey] = (monthlyTotals[t.monthKey] || 0) + t.amount;
  }

  const data = months.map(m => Math.round((monthlyTotals[m] || 0) * 100) / 100);
  const barColors = months.map(m =>
    selectedMonths.size === 0 || selectedMonths.has(m) ? '#4a82c5' : '#d9e1e8'
  );

  const ctx = document.getElementById('monthly-bar-chart').getContext('2d');
  barChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: displayMonths,
      datasets: [{ data, backgroundColor: barColors, borderRadius: 6, borderSkipped: false }],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: 'Monthly Spending',
          font: { size: 15, weight: '600', family: 'DM Sans' },
          color: '#232b3e',
          padding: { bottom: 16 },
        },
        legend: { display: false },
        tooltip: {
          backgroundColor: '#232b3e',
          titleFont: { family: 'DM Sans', weight: '600' },
          bodyFont: { family: 'DM Sans' },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => `$${ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 12, family: 'DM Sans' }, color: '#6b7a8d' },
        },
        y: {
          grid: { color: '#edf2f7' },
          ticks: {
            font: { size: 12, family: 'DM Sans' },
            color: '#6b7a8d',
            callback: (val) => '$' + val.toLocaleString(),
          },
        },
      },
    },
  });
}

// --- Transactions Table ---
function renderFilteredTable() {
  const container = document.getElementById('data-container');
  const headers = rawRows[0];
  const filtered = getFullyFiltered();

  if (filtered.length === 0) {
    container.innerHTML = '<p style="padding: 24px; color: #6b7a8d;">No transactions match the current filters.</p>';
    return;
  }

  let filterSummary = '';
  if (selectedCategory) {
    filterSummary = `<div id="category-filter-badge">
      <span>Category: ${selectedCategory}</span>
      <button onclick="selectedCategory = null; updateDonutSelection(currentActiveCategories); renderCategoryList(); renderFilteredTable();">&times;</button>
    </div>`;
  }

  const table = document.createElement('table');
  table.id = 'data-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const cell of headers) {
    const th = document.createElement('th');
    th.textContent = cell;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const t of filtered) {
    const tr = document.createElement('tr');
    for (let j = 0; j < headers.length; j++) {
      const td = document.createElement('td');
      td.textContent = t.row[j] || '';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  container.innerHTML = filterSummary;
  container.appendChild(table);
}

// --- Init ---
window.onload = () => {
  initGoogleAuth();
  initTabs();
  const savedToken = sessionStorage.getItem('access_token');
  if (savedToken) {
    accessToken = savedToken;
    showAppSection();
  }
};
