import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';

import { initStorage } from './src/storage.js';
import { providersRouter } from './src/providers.js';
import { modelsRouter, getAggregatedModels } from './src/models.js';
import { statsRouter, trackRequest } from './src/stats.js';
import { handleProxy } from './src/proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 7860;
const app = express();

app.use(cors({ origin: '*', methods: '*', allowedHeaders: '*', exposedHeaders: '*', credentials: false }));

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── DASHBOARD HTML ──────────────────────────────────────
const DASH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Proxy Gateway</title>
<link rel="stylesheet" href="/dashboard.css">
</head>
<body>

<!--LUMIVERSE_HTML_ISLAND_0-->

<script src="/dashboard.js"></script>
</body>
</html>`;

// ── DASHBOARD CSS ───────────────────────────────────────
const DASH_CSS = `
:root{--bg:#0a0a0f;--surface:rgba(255,255,255,0.04);--surface-hover:rgba(255,255,255,0.07);--border:rgba(255,255,255,0.08);--text:#e4e4e7;--text-dim:#71717a;--accent:#818cf8;--accent-glow:rgba(129,140,248,0.15);--danger:#f87171;--success:#34d399;--warning:#fbbf24;--radius:12px;--font:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--mono:'Courier New',monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;line-height:1.6}
.app{max-width:960px;margin:0 auto;padding:1rem}
.header{display:flex;align-items:center;justify-content:space-between;padding:1rem 0;border-bottom:1px solid var(--border);margin-bottom:2rem;flex-wrap:wrap;gap:1rem}
.logo{font-size:1.4rem;font-weight:700;color:var(--accent)}
.tabs{display:flex;gap:.25rem;background:var(--surface);border-radius:var(--radius);padding:4px}
.tab{background:none;border:none;color:var(--text-dim);padding:.5rem 1rem;border-radius:8px;cursor:pointer;font-size:.875rem;font-weight:500;transition:all .2s}
.tab:hover{color:var(--text);background:var(--surface-hover)}
.tab.active{color:var(--text);background:var(--accent-glow);box-shadow:0 0 0 1px var(--accent)}
.tab-panel{display:none}.tab-panel.active{display:block;animation:fadeIn .25s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem}
.card h2{font-size:1.25rem;margin-bottom:1.5rem;font-weight:600}
.card h3{font-size:1rem;font-weight:600;color:var(--text-dim)}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.form-group{margin-bottom:1rem}
.form-group label{display:block;font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-dim);margin-bottom:.35rem}
.hint{font-weight:400;text-transform:none;letter-spacing:0;opacity:.6;font-size:.75rem}
.field-note{font-size:.75rem;color:var(--warning);margin-top:.35rem;opacity:.8}
input[type="text"],input[type="url"],input[type="password"],select,textarea{width:100%;background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:8px;padding:.6rem .8rem;color:var(--text);font-size:.9rem;font-family:var(--font);transition:border-color .2s;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}
textarea{font-family:var(--mono);font-size:.8rem;resize:vertical;line-height:1.5}
select{cursor:pointer}
.btn{display:inline-flex;align-items:center;gap:.4rem;padding:.6rem 1.2rem;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:.875rem;font-weight:500;cursor:pointer;transition:all .2s}
.btn:hover{background:var(--surface-hover)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.primary:hover{opacity:.9}
.btn.danger{background:rgba(248,113,113,.15);border-color:var(--danger);color:var(--danger)}
.btn.danger:hover{background:rgba(248,113,113,.25)}
.btn.small{padding:.35rem .75rem;font-size:.8rem}
.providers-grid{display:grid;gap:.75rem}
.provider-card{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;background:rgba(0,0,0,.2);border:1px solid var(--border);border-radius:10px;cursor:pointer;transition:all .2s}
.provider-card:hover{border-color:var(--accent);background:var(--accent-glow)}
.provider-info h4{font-size:1rem;font-weight:600}
.prefix-badge{display:inline-block;background:var(--accent-glow);color:var(--accent);padding:.1rem .5rem;border-radius:4px;font-size:.75rem;font-family:var(--mono);margin-left:.5rem}
.url-text{font-size:.8rem;color:var(--text-dim);margin-top:.2rem}
.provider-actions{display:flex;gap:.5rem}
.modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center}
.modal.hidden{display:none}
.modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)}
.modal-content{position:relative;max-width:700px;width:90%;max-height:85vh;overflow-y:auto;z-index:1}
.modal-content.small{max-width:400px}
.modal-close{position:absolute;top:1rem;right:1rem;background:none;border:none;color:var(--text-dim);font-size:1.5rem;cursor:pointer}
.modal-close:hover{color:var(--text)}
.modal-actions{display:flex;gap:.5rem;margin-top:1rem}
.models-toolbar{display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
.models-toolbar select{width:auto;min-width:180px}
.models-grid{display:grid;gap:.4rem}
.model-row{display:flex;align-items:center;gap:.75rem;padding:.5rem .75rem;background:rgba(0,0,0,.15);border-radius:6px;font-family:var(--mono);font-size:.8rem}
.model-row .prefix{color:var(--accent);font-weight:600;min-width:40px}
.model-row .model-id{color:var(--text)}
.stats-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem}
.stat-card{background:rgba(0,0,0,.2);border:1px solid var(--border);border-radius:10px;padding:1.25rem;text-align:center}
.stat-card .stat-value{font-size:2rem;font-weight:700;color:var(--accent);line-height:1}
.stat-card .stat-label{font-size:.75rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin-top:.4rem}
.stat-provider-row{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;background:rgba(0,0,0,.15);border-radius:8px;margin-top:.5rem}
.stat-provider-row .sp-name{font-weight:600;font-family:var(--mono);color:var(--accent)}
.stat-provider-row .sp-stats{display:flex;gap:1.5rem;font-size:.8rem;color:var(--text-dim)}
.stat-provider-row .sp-stats span{color:var(--text);font-weight:600}
.detail-section{margin-bottom:1.25rem}
.detail-section .detail-label{font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);margin-bottom:.25rem}
.detail-section .detail-value{font-family:var(--mono);font-size:.85rem;background:rgba(0,0,0,.3);padding:.5rem .75rem;border-radius:6px;word-break:break-all}
.detail-section pre{font-family:var(--mono);font-size:.8rem;background:rgba(0,0,0,.3);padding:.75rem;border-radius:6px;overflow-x:auto;white-space:pre-wrap}
.history-entry{padding:.5rem 0;border-bottom:1px solid var(--border);font-size:.8rem}
.history-entry:last-child{border-bottom:none}
.history-entry .he-time{color:var(--text-dim);font-family:var(--mono);font-size:.7rem}
.history-entry .he-action{color:var(--accent);font-weight:600}
#toasts{position:fixed;bottom:1.5rem;right:1.5rem;display:flex;flex-direction:column;gap:.5rem;z-index:9999}
.toast{padding:.75rem 1.25rem;border-radius:8px;font-size:.85rem;font-weight:500;animation:slideIn .3s ease;max-width:360px}
.toast.success{background:rgba(52,211,153,.15);border:1px solid var(--success);color:var(--success)}
.toast.error{background:rgba(248,113,113,.15);border:1px solid var(--danger);color:var(--danger)}
.toast.info{background:var(--accent-glow);border:1px solid var(--accent);color:var(--accent)}
@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
@media(max-width:640px){.form-row{grid-template-columns:1fr}.header{flex-direction:column;align-items:flex-start}.stats-cards{grid-template-columns:1fr 1fr}}
`;

// ── DASHBOARD JS ────────────────────────────────────────
const DASH_JS = `
var API = '';

