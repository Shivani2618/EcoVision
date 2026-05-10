/* ============================================================
   ECOVISION v2.0 — Dashboard JavaScript
   Auto-refresh every 4s, Chart.js visualizations
   ============================================================ */

let _bar = null, _line = null, _donut = null;
let _autoRefreshInterval = null;

const CAT_COLORS = {
  Plastic:'#00ff88', Paper:'#f59e0b', Organic:'#84cc16',
  Metal:'#94a3b8', Glass:'#00d4ff', 'E-Waste':'#a855f7',
};
const CAT_ICONS = {
  Plastic:'🧴', Paper:'📄', Organic:'🌿', Metal:'🔩', Glass:'🔮', 'E-Waste':'💻',
};
const STREAM_ICONS = {
  Biodegradable:'🌿', Recyclable:'♻️', Hazardous:'⚠️', Residual:'🗑️'
};

// ── Load all dashboard data ───────────────────────────────────
async function loadDashboard() {
  try {
    const [d, recs] = await Promise.all([
      fetch('/api/dashboard').then(r => r.json()),
      fetch('/api/recommendations').then(r => r.json()),
    ]);
    renderBins(d.bins);
    renderStats(d);
    renderCharts(d);
    renderActivity(d.recent);
    renderAlertStrip(d.bins);
    renderRecommendations(recs, d.route_plan);
    updateAIStatus(d.ai_status);
  } catch (e) { console.error('[loadDashboard]', e); }
}

async function loadBins() {
  try {
    const bins = await (await fetch('/api/bins')).json();
    renderBins(bins);
    renderAlertStrip(bins);
  } catch {}
}

async function loadStats() {
  try {
    const d = await (await fetch('/api/dashboard')).json();
    renderStats(d);
  } catch {}
}

