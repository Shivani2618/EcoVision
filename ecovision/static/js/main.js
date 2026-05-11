/* ============================================================
   ECOVISION — Main JavaScript
   Upload, classify, toast, sidebar, alert bell
   ============================================================ */

window.addEventListener('load', () => {
  setTimeout(() => document.getElementById('page-loader')?.classList.add('hide'), 900);
});

const _bootAt = Date.now();
window.evSelectedLocation = 'B001';
window.evInputMode = 'ai';
window.LOCATION_NAMES = {
  B001: 'New Market',
  B002: 'MP Nagar',
  B003: 'Habibganj',
  B004: 'Kolar Road',
  B005: 'Bairagarh',
  B006: 'Lalghati'
};
const _loaderMessages = [
  'Initializing sensors...',
  'Syncing live bins...',
  'Loading waste classifier...',
  'Preparing dashboard...',
];

function openSidebar() {
  document.getElementById('sidebar')?.classList.add('open');
  document.getElementById('sb-overlay')?.classList.add('on');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sb-overlay')?.classList.remove('on');
}

function setActiveNav() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.remove('active');
    const href = a.getAttribute('href');
    if (href === path || (path === '/' && href === '/dashboard')) a.classList.add('active');
  });
}

function startShellStatus() {
  const loader = document.getElementById('loader-status');
  if (loader) {
    let i = 0;
    const tick = () => {
      loader.textContent = _loaderMessages[i % _loaderMessages.length];
      i += 1;
    };
    tick();
    setInterval(tick, 350);
  }

  const uptimeEl = document.getElementById('sb-uptime');
  const binsEl = document.getElementById('sb-bins');
  const updateUptime = () => {
    if (!uptimeEl) return;
    const total = Math.floor((Date.now() - _bootAt) / 1000);
    const mins = Math.floor(total / 60);
    const secs = String(total % 60).padStart(2, '0');
    uptimeEl.textContent = `${mins}:${secs}`;
  };
  updateUptime();
  setInterval(updateUptime, 1000);

  if (binsEl) {
    binsEl.textContent = '6';
  }
}