function esc(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

var tabs = document.querySelectorAll('.tab');
var panels = document.querySelectorAll('.tab-panel');

function switchTab(name) {
  tabs.forEach(function(t) { t.classList.toggle('active', t.dataset.tab === name); });
  panels.forEach(function(p) { p.classList.toggle('active', p.id === 'tab-' + name); });
  window.location.hash = name;
  if (name === 'providers') loadProviders();
  if (name === 'models') { loadModelProviderFilter(); loadModels(); }
  if (name === 'stats') loadStats();
}

tabs.forEach(function(t) {
  t.addEventListener('click', function() { switchTab(t.dataset.tab); });
});

function toast(msg, type) {
  type = type || 'info';
  var el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(function() { el.remove(); }, 4000);
}

document.getElementById('add-auth-type').addEventListener('change', function(e) {
  document.getElementById('custom-header-group').style.display = e.target.value === 'custom' ? 'block' : 'none';
});

document.getElementById('add-form').addEventListener('submit', function(e) {
  e.preventDefault();
  var data = {
    prefix: document.getElementById('add-prefix').value.trim(),
    name: document.getElementById('add-name').value.trim(),
    upstream_url: document.getElementById('add-url').value.trim(),
    auth_type: document.getElementById('add-auth-type').value,
    auth_header: document.getElementById('add-auth-header').value.trim() || 'authorization',
    models_endpoint: document.getElementById('add-models-endpoint').value.trim() || '/v1/models',
    optional_key: document.getElementById('add-optional-key').value.trim(),
    sandbox: document.getElementById('add-sandbox').value.trim() || null
  };
  if (data.sandbox) {
    try { JSON.parse(data.sandbox); } catch(ex) { return toast('Sandbox JSON is invalid.', 'error'); }
  }
  fetch(API + '/api/providers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  }).then(function(res) { return res.json().then(function(json) { return { ok: res.ok, json: json }; }); })
    .then(function(r) {
      if (!r.ok) return toast(r.json.error, 'error');
      toast('Provider created!', 'success');
      document.getElementById('add-form').reset();
    }).catch(function(err) { toast(err.message, 'error'); });
});

function loadProviders() {
  fetch(API + '/api/providers').then(function(r) { return r.json(); }).then(function(providers) {
    var c = document.getElementById('providers-list');
    var keys = Object.keys(providers);
    if (!keys.length) { c.innerHTML = '<p style="color:#71717a">No providers yet. Add one!</p>'; return; }
    var html = '';
    for (var i = 0; i < keys.length; i++) {
      var prefix = keys[i];
      var p = providers[prefix];
      html += '<div class="provider-card" data-prefix="' + esc(prefix) + '">'
        + '<div class="provider-info"><h4>' + esc(p.name || prefix) + ' <span class="prefix-badge">' + esc(prefix) + '</span></h4>'
        + '<div class="url-text">' + esc(p.upstream_url) + '</div></div>'
        + '<div class="provider-actions">'
        + '<button class="btn small edit-btn" data-p="' + esc(prefix) + '">Edit</button>'
        + '<button class="btn small danger del-btn" data-p="' + esc(prefix) + '">Delete</button>'
        + '</div></div>';
    }
    c.innerHTML = html;
    c.querySelectorAll('.provider-card').forEach(function(card) {
      card.addEventListener('click', function(e) {
        if (e.target.classList.contains('edit-btn') || e.target.classList.contains('del-btn')) return;
        openDetailModal(card.dataset.prefix);
      });
    });
    c.querySelectorAll('.edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) { e.stopPropagation(); openEditModal(btn.dataset.p); });
    });
    c.querySelectorAll('.del-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) { e.stopPropagation(); openDeleteModal(btn.dataset.p); });
    });
  }).catch(function(err) { toast(err.message, 'error'); });
}

