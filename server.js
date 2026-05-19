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

app.use(cors({
  origin: '*',
  methods: '*',
  allowedHeaders: '*',
  exposedHeaders: '*',
  credentials: false,
}));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// body parser for non-GET
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  express.json({ limit: '50mb' })(req, res, (err) => {
    if (err) req.body = {};
    next();
  });
});

app.use(trackRequest);

// dashboard API
app.use('/api/providers', providersRouter);
app.use('/api/models', modelsRouter);
app.use('/api/stats', statsRouter);

// aggregated models
app.get('/v1/models', async (_req, res) => {
  try {
    const models = await getAggregatedModels();
    res.json({ object: 'list', data: models });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── INLINE DASHBOARD (no static files needed) ───────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Proxy Gateway</title>

<!--LUMIVERSE_HTML_ISLAND_0-->

const API='';
const tabs=document.querySelectorAll('.tab');
const panels=document.querySelectorAll('.tab-panel');

function switchTab(name){
tabs.forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
panels.forEach(p=>p.classList.toggle('active',p.id==='tab-'+name));
window.location.hash=name;
if(name==='providers')loadProviders();
if(name==='models'){loadModelProviderFilter();loadModels()}
if(name==='stats')loadStats();
}
tabs.forEach(t=>t.addEventListener('click',()=>switchTab(t.dataset.tab)));
const initTab=window.location.hash.slice(1)||'add';
switchTab(initTab);

function toast(msg,type='info'){
const el=document.createElement('div');
el.className='toast '+type;
el.textContent=msg;
document.getElementById('toasts').appendChild(el);
setTimeout(()=>el.remove(),4000);
}

document.getElementById('add-auth-type').addEventListener('change',e=>{
document.getElementById('custom-header-group').style.display=e.target.value==='custom'?'block':'none';
});

document.getElementById('add-form').addEventListener('submit',async e=>{
e.preventDefault();
const data={
prefix:document.getElementById('add-prefix').value.trim(),
name:document.getElementById('add-name').value.trim(),
upstream_url:document.getElementById('add-url').value.trim(),
auth_type:document.getElementById('add-auth-type').value,
auth_header:document.getElementById('add-auth-header').value.trim()||'authorization',
models_endpoint:document.getElementById('add-models-endpoint').value.trim()||'/v1/models',
optional_key:document.getElementById('add-optional-key').value.trim(),
sandbox:document.getElementById('add-sandbox').value.trim()||null
};
if(data.sandbox){try{JSON.parse(data.sandbox)}catch{return toast('Sandbox JSON is invalid.','error')}}
try{
const res=await fetch(API+'/api/providers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
const json=await res.json();
if(!res.ok)return toast(json.error,'error');
toast('Provider "'+data.prefix+'" created!','success');
document.getElementById('add-form').reset();
}catch(err){toast(err.message,'error')}
});

async function loadProviders(){
try{
const res=await fetch(API+'/api/providers');
const providers=await res.json();
const c=document.getElementById('providers-list');
if(!Object.keys(providers).length){c.innerHTML='<p style="color:var(--text-dim)">No providers yet. Add one!</p>';return}
c.innerHTML=Object.entries(providers).map(([prefix,p])=>'<div class="provider-card" data-prefix="'+prefix+'"><div class="provider-info"><h4>'+esc(p.name||prefix)+' <span class="prefix-badge">'+esc(prefix)+'</span></h4><div class="url-text">'+esc(p.upstream_url)+'</div></div><div class="provider-actions"><button class="btn small" onclick="event.stopPropagation();openEditModal(\\''+prefix+'\\')">Edit</button><button class="btn small danger" onclick="event.stopPropagation();openDeleteModal(\\''+prefix+'\\')">Delete</button></div></div>').join('');
c.querySelectorAll('.provider-card').forEach(card=>{card.addEventListener('click',()=>openDetailModal(card.dataset.prefix))});
}catch(err){toast(err.message,'error')}
}

async function openDetailModal(prefix){
try{
const[provRes,histRes]=await Promise.all([fetch(API+'/api/providers/'+prefix),fetch(API+'/api/providers/'+prefix+'/history')]);
const prov=await provRes.json();
const history=await histRes.json();
const d=document.getElementById('provider-detail');
d.innerHTML='<h2>'+esc(prov.name)+' <span class="prefix-badge">'+esc(prov.prefix)+'</span></h2>'
+'<div class="detail-section"><div class="detail-label">Upstream URL</div><div class="detail-value">'+esc(prov.upstream_url)+'</div></div>'
+'<div class="detail-section"><div class="detail-label">Auth Type</div><div class="detail-value">'+esc(prov.auth_type)+' / '+esc(prov.auth_header)+'</div></div>'
+'<div class="detail-section"><div class="detail-label">Models Endpoint</div><div class="detail-value">'+esc(prov.models_endpoint||'/v1/models')+'</div></div>'
+'<div class="detail-section"><div class="detail-label">Optional Key</div><div class="detail-value">'+(prov.optional_key?'******'+prov.optional_key.slice(-4):'None')+'</div></div>'
+'<div class="detail-section"><div class="detail-label">Sandbox JSON</div><pre>'+(prov.sandbox?esc(JSON.stringify(prov.sandbox,null,2)):'None (default OpenAI passthrough)')+'</pre></div>'
+'<div class="detail-section"><div class="detail-label">Created</div><div class="detail-value">'+new Date(prov.created_at).toLocaleString()+'</div></div>'
+'<div class="detail-section"><div class="detail-label">Last Updated</div><div class="detail-value">'+new Date(prov.updated_at).toLocaleString()+'</div></div>'
+'<div class="detail-section"><div class="detail-label">Edit History ('+history.length+')</div><div style="max-height:200px;overflow-y:auto">'+history.map(h=>'<div class="history-entry"><span class="he-time">'+new Date(h.timestamp).toLocaleString()+'</span> <span class="he-action">'+esc(h.action)+'</span>'+(h.changes?'<pre style="margin-top:.25rem;font-size:.7rem">'+esc(JSON.stringify(h.changes,null,2))+'</pre>':'')+'</div>').join('')+'</div></div>';
document.getElementById('provider-modal').classList.remove('hidden');
}catch(err){toast(err.message,'error')}
}

async function openEditModal(prefix){
try{
const res=await fetch(API+'/api/providers/'+prefix);
const prov=await res.json();
const d=document.getElementById('provider-detail');
d.innerHTML='<h2>Edit: '+esc(prov.name)+' <span class="prefix-badge">'+esc(prefix)+'</span></h2>'
+'<form id="edit-form">'
+'<div class="form-group"><label>Display Name</label><input type="text" id="edit-name" value="'+esc(prov.name||'')+'"></div>'
+'<div class="form-group"><label>Upstream URL</label><input type="url" id="edit-url" value="'+esc(prov.upstream_url)+'"></div>'
+'<div class="form-row"><div class="form-group"><label>Auth Type</label><select id="edit-auth-type"><option value="bearer"'+(prov.auth_type==='bearer'?' selected':'')+'>Bearer</option><option value="x-api-key"'+(prov.auth_type==='x-api-key'?' selected':'')+'>x-api-key</option><option value="custom"'+(prov.auth_type==='custom'?' selected':'')+'>Custom</option></select></div><div class="form-group"><label>Auth Header</label><input type="text" id="edit-auth-header" value="'+esc(prov.auth_header||'authorization')+'"></div></div>'
+'<div class="form-group"><label>Models Endpoint</label><input type="text" id="edit-models-endpoint" value="'+esc(prov.models_endpoint||'/v1/models')+'"></div>'
+'<div class="form-group"><label>Optional API Key</label><input type="text" id="edit-optional-key" value="'+esc(prov.optional_key||'')+'"></div>'
+'<div class="form-group"><label>Sandbox JSON</label><textarea id="edit-sandbox" rows="12">'+(prov.sandbox?esc(JSON.stringify(prov.sandbox,null,2)):'')+'</textarea></div>'
+'<button type="submit" class="btn primary">Save Changes</button></form>';
document.getElementById('edit-form').addEventListener('submit',async ev=>{
ev.preventDefault();
const updates={name:document.getElementById('edit-name').value.trim(),upstream_url:document.getElementById('edit-url').value.trim(),auth_type:document.getElementById('edit-auth-type').value,auth_header:document.getElementById('edit-auth-header').value.trim(),models_endpoint:document.getElementById('edit-models-endpoint').value.trim(),optional_key:document.getElementById('edit-optional-key').value.trim(),sandbox:document.getElementById('edit-sandbox').value.trim()||null};
try{const r=await fetch(API+'/api/providers/'+prefix,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(updates)});const json=await r.json();if(!r.ok)return toast(json.error,'error');toast('Provider updated!','success');document.getElementById('provider-modal').classList.add('hidden');loadProviders()}catch(err){toast(err.message,'error')}
});
document.getElementById('provider-modal').classList.remove('hidden');
}catch(err){toast(err.message,'error')}
}

let deletingPrefix='';
function openDeleteModal(prefix){deletingPrefix=prefix;document.getElementById('delete-password').value='';document.getElementById('delete-modal').classList.remove('hidden')}
document.getElementById('delete-confirm').addEventListener('click',async()=>{
const pw=document.getElementById('delete-password').value;
try{const res=await fetch(API+'/api/providers/'+deletingPrefix,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw})});const json=await res.json();if(!res.ok)return toast(json.error,'error');toast('Provider deleted.','success');document.getElementById('delete-modal').classList.add('hidden');loadProviders()}catch(err){toast(err.message,'error')}
});
document.getElementById('delete-cancel').addEventListener('click',()=>{document.getElementById('delete-modal').classList.add('hidden')});
document.querySelectorAll('.modal-backdrop').forEach(el=>{el.addEventListener('click',()=>{el.closest('.modal').classList.add('hidden')})});
document.querySelectorAll('.modal-close').forEach(el=>{el.addEventListener('click',()=>{el.closest('.modal').classList.add('hidden')})});