// ── Toast ─────────────────────────────────────────────────────
function toast(title, sub='', icon='♻️', type='', dur=4500) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="t-icon">${icon}</span>
    <div class="t-body">
      <div class="t-title">${title}</div>
      ${sub ? `<div class="t-sub">${sub}</div>` : ''}
    </div>
    <button class="t-close" onclick="this.parentElement.remove()">✕</button>`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, dur);
}

// ── Drag & drop ───────────────────────────────────────────────
function initDrop() {
  const zone = document.getElementById('drop-zone');
  const inp  = document.getElementById('file-input');
  if (!zone) return;
  zone.addEventListener('click', () => inp.click());
  ['dragover','dragenter'].forEach(e => zone.addEventListener(e, ev => { ev.preventDefault(); zone.classList.add('over'); }));
  ['dragleave','dragend' ].forEach(e => zone.addEventListener(e, () => zone.classList.remove('over')));
  zone.addEventListener('drop', ev => {
    ev.preventDefault(); zone.classList.remove('over');
    const f = ev.dataTransfer.files[0];
    f?.type.startsWith('image/') ? setFile(f) : toast('Invalid file', 'Please upload an image.', '❌');
  });
  inp.addEventListener('change', () => inp.files[0] && setFile(inp.files[0]));
}

function setFile(f) {
  window._uploadFile = f;
  const r = new FileReader();
  r.onload = e => {
    document.getElementById('preview-img').src = e.target.result;
    document.getElementById('preview-wrap').style.display = 'block';
    document.getElementById('preview-name').textContent = f.name;
    
    // Auto-trigger classification for a smoother experience
    classifyWaste();
  };
  r.readAsDataURL(f);
  document.getElementById('classify-btn').disabled = false;
}

// ── Classify ──────────────────────────────────────────────────
async function classifyWaste() {
  if (!window._uploadFile) { toast('No image', 'Please select an image first.', '⚠️'); return; }
  const btn = document.getElementById('classify-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="btn-spinner"></div> Analyzing…';

  try {
    const fd = new FormData();
    fd.append('image', window._uploadFile);
    fd.append('location_id', window.evSelectedLocation || 'B001');
    fd.append('input_mode', window.evInputMode || 'ai');
    const wasteTypeHintEl = document.getElementById('waste-type-hint');
    if (wasteTypeHintEl?.value) fd.append('waste_type_hint', wasteTypeHintEl.value);
    const res  = await fetch('/api/classify', { method: 'POST', body: fd });
    
    if (!res.ok) {
      const text = await res.text();
      if (text.includes('<html')) throw new Error(`Server Error (${res.status}): The server returned an error page. Check Render logs.`);
      try {
        const errData = JSON.parse(text);
        throw new Error(errData.error || 'Classification failed');
      } catch {
        throw new Error(`Server Error (${res.status}): ${text.substring(0, 100)}`);
      }
    }
    
    const data = await res.json();

    // Handle invalid/blank detection
    if (data.waste_type === 'Uncertain') {
      toast('Uncertain Detection', 'No clear waste object found. Please try a clearer image.', '⚠️');
      document.getElementById('res-type').textContent = 'Uncertain';
      document.getElementById('res-detected-obj').textContent = 'Object: None';
      document.getElementById('res-explanation').textContent = data.explanation;
      document.getElementById('result-box').style.display = 'block';
    } else {
      toast(`${data.waste_type} Detected`, `Object: ${data.object || data.waste_type} · Confidence: ${data.confidence}%`, data.icon);
    }

    if (typeof displayResult === 'function') displayResult(data);

    if (data.alert) {
      setTimeout(() => toast(
        `🚨 ${data.waste_type} Bin CRITICAL!`,
        `Now at ${data.bin_level}% — immediate pickup required`,
        '🚨', 'crit-toast', 8000
      ), 600);
    }

    refreshAlertBell();

    if (data.waste_type && !['No Waste Detected','Unknown','Prediction Error'].includes(data.waste_type)) {
      localStorage.setItem('ev-last', JSON.stringify({
        type: data.waste_type, icon: data.icon, conf: data.confidence, time: data.timestamp
      }));
      renderLastUpload();
    }
  } catch (e) {
    toast('Error', e.message || 'Upload failed. Try again.', '❌');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>🔍</span> Classify Waste';
  }
}

function displayResult(d) {
  if (d.waste_type === 'Uncertain') return; // Handled in classifyWaste
  document.getElementById('res-icon').textContent     = d.icon || '❓';
  document.getElementById('res-type').textContent     = d.waste_type;
  document.getElementById('res-detected-obj').textContent = `Object: ${d.object || d.waste_type || 'None'}`;

  const pctEl = document.getElementById('res-conf-pct');
  if (pctEl) pctEl.textContent = d.confidence ? d.confidence + '%' : '';

  const pct2El = document.getElementById('res-conf-pct2');
  if (pct2El) pct2El.textContent = d.confidence ? d.confidence + '%' : '—';

  const msgEl = document.getElementById('res-conf-msg');
  if (msgEl) msgEl.textContent = d.conf_msg || '';

  const explanationEl = document.getElementById('res-explanation');
  if (explanationEl) explanationEl.textContent = d.explanation || 'AI classification complete.';

  setTimeout(() => {
    const fill = document.getElementById('res-conf-fill');
    if (fill) fill.style.width = (d.confidence||0) + '%';
  }, 60);

  const badge = document.getElementById('res-badge');
  if (badge) {
    const cls = { ok:'conf-hi', warning:'conf-md', critical:'conf-lo' }[d.bin_status] || '';
    badge.textContent = d.bin_label || '';
    badge.className   = `bin-status-badge ${cls}`;
  }

  const binRow = document.getElementById('res-bin-row');
  if (binRow) {
    if (d.bin_level !== null && d.bin_level !== undefined) {
      binRow.style.display = 'flex';
      document.getElementById('res-bin-val').textContent = d.bin_level + '%';
    } else {
      binRow.style.display = 'none';
    }
  }

  const binValEl = document.getElementById('res-bin-val');
  if (binValEl && d.bin_level !== null && d.bin_level !== undefined) {
    binValEl.textContent = `${d.bin_level}%`;
  }
  // Animate bin fill bar
  const fillBar = document.getElementById('res-bin-fill-bar');
  const fillLabel = document.getElementById('res-bin-status-label');
  if (fillBar && d.bin_level !== null && d.bin_level !== undefined) {
    const lvl = d.bin_level;
    const barColor = lvl >= 80 ? '#ff4444' : lvl >= 70 ? '#f59e0b' : '#00ff88';
    const statusText = lvl >= 80 ? 'Critical — Pickup Now!' : lvl >= 70 ? 'Warning — Schedule Soon' : lvl >= 50 ? 'Getting Full' : lvl >= 20 ? 'Partially Full' : 'Mostly Empty';
    setTimeout(() => {
      fillBar.style.width = lvl + '%';
      fillBar.style.background = barColor;
      fillBar.style.boxShadow = `0 0 10px ${barColor}`;
    }, 100);
    if (fillLabel) { fillLabel.textContent = statusText; fillLabel.style.color = barColor; }
    if (binValEl) binValEl.style.color = barColor;
  }
  const co2El = document.getElementById('res-co2');
  if (co2El) co2El.textContent = `${d.co2_saved || 0} kg`;
  const statusEl = document.getElementById('res-status-val');
  if (statusEl) statusEl.textContent = d.bin_label || '—';
  const locationEl = document.getElementById('res-location');
  if (locationEl) locationEl.textContent = (window.LOCATION_NAMES && window.LOCATION_NAMES[d.location_id]) || d.location_id || '—';
  const recyclableEl = document.getElementById('res-recyclable');
  if (recyclableEl) {
    recyclableEl.textContent = d.recyclable ? '♻️ Recyclable' : '🚫 Non-recyclable';
    recyclableEl.className = `res-recyclable ${d.recyclable ? 'recyclable-yes' : 'recyclable-no'}`;
  }
  const streamEl = document.getElementById('res-stream');
  if (streamEl) streamEl.textContent = `Waste Stream: ${d.stream_icon || '♻️'} ${d.waste_stream || '—'}`;
  const streamValEl = document.getElementById('res-stream-val');
  if (streamValEl) streamValEl.textContent = d.waste_stream || '—';
  const streamActionEl = document.getElementById('res-stream-action');
  if (streamActionEl) streamActionEl.textContent = d.stream_action || '';

  const box = document.getElementById('result-box');
  if (box) {
    box.style.display = 'block';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function resetUpload() {
  window._uploadFile = null;
  const fi = document.getElementById('file-input');
  if (fi) fi.value = '';
  const pw = document.getElementById('preview-wrap');
  if (pw) pw.style.display = 'none';
  const rb = document.getElementById('result-box');
  if (rb) rb.style.display = 'none';
  const cb = document.getElementById('classify-btn');
  if (cb) cb.disabled = true;
  const fill = document.getElementById('res-conf-fill');
  if (fill) fill.style.width = '0%';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Last upload sidebar ───────────────────────────────────────
function renderLastUpload() {
  const saved = localStorage.getItem('ev-last');
  if (!saved) return;
  try {
    const d  = JSON.parse(saved);
    const el = document.getElementById('last-upload');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `
      <div class="nav-label" style="padding-top:0">LAST SCAN</div>
      <div style="font-size:12px;background:var(--bg-4);border-radius:7px;border:1px solid var(--border);padding:9px 11px">
        <span style="font-size:18px">${d.icon}</span>
        <span style="font-weight:600;margin-left:7px">${d.type}</span>
        <span style="font-family:var(--mono);color:var(--green);margin-left:7px;font-size:11px">${d.conf}%</span>
        <div style="font-size:10px;color:var(--text-3);margin-top:3px;font-family:var(--mono)">${d.time}</div>
      </div>`;
  } catch {}
}

// ── Alert bell ────────────────────────────────────────────────
async function refreshAlertBell() {
  try {
    const alerts    = await (await fetch('/api/alerts')).json();
    const criticals = alerts.filter(a => a.status === 'critical').length;
    const total     = alerts.length;
    document.querySelectorAll('.notif-count').forEach(el => {
      el.textContent = total;
      el.classList.toggle('on', total > 0);
    });
    document.querySelectorAll('.nav-badge').forEach(b => {
      b.textContent = criticals;
      b.classList.toggle('on', criticals > 0);
    });
  } catch {}
}

// ── Shared actions ────────────────────────────────────────────
async function resetBins() {
  if (!confirm('Reset all bin levels to 0%? This cannot be undone.')) return;
  const r = await fetch('/api/reset-bins', { method: 'POST' });
  const d = await r.json();
  toast('Bins Reset ✅', d.message, '🔄');
  refreshAlertBell();
  if (typeof loadBins   === 'function') loadBins();
  if (typeof loadStats  === 'function') loadStats();
  if (typeof loadAlerts === 'function') loadAlerts();
}

function exportCSV() {
  window.location.href = '/api/export-csv';
  toast('Exporting Data', 'CSV download starting…', '📥');
}

async function addDemo() {
  const r = await fetch('/api/demo', { method: 'POST' });
  const d = await r.json();
  toast('Demo Data Added', d.message, '🎲');
  refreshAlertBell();
  if (typeof loadBins   === 'function') loadBins();
  if (typeof loadStats  === 'function') loadStats();
  if (typeof loadAlerts === 'function') loadAlerts();
}

// ── Formatters ────────────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'}); } catch { return ts; }
}
function fmtDateTime(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return ts; }
}

function initUploadControls() {
  const locationButtons = document.querySelectorAll('.loc-btn');
  if (locationButtons.length) {
    locationButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        locationButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        window.evSelectedLocation = btn.dataset.loc || 'B001';
      });
    });
  }

  const modeSelect = document.getElementById('input-mode');
  const hintWrap = document.getElementById('waste-hint-wrap');
  const syncModeUi = () => {
    window.evInputMode = modeSelect?.value || 'ai';
    if (hintWrap) hintWrap.style.display = window.evInputMode === 'manual' ? 'block' : 'none';
  };
  if (modeSelect) {
    modeSelect.addEventListener('change', syncModeUi);
    syncModeUi();
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setActiveNav();
  startShellStatus();
  initDrop();
  renderLastUpload();
  refreshAlertBell();
  setInterval(refreshAlertBell, 15000); // keep badge live
  initUploadControls();
  registerServiceWorker();
  document.getElementById('sb-overlay')?.addEventListener('click', closeSidebar);
});