function openDetailModal(prefix) {
  Promise.all([
    fetch(API + '/api/providers/' + prefix).then(function(r) { return r.json(); }),
    fetch(API + '/api/providers/' + prefix + '/history').then(function(r) { return r.json(); })
  ]).then(function(results) {
    var prov = results[0];
    var history = results[1];
    var d = document.getElementById('provider-detail');
    var h = '<h2>' + esc(prov.name) + ' <span class="prefix-badge">' + esc(prov.prefix) + '</span></h2>';
    h += '<div class="detail-section"><div class="detail-label">Upstream URL</div><div class="detail-value">' + esc(prov.upstream_url) + '</div></div>';
    h += '<div class="detail-section"><div class="detail-label">Auth</div><div class="detail-value">' + esc(prov.auth_type) + ' / ' + esc(prov.auth_header) + '</div></div>';
    h += '<div class="detail-section"><div class="detail-label">Models Endpoint</div><div class="detail-value">' + esc(prov.models_endpoint || '/v1/models') + '</div></div>';
    h += '<div class="detail-section"><div class="detail-label">Optional Key</div><div class="detail-value">' + (prov.optional_key ? '******' + prov.optional_key.slice(-4) : 'None') + '</div></div>';
    h += '<div class="detail-section"><div class="detail-label">Sandbox</div><pre>' + (prov.sandbox ? esc(JSON.stringify(prov.sandbox, null, 2)) : 'None (default)') + '</pre></div>';
    h += '<div class="detail-section"><div class="detail-label">Created</div><div class="detail-value">' + new Date(prov.created_at).toLocaleString() + '</div></div>';
    h += '<div class="detail-section"><div class="detail-label">Updated</div><div class="detail-value">' + new Date(prov.updated_at).toLocaleString() + '</div></div>';
    h += '<div class="detail-section"><div class="detail-label">History (' + history.length + ')</div><div style="max-height:200px;overflow-y:auto">';
    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      h += '<div class="history-entry"><span class="he-time">' + new Date(entry.timestamp).toLocaleString() + '</span> <span class="he-action">' + esc(entry.action) + '</span>';
      if (entry.changes) h += '<pre style="margin-top:.25rem;font-size:.7rem">' + esc(JSON.stringify(entry.changes, null, 2)) + '</pre>';
      h += '</div>';
    }
    h += '</div></div>';
    d.innerHTML = h;
    document.getElementById('provider-modal').classList.remove('hidden');
  }).catch(function(err) { toast(err.message, 'error'); });
}