async function loadModelProviderFilter(){
try{const res=await fetch(API+'/api/providers');const providers=await res.json();const sel=document.getElementById('models-provider-filter');sel.innerHTML='<option value="all">All Providers</option>';for(const[prefix,p]of Object.entries(providers)){sel.innerHTML+='<option value="'+prefix+'">'+esc(p.name||prefix)+' ('+prefix+')</option>'}}catch{}
}

async function loadModels(){
try{const res=await fetch(API+'/api/models');const models=await res.json();renderModels(models)}catch(err){toast(err.message,'error')}
}

function renderModels(models){
const filter=document.getElementById('models-provider-filter').value;
const filtered=filter==='all'?models:models.filter(m=>m.owned_by===filter);
const c=document.getElementById('models-list');
if(!filtered.length){c.innerHTML='<p style="color:var(--text-dim)">No models loaded. Hit Fetch Models.</p>';return}
c.innerHTML=filtered.map(m=>'<div class="model-row"><span class="prefix">'+esc(m.owned_by)+'</span><span class="model-id">'+esc(m.id)+'</span></div>').join('');
}
document.getElementById('models-provider-filter').addEventListener('change',loadModels);

document.getElementById('fetch-models-btn').addEventListener('click',async()=>{
const filter=document.getElementById('models-provider-filter').value;
const storedKeys=localStorage.getItem('proxy-keys')||'';
const parsedKeys=parseLocalKeys(storedKeys);
toast('Fetching models...','info');
try{
if(filter==='all'){await fetch(API+'/api/models/fetch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({keys:parsedKeys})})}
else{await fetch(API+'/api/models/fetch/'+filter,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:parsedKeys[filter]||''})})}
toast('Models fetched!','success');loadModels();
}catch(err){toast(err.message,'error')}
});