// ── Render bin cards ──────────────────────────────────────────
function renderBins(bins) {
  const grid = document.getElementById('bins-grid');
  if (!grid) return;
  if (!bins.length) {
    grid.innerHTML = '<div class="empty"><span>🗑️</span><p>No bin data available</p></div>';
    return;
  }
  grid.innerHTML = bins.map(b => {
    const color = b.status === 'critical' ? '#ff4444' : b.status === 'warning' ? '#f59e0b' : (CAT_COLORS[b.type] || '#00ff88');
    const level = b.level || 0;
    // Determine fill label
    let fillLabel = 'Empty';
    if (level >= 80) fillLabel = 'Almost Full';
    else if (level >= 60) fillLabel = 'Getting Full';
    else if (level >= 30) fillLabel = 'Partially Full';
    else if (level > 0) fillLabel = 'Mostly Empty';

    return `
    <div class="card bin-card ${b.status}">
      <div class="bin-head">
        <div class="bin-id-row">
          <div class="bin-icon-box">${b.icon || CAT_ICONS[b.type] || '♻️'}</div>
          <div class="bin-name-col">
            <div class="bin-name">${b.type}</div>
            <div class="bin-weight">${b.weight_kg || 0} kg total</div>
          </div>
        </div>
        <span class="bin-badge">${b.label}</span>
      </div>
      <div class="bin-body-row">
        <div class="bin-cyl-wrap">
          <div class="bin-cyl-container">
            <div class="bin-cyl-fill-anim" data-level="${level}" style="height:0%;background:${color}44;border-top:2px solid ${color};box-shadow:0 0 8px ${color}44"></div>
            <div class="bin-cyl-inner-label" style="color:${color}">${level}%</div>
          </div>
          <div class="bin-cyl-base" style="background:${color}22;border:1px solid ${color}44"></div>
        </div>
        <div class="bin-right-col">
          <div class="bin-pct-row">
            <div class="bin-pct">${level}<small>%</small></div>
          </div>
          <div class="bin-fill-label" style="color:${color}">${fillLabel}</div>
          <div class="bin-bar-track" style="margin-top:8px">
            <div class="bin-bar-fill" style="width:0%" data-w="${level}"></div>
          </div>
          <div class="bin-footer" style="margin-top:8px">
            <div class="bin-time">Updated ${fmtTime(b.updated)}</div>
            ${b.status === 'critical' ? '<div class="bin-crit-dot"></div>' : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  setTimeout(() => {
    document.querySelectorAll('.bin-bar-fill[data-w]').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
    document.querySelectorAll('.bin-cyl-fill-anim[data-level]').forEach(el => {
      el.style.height = el.dataset.level + '%';
    });
  }, 80);
}

// ── Alert strip ───────────────────────────────────────────────
function renderAlertStrip(bins) {
  const strip = document.getElementById('alert-strip');
  if (!strip) return;
  const flagged = bins.filter(b => b.status !== 'ok');
  if (!flagged.length) { strip.innerHTML = ''; return; }
  strip.innerHTML = flagged.map(b => `
    <div class="al-item al-${b.status}">
      ${b.status === 'critical' ? '🚨' : '⚠️'}
      <strong>${b.icon || '♻️'} ${b.type}</strong> bin at <strong>${b.level}%</strong>
      — ${b.status === 'critical' ? 'Immediate pickup required!' : 'Schedule collection soon'}
    </div>`).join('');
}

// ── Stats ─────────────────────────────────────────────────────
function renderStats(d) {
  setText('stat-total',   d.total);
  setText('stat-conf',    d.avg_conf + '%');
  setText('stat-active',  d.active_bins);
  setText('stat-co2',     (d.co2_saved || 0) + ' kg');
  setText('stat-recycle', (d.recycle_pct || 0) + '%');
  setText('stat-weight',  (d.total_weight || 0) + ' kg');
  setText('chart-total-meta', d.total + ' items');

  const critEl = document.getElementById('stat-critical');
  if (critEl) {
    critEl.textContent = d.critical_count;
    critEl.className = `stat-val ${d.critical_count > 0 ? 'red' : ''}`;
  }
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el && el.tagName !== 'SELECT') el.textContent = v;
}

// ── Charts ────────────────────────────────────────────────────
const tooltipOpts = {
  backgroundColor: '#0a140a', titleColor: '#e2ffe2', bodyColor: '#7aaa7a',
  borderColor: 'rgba(0,255,136,0.15)', borderWidth: 1, padding: 12, cornerRadius: 8,
};
const scaleOpts = {
  x: { ticks:{ color:'#3a5a3a', font:{family:'Fira Code',size:11} }, grid:{ display:false } },
  y: { ticks:{ color:'#3a5a3a', font:{family:'Fira Code',size:11} }, grid:{ color:'rgba(0,255,136,0.04)' }, beginAtZero:true },
};

function renderCharts(d) {
  renderBarChart(d);
  renderLineChart(d);
  renderDonutChart(d);
}

function renderBarChart(d) {
  const ctx  = document.getElementById('bar-chart');
  if (!ctx) return;
  const cats   = d.categories || Object.keys(CAT_COLORS);
  const counts = cats.map(c => d.type_counts[c] || 0);
  const colors = cats.map(c => CAT_COLORS[c] || '#00ff88');
  if (_bar) _bar.destroy();
  _bar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: cats.map(c => (CAT_ICONS[c]||'♻️') + ' ' + c),
      datasets: [{
        data: counts, backgroundColor: colors.map(c => c + '44'),
        borderColor: colors, borderWidth: 2, borderRadius: 10, borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend:{ display:false }, tooltip: tooltipOpts },
      scales: scaleOpts,
    }
  });
}

function renderLineChart(d) {
  const ctx = document.getElementById('line-chart');
  if (!ctx) return;
  const dayMap = {};
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(); dt.setDate(dt.getDate() - i);
    dayMap[dt.toISOString().split('T')[0]] = 0;
  }
  (d.trend || []).forEach(t => { if (t.day in dayMap) dayMap[t.day] = t.count; });
  const dayLabels = Object.keys(dayMap).map(k => new Date(k).toLocaleDateString('en',{weekday:'short'}));

  if (_line) _line.destroy();
  _line = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dayLabels,
      datasets: [{
        label: 'Items/Day', data: Object.values(dayMap),
        borderColor: '#00ff88', backgroundColor: 'rgba(0,255,136,0.06)',
        fill: true, tension: 0.45,
        pointBackgroundColor: '#00ff88', pointBorderColor: '#050a05',
        pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 7,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend:{ display:false }, tooltip: tooltipOpts },
      scales: scaleOpts,
    }
  });
}

function renderDonutChart(d) {
  const ctx = document.getElementById('donut-chart');
  if (!ctx) return;
  const cats   = Object.keys(d.type_counts || {});
  const counts = cats.map(c => d.type_counts[c] || 0);
  const colors = cats.map(c => CAT_COLORS[c] || '#00ff88');
  if (_donut) _donut.destroy();
  _donut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: cats.map(c => (CAT_ICONS[c]||'♻️') + ' ' + c),
      datasets: [{
        data: counts, backgroundColor: colors.map(c => c + '88'),
        borderColor: colors, borderWidth: 2, hoverOffset: 8,
      }]
    },
    options: {
      responsive: true, cutout: '60%',
      plugins: {
        legend: { display: true, position: 'right', labels:{ color:'#7aaa7a', font:{family:'Fira Code',size:11}, padding:12 }},
        tooltip: tooltipOpts,
      }
    }
  });
}

// ── Recommendations ───────────────────────────────────────────
function renderRecommendations(recs, routePlan) {
  const el = document.getElementById('rec-list');
  const summary = document.getElementById('route-summary');
  if (!el) return;
  if (summary) {
    if (routePlan && routePlan.stops && routePlan.stops.length) {
      summary.textContent = `Optimized route: ${routePlan.stops.length} priority stops · ${routePlan.distance_km} km · approx ${routePlan.est_minutes} min`;
    } else {
      summary.textContent = 'No urgent route optimization needed right now.';
    }
  }
  if (!recs.length) {
    el.innerHTML = '<div class="empty"><span>🤖</span><p>No recommendations. All bins normal.</p></div>';
    return;
  }
  el.innerHTML = recs.slice(0, 6).map((r, i) => `
    <div class="rec-item ${r.status}">
      <div class="rec-rank">${i + 1}</div>
      <div class="rec-body">
        <div class="rec-name">${r.name} <span style="font-size:10px;color:var(--text-3)">${r.zone}</span></div>
        <div class="rec-reason">${r.reason}</div>
        <div class="rec-action">→ ${r.action}</div>
      </div>
      <div class="rec-meta">
        <span class="rec-pct">${r.max_level}%</span>
        <div class="rec-zone">${r.total_weight} kg · ETA ${r.pickup_eta_min || '--'} min</div>
        ${r.status === 'critical' ? '<span class="urgent-tag">URGENT</span>' : ''}
      </div>
    </div>`).join('');
}

// ── Activity feed ─────────────────────────────────────────────
function renderActivity(items) {
  const el = document.getElementById('activity-list');
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = '<div class="empty"><span>📭</span><p>No activity yet. Upload an image!</p></div>';
    return;
  }
  const LOC = {'B001':'New Market','B002':'MP Nagar','B003':'Habibganj','B004':'Kolar Road','B005':'Bairagarh','B006':'Lalghati'};
  el.innerHTML = items.map(r => `
    <div class="activity-item">
      <div class="activity-dot" style="background:${CAT_COLORS[r.waste_type]||'#00ff88'};box-shadow:0 0 6px ${CAT_COLORS[r.waste_type]||'#00ff88'}"></div>
      <span style="font-size:18px">${r.icon || CAT_ICONS[r.waste_type] || '♻️'}</span>
      <div class="flex-1">
        <div class="activity-type">${r.waste_type}</div>
        <div class="activity-time">${fmtDateTime(r.timestamp)} · ${LOC[r.bin_id]||r.bin_id||''}</div>
      </div>
      <span class="conf-tag ${r.confidence >= 85 ? 'conf-hi' : r.confidence >= 70 ? 'conf-md' : 'conf-lo'}">${r.confidence}%</span>
    </div>`).join('');
}

// ── AI status ─────────────────────────────────────────────────
function updateAIStatus(status) {
  document.querySelectorAll('.ai-status-text').forEach(el => el.textContent = status || '');
}

// ── Auto-refresh ──────────────────────────────────────────────
function startAutoRefresh() {
  if (_autoRefreshInterval) clearInterval(_autoRefreshInterval);
  _autoRefreshInterval = setInterval(() => {
    loadBins();
    refreshAlertBell();
  }, 4000);
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  startAutoRefresh();
});
