import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import { initStorage } from './src/storage.js';
import { providersRouter } from './src/providers.js';
import { modelsRouter, getAggregatedModels } from './src/models.js';
import { statsRouter, trackRequest } from './src/stats.js';
import { handleProxy } from './src/proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicPath = path.join(__dirname, 'public');
const PORT = process.env.PORT || 7860;

console.log('[boot] public/ exists:', fs.existsSync(publicPath));
if (fs.existsSync(publicPath)) {
  console.log('[boot] public/ contents:', fs.readdirSync(publicPath));
}

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

// static files FIRST — this serves index.html, style.css, app.js
app.use(express.static(publicPath));

// body parser for non-GET requests
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
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

// SPA fallback — any GET that isn't /api or /v1 serves index.html
app.get('*', (req, res, next) => {
  if (/^\/v\d+\//.test(req.path) || req.path.startsWith('/api/')) {
    return next();
  }
  const indexFile = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexFile)) {
    return res.sendFile(indexFile);
  }
  res.status(404).send('Dashboard not found');
});

// proxy catches POST/PUT/PATCH etc — MUST be last
app.all('*', handleProxy);

// boot
try {
  await initStorage();
  console.log('[boot] Storage initialized');
} catch (e) {
  console.error('[boot] Storage init error:', e.message);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Proxy Gateway live on :${PORT}`);
});