function openEditModal(prefix) {
  fetch(API + '/api/providers/' + prefix).then(function(r) { return r.json(); }).then(function(prov) {
    var d = document.getElementById('provider-detail');
    var h = '<h2>Edit: ' + esc(prov.name) + '</h2>';
    h += '<form id="edit-form">';
    h += '<div class="form-group"><label>Name</label><input type="text" id="edit-name" value="' + esc(prov.name || '') + '"></div>';
    h += '<div class="form-group"><label>Upstream URL</label><input type="url" id="edit-url" value="' + esc(prov.upstream_url) + '"></div>';
    h += '<div class="form-row"><div class="form-group"><label>Auth Type</label><select id="edit-auth-type"><option value="bearer"' + (prov.auth_type === 'bearer' ? ' selected' : '') + '>Bearer</option><option value="x-api-key"' + (prov.auth_type === 'x-api-key' ? ' selected' : '') + '>x-api-key</option><option value="custom"' + (prov.auth_type === 'custom' ? ' selected' : '') + '>Custom</option></select></div>';
    h += '<div class="form-group"><label>Auth Header</label><input type="text" id="edit-auth-header" value="' + esc(prov.auth_header || 'authorization') + '"></div></div>';
    h += '<div class="form-group"><label>Models Endpoint</label><input type="text" id="edit-models-endpoint" value="' + esc(prov.models_endpoint || '/v1/models') + '"></div>';
    h += '<div class="form-group"><label>Optional Key</label><input type="text" id="edit-optional-key" value="' + esc(prov.optional_key || '') + '"></div>';
    h += '<div class="form-group"><label>Sandbox JSON</label><textarea id="edit-sandbox" rows="12">' + (prov.sandbox ? esc(JSON.stringify(prov.sandbox, null, 2)) : '') + '</textarea></div>';
    h += '<button type="submit" class="btn primary">Save Changes</button></form>';
    d.innerHTML = h;
    document.getElementById('edit-form').addEventListener('submit', function(ev) {
      ev.preventDefault();
      var updates = {
        name: document.getElementById('edit-name').value.trim(),
        upstream_url: document.getElementById('edit-url').value.trim(),
        auth_type: document.getElementById('edit-auth-type').value,
        auth_header: document.getElementById('edit-auth-header').value.trim(),
        models_endpoint: document.getElementById('edit-models-endpoint').value.trim(),
        optional_key: document.getElementById('edit-optional-key').value.trim(),
        sandbox: document.getElementById('edit-sandbox').value.trim() || null
      };
      fetch(API + '/api/providers/' + prefix, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates)
      }).then(function(r) { return r.json().then(function(j) { return { ok: r.ok, json: j }; }); })
        .then(function(r) {
          if (!r.ok) return toast(r.json.error, 'error');
          toast('Updated!', 'success');
          document.getElementById('provider-modal').classList.add('hidden');
          loadProviders();
        }).catch(function(err) { toast(err.message, 'error'); });
    });
    document.getElementById('provider-modal').classList.remove('hidden');
  }).catch(function(err) { toast(err.message, 'error'); });
}