document.getElementById('save-keys-btn').addEventListener('click',()=>{
const val=document.getElementById('models-keys').value.trim();
localStorage.setItem('proxy-keys',val);
toast('Keys saved to browser.','success');
});

const savedKeys=localStorage.getItem('proxy-keys')||'';
document.getElementById('models-keys').value=savedKeys;

function parseLocalKeys(raw){
if(!raw)return{};const result={};const segs=raw.split(';');
for(const seg of segs){const eqIdx=seg.indexOf('=');if(eqIdx===-1)continue;const prefix=seg.slice(0,eqIdx).trim();const key=seg.slice(eqIdx+1).trim().split(',')[0];if(prefix&&key)result[prefix]=key}
return result;
}

async function loadStats(){
try{
const res=await fetch(API+'/api/stats');
const stats=await res.json();
document.getElementById('stats-overview').innerHTML=
'<div class="stat-card"><div class="stat-value">'+stats.totalRequests.toLocaleString()+'</div><div class="stat-label">Total Requests</div></div>'
+'<div class="stat-card"><div class="stat-value">'+stats.totalErrors.toLocaleString()+'</div><div class="stat-label">Total Errors</div></div>'
+'<div class="stat-card"><div class="stat-value">'+stats.totalUniqueUsers.toLocaleString()+'</div><div class="stat-label">Unique Users</div></div>'
+'<div class="stat-card"><div class="stat-value">'+stats.activeNow+'</div><div class="stat-label">Active Now</div></div>';
const entries=Object.entries(stats.providers);
const pc=document.getElementById('stats-providers');
if(!entries.length){pc.innerHTML='<p style="color:var(--text-dim);margin-top:.5rem">No provider stats yet.</p>';return}
pc.innerHTML=entries.map(([prefix,s])=>'<div class="stat-provider-row"><span class="sp-name">'+esc(prefix)+'</span><div class="sp-stats"><div>Requests: <span>'+s.requests.toLocaleString()+'</span></div><div>Errors: <span>'+s.errors.toLocaleString()+'</span></div><div>Users: <span>'+s.uniqueUsers.toLocaleString()+'</span></div></div></div>').join('');
}catch(err){toast(err.message,'error')}
}

setInterval(()=>{if(document.getElementById('tab-stats').classList.contains('active'))loadStats()},10000);

function esc(str){if(!str)return'';const d=document.createElement('div');d.textContent=String(str);return d.innerHTML}

window.openEditModal=openEditModal;
window.openDeleteModal=openDeleteModal;
window.openDetailModal=openDetailModal;
</script>
</body>
</html>`;

// serve dashboard on root and any non-API GET
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(DASHBOARD_HTML);
});

app.get('*', (req, res, next) => {
  if (/^\/v\d+\//.test(req.path) || req.path.startsWith('/api/')) return next();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(DASHBOARD_HTML);
});

// proxy catches everything else
app.all('*', handleProxy);

// boot
try {
  await initStorage();
  console.log('[boot] Storage initialized');
} catch (e) {
  console.error('[boot] Storage init error:', e.message);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('⚡ Proxy Gateway live on :' + PORT);
});
