import { Router } from 'express';
import { getAllProviders, getProvider, getCachedModels, setCachedModels, getAllCachedModels } from './storage.js';

export const modelsRouter = Router();

// fetch models for one provider
modelsRouter.post('/fetch/:prefix', async (req, res) => {
  const prefix = req.params.prefix.toLowerCase();
  const provider = getProvider(prefix);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  // key priority: body.key → provider.optional_key
  const key = req.body.key || provider.optional_key || '';

  try {
    const models = await fetchModelsFromProvider(provider, key);
    setCachedModels(prefix, models);
    res.json({ prefix, count: models.length, models });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// fetch models for all providers
modelsRouter.post('/fetch', async (req, res) => {
  const providers = getAllProviders();
  const keys = req.body.keys || {}; // { prefix: "key" }
  const results = {};

  for (const [prefix, provider] of Object.entries(providers)) {
    const key = keys[prefix] || provider.optional_key || '';
    try {
      const models = await fetchModelsFromProvider(provider, key);
      setCachedModels(prefix, models);
      results[prefix] = { count: models.length, models };
    } catch (e) {
      results[prefix] = { error: e.message, models: [] };
    }
  }

  res.json(results);
});

// list cached models
modelsRouter.get('/', (_req, res) => {
  const all = getAllCachedModels();
  const flat = [];
  for (const [prefix, data] of Object.entries(all)) {
    for (const m of data.models) {
      flat.push({ id: `${prefix}:${m.id}`, object: 'model', owned_by: prefix, original_id: m.id });
    }
  }
  res.json(flat);
});

// ── aggregated models endpoint (used by /v1/models) ─────
export async function getAggregatedModels() {
  const all = getAllCachedModels();
  const data = [];
  for (const [prefix, cached] of Object.entries(all)) {
    for (const m of cached.models) {
      data.push({
        id: `${prefix}:${m.id}`,
        object: 'model',
        created: m.created || Math.floor(Date.now() / 1000),
        owned_by: prefix,
      });
    }
  }
  return data;
}

// ── fetch helper ─────────────────────────────────────────
async function fetchModelsFromProvider(provider, key) {
  const url = provider.upstream_url + (provider.models_endpoint || '/v1/models');

  const headers = { 'content-type': 'application/json' };
  const authType = (provider.auth_type || 'bearer').toLowerCase();

  if (key) {
    if (authType === 'bearer') {
      headers['authorization'] = `Bearer ${key}`;
    } else if (authType === 'x-api-key') {
      headers['x-api-key'] = key;
    } else {
      headers[provider.auth_header || 'authorization'] = key;
    }
  }

  const resp = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(15000) });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Upstream ${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = await resp.json();

  // OpenAI format: { data: [...] }
  if (Array.isArray(json.data)) {
    return json.data.map(m => ({ id: m.id, created: m.created, owned_by: m.owned_by }));
  }
  // fallback: if it's an array directly
  if (Array.isArray(json)) {
    return json.map(m => (typeof m === 'string' ? { id: m } : { id: m.id || m.name || String(m) }));
  }
  // fallback: try to find any array in the response
  for (const v of Object.values(json)) {
    if (Array.isArray(v) && v.length > 0) {
      return v.map(m => (typeof m === 'string' ? { id: m } : { id: m.id || m.name || String(m) }));
    }
  }

  return [];
}