var deletingPrefix = '';
function openDeleteModal(prefix) {
  deletingPrefix = prefix;
  document.getElementById('delete-password').value = '';
  document.getElementById('delete-modal').classList.remove('hidden');
}

document.getElementById('delete-confirm').addEventListener('click', function() {
  var pw = document.getElementById('delete-password').value;
  fetch(API + '/api/providers/' + deletingPrefix, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: pw })
  }).then(function(r) { return r.json().then(function(j) { return { ok: r.ok, json: j }; }); })
    .then(function(r) {
      if (!r.ok) return toast(r.json.error, 'error');
      toast('Deleted.', 'success');
      document.getElementById('delete-modal').classList.add('hidden');
      loadProviders();
    }).catch(function(err) { toast(err.message, 'error'); });
});

document.getElementById('delete-cancel').addEventListener('click', function() {
  document.getElementById('delete-modal').classList.add('hidden');
});

document.querySelectorAll('.modal-backdrop').forEach(function(el) {
  el.addEventListener('click', function() { el.closest('.modal').classList.add('hidden'); });
});
document.querySelectorAll('.modal-close').forEach(function(el) {
  el.addEventListener('click', function() { el.closest('.modal').classList.add('hidden'); });
});

function loadModelProviderFilter() {
  fetch(API + '/api/providers').then(function(r) { return r.json(); }).then(function(providers) {
    var sel = document.getElementById('models-provider-filter');
    sel.innerHTML = '<option value="all">All Providers</option>';
    for (var prefix in providers) {
      var p = providers[prefix];
      sel.innerHTML += '<option value="' + prefix + '">' + esc(p.name || prefix) + ' (' + prefix + ')</option>';
    }
  }).catch(function() {});
}

function loadModels() {
  fetch(API + '/api/models').then(function(r) { return r.json(); }).then(function(models) {
    renderModels(models);
  }).catch(function(err) { toast(err.message, 'error'); });
}

function renderModels(models) {
  var filter = document.getElementById('models-provider-filter').value;
  var filtered = filter === 'all' ? models : models.filter(function(m) { return m.owned_by === filter; });
  var c = document.getElementById('models-list');
  if (!filtered.length) { c.innerHTML = '<p style="color:#71717a">No models loaded. Hit Fetch Models.</p>'; return; }
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    html += '<div class="model-row"><span class="prefix">' + esc(filtered[i].owned_by) + '</span><span class="model-id">' + esc(filtered[i].id) + '</span></div>';
  }
  c.innerHTML = html;
}

document.getElementById('models-provider-filter').addEventListener('change', loadModels);

