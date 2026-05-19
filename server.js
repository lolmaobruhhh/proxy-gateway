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

const app = express();

app.use(cors({
  origin: '*',
  methods: '*',
  allowedHeaders: '*',
  exposedHeaders: '*',
  credentials: false,
}));

// ── DIAGNOSTIC — delete this route once dashboard works ─
app.get('/debug', (_req, res) => {
  const info = {
    __dirname,
    publicPath,
    publicExists: fs.existsSync(publicPath),
    publicContents: [],
    rootContents: [],
    srcContents: [],
  };

  try { info.rootContents = fs.readdirSync(__dirname); } catch (e) { info.rootContents = e.message; }
  try { info.publicContents = fs.readdirSync(publicPath); } catch (e) { info.publicContents = e.message; }
  try { info.srcContents = fs.readdirSync(path.join(__dirname, 'src')); } catch (e) { info.srcContents = e.message; }

  res.json(info);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use(express.static(publicPath));

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

app.use('/api/providers', providersRouter);
app.use('/api/models', modelsRouter);
app.use('/api/stats', statsRouter);

app.get('/v1/models', async (_req, res) => {
  try {
    const models = await getAggregatedModels();
    res.json({ object: 'list', data: models });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res, next) => {
  if (/^\/v\d+\//.test(req.path) || req.path.startsWith('/api/')) {
    return next();
  }
  const indexFile = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexFile)) {
    return res.sendFile(indexFile);
  }
  res.status(404).json({ error: 'index.html not found', publicPath, exists: fs.existsSync(publicPath) });
});

app.all('*', handleProxy);

try {
  await initStorage();
} catch (e) {
  console.error('[boot] Storage init error:', e.message);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Proxy Gateway live on :${PORT}`);
});
