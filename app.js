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

  // Auto-load the configured sheet
  if (CONFIG.DEFAULT_SHEET_ID) {
    loadSheet();
  }
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
  el.style.display = 'none';
  el.textContent = '';
}

async function loadSheet() {
  const sheetId = CONFIG.DEFAULT_SHEET_ID;
  if (!sheetId) {
    showStatus('No sheet ID configured. Set DEFAULT_SHEET_ID in config.js.', 'error');
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
        showStatus('Access denied. You do not have permission to view this sheet, or it does not exist.', 'error');
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
    hideStatus();
    const rows = data.values || [];
    rawRows = rows;
    renderChart(rows);
  } catch (err) {
    showStatus('Network error: ' + err.message, 'error');
  }
}

let chartInstance = null;
let barChartInstance = null;
let parsedData = null;
let rawRows = null;
let selectedMonth = 'all';
let selectedCategory = null; // null = all categories
let currentActiveCategories = [];
let hiddenCategories = new Set();
// Set of enabled tags (including '__untagged__' for transactions with no tag)
let enabledTags = new Set();

// Disable all Chart.js animations globally
try {
  Chart.defaults.animation = false;
} catch (e) { /* ignore */ }

const CATEGORY_COLORS = [
  '#56a0d8', '#4ecdc4', '#f7b731', '#e77f67', '#778beb',
  '#63cdda', '#cf6a87', '#786fa6', '#f3a683', '#3dc1d3',
  '#e15f41', '#c44569', '#574b90', '#f78fb3', '#0fb9b1',
  '#a29bfe', '#ffeaa7', '#dfe6e9', '#b8e994', '#6c5ce7',
];

function parseTransactions(rows) {
  if (rows.length < 2) return { transactions: [], months: [], displayMonths: [], categories: [], tags: [] };

  const headers = rows[0].map(h => h.trim());
  const dateIdx = headers.indexOf('Transaction Date');
  const debitIdx = headers.indexOf('Debit');
  const catIdx = headers.indexOf('Category v2');
  const tagIdx = headers.indexOf('Tags');

  const transactions = [];
  const monthSet = new Set();
  const categorySet = new Set();
  const tagSet = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateStr = row[dateIdx];
    const debit = parseFloat(row[debitIdx]);
    const category = row[catIdx]?.trim();
    const tag = row[tagIdx]?.trim() || '';

    if (!dateStr || isNaN(debit) || !category) continue;

    // Support both MM/DD/YYYY and YYYY-MM-DD
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

    transactions.push({ monthKey, category, debit, tag, row });
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

function renderMonthSelector() {
  const { months, displayMonths } = parsedData;
  const container = document.getElementById('month-selector');

  const buttons = [{ key: 'all', label: 'All' }];
  months.forEach((m, i) => buttons.push({ key: m, label: displayMonths[i] }));

  container.innerHTML = '<span class="filter-label">Month</span>' + buttons.map(b =>
    `<button class="month-btn${b.key === selectedMonth ? ' active' : ''}" data-month="${b.key}">${b.label}</button>`
  ).join('');

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.month-btn');
    if (!btn) return;
    selectedMonth = btn.dataset.month;
    container.querySelectorAll('.month-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedCategory = null;
    renderPieChart();
    renderBarChart();
    renderFilteredTable();
  });
}

function renderTagSelector() {
  const { tags } = parsedData;
  const container = document.getElementById('tag-selector');

  if (tags.length === 0) {
    container.innerHTML = '';
    return;
  }

  const allKeys = ['__untagged__', ...tags];

  function render() {
    let html = '<span class="filter-label">Tags:</span>';
    html += `<button class="tag-btn${enabledTags.has('__untagged__') ? ' active' : ''}" data-tag="__untagged__">Untagged</button>`;
    for (const tag of tags) {
      html += `<button class="tag-btn${enabledTags.has(tag) ? ' active' : ''}" data-tag="${tag}">${tag}</button>`;
    }
    container.innerHTML = html;
  }

  render();

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.tag-btn');
    if (!btn) return;
    const tag = btn.dataset.tag;

    if (enabledTags.has(tag)) {
      enabledTags.delete(tag);
    } else {
      enabledTags.add(tag);
    }

    render();
    selectedCategory = null;
    renderPieChart();
    renderBarChart();
    renderFilteredTable();
  });
}

function renderCategorySelector() {
  const { categories } = parsedData;
  const container = document.getElementById('category-selector');

  function render() {
    let html = '<span class="filter-label">Categories</span>';
    for (const cat of categories) {
      const hidden = hiddenCategories.has(cat);
      html += `<button class="tag-btn${hidden ? '' : ' active'}" data-cat="${cat}">${cat}</button>`;
    }
    container.innerHTML = html;
  }

  render();

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.tag-btn');
    if (!btn) return;
    const cat = btn.dataset.cat;

    if (hiddenCategories.has(cat)) {
      hiddenCategories.delete(cat);
    } else {
      hiddenCategories.add(cat);
    }

    if (selectedCategory === cat) selectedCategory = null;
    render();
    renderPieChart();
    renderBarChart();
    renderFilteredTable();
  });
}

function renderChart(rows) {
  parsedData = parseTransactions(rows);
  if (parsedData.months.length === 0) return;
  selectedMonth = 'all';
  selectedCategory = null;
  hiddenCategories = new Set();
  // All tags enabled by default (untagged + all named tags)
  enabledTags = new Set(['__untagged__', ...parsedData.tags]);
  renderMonthSelector();
  renderTagSelector();
  renderCategorySelector();
  renderPieChart();
  renderBarChart();
  renderFilteredTable();
}

