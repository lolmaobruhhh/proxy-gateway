import { Router } from 'express';
import { getAllProviders, getProvider, getCachedModels, setCachedModels, getAllCachedModels } from './storage.js';

export var modelsRouter = Router();

modelsRouter.post('/fetch/:prefix', async function(req, res) {
  var prefix = req.params.prefix.toLowerCase();
  var provider = getProvider(prefix);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  var key = (req.body && req.body.key) || provider.optional_key || '';

  try {
    var models = await fetchModelsFromProvider(provider, key);
    setCachedModels(prefix, models);
    res.json({ prefix: prefix, count: models.length, models: models });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

modelsRouter.post('/fetch', async function(req, res) {
  var providers = getAllProviders();
  var keys = (req.body && req.body.keys) || {};
  var results = {};

  for (var prefix in providers) {
    var provider = providers[prefix];
    var key = keys[prefix] || provider.optional_key || '';
    try {
      var models = await fetchModelsFromProvider(provider, key);
      setCachedModels(prefix, models);
      results[prefix] = { count: models.length, models: models };
    } catch (e) {
      results[prefix] = { error: e.message, models: [] };
    }
  }

  res.json(results);
});

modelsRouter.get('/', function(_req, res) {
  var all = getAllCachedModels();
  var providers = getAllProviders();
  var flat = [];
  for (var prefix in all) {
    // Skip cloaked providers
    if (providers[prefix] && providers[prefix].cloaked) continue;
    var data = all[prefix];
    for (var i = 0; i < data.models.length; i++) {
      var m = data.models[i];
      flat.push({ id: prefix + ':' + m.id, object: 'model', owned_by: prefix, original_id: m.id });
    }
  }
  res.json(flat);
});

// aggregated models endpoint (used by /v1/models)
export async function getAggregatedModels() {
  var all = getAllCachedModels();
  var providers = getAllProviders();
  var data = [];
  for (var prefix in all) {
    // Skip cloaked providers
    if (providers[prefix] && providers[prefix].cloaked) continue;
    var cached = all[prefix];
    for (var i = 0; i < cached.models.length; i++) {
      var m = cached.models[i];
      data.push({
        id: prefix + ':' + m.id,
        object: 'model',
        created: m.created || Math.floor(Date.now() / 1000),
        owned_by: prefix,
      });
    }
  }
  return data;
}

async function fetchModelsFromProvider(provider, key) {
  var url = provider.upstream_url + (provider.models_endpoint || '/v1/models');
  var headers = { 'content-type': 'application/json' };
  var authType = (provider.auth_type || 'bearer').toLowerCase();

  if (key) {
    if (authType === 'bearer') {
      headers['authorization'] = 'Bearer ' + key;
    } else if (authType === 'x-api-key') {
      headers['x-api-key'] = key;
    } else {
      headers[provider.auth_header || 'authorization'] = key;
    }
  }

  var resp = await fetch(url, { method: 'GET', headers: headers, signal: AbortSignal.timeout(15000) });

  if (!resp.ok) {
    var text = await resp.text().catch(function() { return ''; });
    throw new Error('Upstream ' + resp.status + ': ' + text.slice(0, 200));
  }

  var json = await resp.json();

  if (Array.isArray(json.data)) {
    return json.data.map(function(m) { return { id: m.id, created: m.created, owned_by: m.owned_by }; });
  }
  if (Array.isArray(json)) {
    return json.map(function(m) { return typeof m === 'string' ? { id: m } : { id: m.id || m.name || String(m) }; });
  }
  for (var k in json) {
    var v = json[k];
    if (Array.isArray(v) && v.length > 0) {
      return v.map(function(m) { return typeof m === 'string' ? { id: m } : { id: m.id || m.name || String(m) }; });
    }
  }
  return [];
}