document.getElementById('fetch-models-btn').addEventListener('click', function() {
  var filter = document.getElementById('models-provider-filter').value;
  var storedKeys = localStorage.getItem('proxy-keys') || '';
  var parsedKeys = parseLocalKeys(storedKeys);
  toast('Fetching models...', 'info');
  var url = filter === 'all' ? API + '/api/models/fetch' : API + '/api/models/fetch/' + filter;
  var body = filter === 'all' ? JSON.stringify({ keys: parsedKeys }) : JSON.stringify({ key: parsedKeys[filter] || '' });
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body })
    .then(function() { toast('Models fetched!', 'success'); loadModels(); })
    .catch(function(err) { toast(err.message, 'error'); });
});

document.getElementById('save-keys-btn').addEventListener('click', function() {
  var val = document.getElementById('models-keys').value.trim();
  localStorage.setItem('proxy-keys', val);
  toast('Keys saved to browser.', 'success');
});

var savedKeys = localStorage.getItem('proxy-keys') || '';
document.getElementById('models-keys').value = savedKeys;

function parseLocalKeys(raw) {
  if (!raw) return {};
  var result = {};
  var segs = raw.split(';');
  for (var i = 0; i < segs.length; i++) {
    var eqIdx = segs[i].indexOf('=');
    if (eqIdx === -1) continue;
    var prefix = segs[i].slice(0, eqIdx).trim();
    var key = segs[i].slice(eqIdx + 1).trim().split(',')[0];
    if (prefix && key) result[prefix] = key;
  }
  return result;
}

function loadStats() {
  fetch(API + '/api/stats').then(function(r) { return r.json(); }).then(function(stats) {
    document.getElementById('stats-overview').innerHTML =
      '<div class="stat-card"><div class="stat-value">' + stats.totalRequests.toLocaleString() + '</div><div class="stat-label">Total Requests</div></div>'
      + '<div class="stat-card"><div class="stat-value">' + stats.totalErrors.toLocaleString() + '</div><div class="stat-label">Total Errors</div></div>'
      + '<div class="stat-card"><div class="stat-value">' + stats.totalUniqueUsers.toLocaleString() + '</div><div class="stat-label">Unique Users</div></div>'
      + '<div class="stat-card"><div class="stat-value">' + stats.activeNow + '</div><div class="stat-label">Active Now</div></div>';
    var entries = Object.entries(stats.providers);
    var pc = document.getElementById('stats-providers');
    if (!entries.length) { pc.innerHTML = '<p style="color:#71717a;margin-top:.5rem">No provider stats yet.</p>'; return; }
    var html = '';
    for (var i = 0; i < entries.length; i++) {
      var prefix = entries[i][0];
      var s = entries[i][1];
      html += '<div class="stat-provider-row"><span class="sp-name">' + esc(prefix) + '</span><div class="sp-stats"><div>Requests: <span>' + s.requests.toLocaleString() + '</span></div><div>Errors: <span>' + s.errors.toLocaleString() + '</span></div><div>Users: <span>' + s.uniqueUsers.toLocaleString() + '</span></div></div></div>';
    }
    pc.innerHTML = html;
  }).catch(function(err) { toast(err.message, 'error'); });
}

setInterval(function() {
  if (document.getElementById('tab-stats').classList.contains('active')) loadStats();
}, 10000);

var initTab = window.location.hash.slice(1) || 'add';
switchTab(initTab);
`;

// ── serve dashboard assets ──────────────────────────────
app.get('/dashboard.css', (_req, res) => {
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.send(DASH_CSS);
});

app.get('/dashboard.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.send(DASH_JS);
});

app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(DASH_HTML);
});

// body parser
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  express.json({ limit: '50mb' })(req, res, (err) => {
    if (err) req.body = {};
    next();
  });
});

// SPA fallback for non-API GETs
app.get('*', (req, res, next) => {
  if (/^\\/v\\d+\\//.test(req.path) || req.path.startsWith('/api/')) return next();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(DASH_HTML);
});

// proxy
app.all('*', handleProxy);

// boot
try {
  await initStorage();
  console.log('[boot] Storage initialized');
} catch (e) {
  console.error('[boot] Storage init error:', e.message);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('Proxy Gateway live on :' + PORT);
});
