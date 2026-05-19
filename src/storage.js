import fs from 'fs/promises';
import path from 'path';

const DATA = process.env.DATA_DIR || path.join(process.cwd(), 'data');

const FILES = {
  providers: path.join(DATA, 'providers.json'),
  stats: path.join(DATA, 'stats.json'),
  history: path.join(DATA, 'history.json'),
};

const defaults = {
  providers: {},
  stats: {
    totalRequests: 0,
    totalErrors: 0,
    uniqueIps: [],
    providers: {},
  },
  history: {},
};

// in-memory cache
let cache = {
  providers: null,
  stats: null,
  history: null,
};

export async function initStorage() {
  await fs.mkdir(DATA, { recursive: true });

  for (const [key, filePath] of Object.entries(FILES)) {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      cache[key] = JSON.parse(raw);
    } catch {
      cache[key] = structuredClone(defaults[key]);
      await persist(key);
    }
  }

  // auto-persist stats every 30 s
  setInterval(() => persist('stats'), 30_000);
}

async function persist(key) {
  try {
    await fs.writeFile(FILES[key], JSON.stringify(cache[key], null, 2), 'utf-8');
  } catch (e) {
    console.error(`[storage] failed to persist ${key}:`, e.message);
  }
}

// ── providers ──────────────────────────────────────────
export function getAllProviders() {
  return cache.providers;
}

export function getProvider(prefix) {
  return cache.providers[prefix] || null;
}

export async function addProvider(provider) {
  const { prefix } = provider;
  if (cache.providers[prefix]) {
    return { ok: false, reason: `Prefix "${prefix}" already exists. Pick another.` };
  }
  cache.providers[prefix] = { ...provider, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await persist('providers');

  // init history
  if (!cache.history[prefix]) cache.history[prefix] = [];
  cache.history[prefix].push({ timestamp: new Date().toISOString(), action: 'created', snapshot: structuredClone(provider) });
  await persist('history');

  // init stats bucket
  if (!cache.stats.providers[prefix]) {
    cache.stats.providers[prefix] = { requests: 0, errors: 0, uniqueIps: [] };
  }
  await persist('stats');

  return { ok: true };
}

export async function updateProvider(prefix, updates) {
  const existing = cache.providers[prefix];
  if (!existing) return { ok: false, reason: `Provider "${prefix}" not found.` };

  const changes = {};
  for (const [k, v] of Object.entries(updates)) {
    if (JSON.stringify(existing[k]) !== JSON.stringify(v)) {
      changes[k] = { from: existing[k], to: v };
      existing[k] = v;
    }
  }
  existing.updated_at = new Date().toISOString();
  await persist('providers');

  cache.history[prefix] = cache.history[prefix] || [];
  cache.history[prefix].push({ timestamp: new Date().toISOString(), action: 'edited', changes });
  await persist('history');

  return { ok: true, changes };
}

export async function deleteProvider(prefix) {
  if (!cache.providers[prefix]) return { ok: false, reason: `Provider "${prefix}" not found.` };
  delete cache.providers[prefix];
  await persist('providers');
  return { ok: true };
}

export function getHistory(prefix) {
  return cache.history[prefix] || [];
}

// ── stats ──────────────────────────────────────────────
export function getStats() {
  return cache.stats;
}

export function recordRequest(prefix, ip, errored = false) {
  cache.stats.totalRequests++;
  if (errored) cache.stats.totalErrors++;

  if (!cache.stats.uniqueIps.includes(ip)) cache.stats.uniqueIps.push(ip);

  if (prefix) {
    if (!cache.stats.providers[prefix]) {
      cache.stats.providers[prefix] = { requests: 0, errors: 0, uniqueIps: [] };
    }
    const p = cache.stats.providers[prefix];
    p.requests++;
    if (errored) p.errors++;
    if (!p.uniqueIps.includes(ip)) p.uniqueIps.push(ip);
  }
}

// ── models cache (in-memory only, fetched on demand) ───
let modelsCache = {}; // { prefix: { models: [], fetchedAt: timestamp } }

export function getCachedModels(prefix) {
  return modelsCache[prefix] || null;
}

export function setCachedModels(prefix, models) {
  modelsCache[prefix] = { models, fetchedAt: Date.now() };
}

export function getAllCachedModels() {
  return modelsCache;
}