function updatePieChartSelection(activeCategories) {
  if (!chartInstance) return;
  const ds = chartInstance.data.datasets[0];
  ds.backgroundColor = activeCategories.map((c, i) => {
    const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
    if (selectedCategory && c !== selectedCategory) return color + '40';
    return color;
  });
  chartInstance.update('none'); // 'none' disables animation
}

function renderPieChart() {
  const { months, transactions } = parsedData;

  if (chartInstance) {
    chartInstance.destroy();
  }

  // Filter transactions by month and tags
  const filtered = transactions.filter(t => {
    if (selectedMonth !== 'all' && t.monthKey !== selectedMonth) return false;
    const tagKey = t.tag || '__untagged__';
    if (!enabledTags.has(tagKey)) return false;
    return true;
  });

  // Aggregate totals per category
  const categoryTotals = {};
  for (const t of filtered) {
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.debit;
  }

  // Only show categories with non-zero totals, exclude hidden, sorted by amount
  const activeCategories = parsedData.categories
    .filter(c => categoryTotals[c] > 0 && !hiddenCategories.has(c))
    .sort((a, b) => categoryTotals[b] - categoryTotals[a]);
  currentActiveCategories = activeCategories;

  const titleMonth = selectedMonth === 'all'
    ? 'All Months'
    : parsedData.displayMonths[months.indexOf(selectedMonth)];

  const ctx = document.getElementById('budget-chart').getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: activeCategories,
      datasets: [{
        data: activeCategories.map(c => Math.round(categoryTotals[c] * 100) / 100),
        backgroundColor: activeCategories.map((c, i) => {
          const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
          if (selectedCategory && c !== selectedCategory) return color + '40'; // dim unselected
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
      onClick: (event, elements) => {
        if (elements.length === 0) {
          selectedCategory = null;
        } else {
          const idx = elements[0].index;
          const clickedCat = activeCategories[idx];
          selectedCategory = selectedCategory === clickedCat ? null : clickedCat;
        }
        updatePieChartSelection(activeCategories);
        renderFilteredTable();
      },
      plugins: {
        title: {
          display: true,
          text: `Spending by Category — ${titleMonth}`,
          font: { size: 15, weight: '600', family: 'Inter' },
          color: '#232b3e',
          padding: { bottom: 16 },
        },
        legend: {
          position: 'right',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            padding: 14,
            usePointStyle: true,
            pointStyle: 'circle',
            font: { size: 12, family: 'Inter' },
            color: '#3d4a5c',
          },
        },
        tooltip: {
          backgroundColor: '#232b3e',
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont: { family: 'Inter' },
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

function renderBarChart() {
  const { months, displayMonths, transactions } = parsedData;

  if (barChartInstance) {
    barChartInstance.destroy();
  }

  // Filter transactions by tags and hidden categories (show all months)
  const filtered = transactions.filter(t => {
    const tagKey = t.tag || '__untagged__';
    if (!enabledTags.has(tagKey)) return false;
    if (hiddenCategories.has(t.category)) return false;
    return true;
  });

  // Aggregate totals per month
  const monthlyTotals = {};
  for (const t of filtered) {
    monthlyTotals[t.monthKey] = (monthlyTotals[t.monthKey] || 0) + t.debit;
  }

  const data = months.map(m => Math.round((monthlyTotals[m] || 0) * 100) / 100);

  // Highlight selected month
  const barColors = months.map(m =>
    selectedMonth === 'all' || m === selectedMonth ? '#56a0d8' : '#d9e1e8'
  );

  const ctx = document.getElementById('monthly-bar-chart').getContext('2d');
  barChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: displayMonths,
      datasets: [{
        data,
        backgroundColor: barColors,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: 'Monthly Total Expenses',
          font: { size: 15, weight: '600', family: 'Inter' },
          color: '#232b3e',
          padding: { bottom: 16 },
        },
        legend: { display: false },
        tooltip: {
          backgroundColor: '#232b3e',
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont: { family: 'Inter' },
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
          ticks: {
            font: { size: 12, family: 'Inter' },
            color: '#6b7a8d',
          },
        },
        y: {
          grid: { color: '#edf2f7' },
          ticks: {
            font: { size: 12, family: 'Inter' },
            color: '#6b7a8d',
            callback: (val) => '$' + val.toLocaleString(),
          },
        },
      },
    },
  });
}

function getFilteredTransactions() {
  return parsedData.transactions.filter(t => {
    if (selectedMonth !== 'all' && t.monthKey !== selectedMonth) return false;
    const tagKey = t.tag || '__untagged__';
    if (!enabledTags.has(tagKey)) return false;
    if (selectedCategory && t.category !== selectedCategory) return false;
    if (hiddenCategories.has(t.category)) return false;
    return true;
  });
}

function renderFilteredTable() {
  const container = document.getElementById('data-container');
  const headers = rawRows[0];
  const filtered = getFilteredTransactions();

  if (filtered.length === 0) {
    container.innerHTML = '<p style="padding: 24px; color: #6b7a8d;">No transactions match the current filters.</p>';
    return;
  }

  // Show active filter summary
  let filterSummary = '';
  if (selectedCategory) {
    filterSummary = `<div id="category-filter-badge">
      <span>Category: ${selectedCategory}</span>
      <button onclick="selectedCategory = null; updatePieChartSelection(currentActiveCategories); renderFilteredTable();">&times;</button>
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

// Initialize when GIS library loads
window.onload = () => {
  initGoogleAuth();

  // Restore session if token exists
  const savedToken = sessionStorage.getItem('access_token');
  if (savedToken) {
    accessToken = savedToken;
    showAppSection();
  }
};
