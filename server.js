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
const app = express();
const PORT = process.env.PORT || 7860;

// ── middleware ──────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: '*',
  allowedHeaders: '*',
  exposedHeaders: '*',
  credentials: false,
}));

app.use((req, res, next) => {
  // raw body capture for non-JSON passthrough later if needed
  if (req.path.startsWith('/api/') || req.path === '/v1/models') {
    express.json({ limit: '50mb' })(req, res, next);
  } else {
    express.json({ limit: '50mb' })(req, res, (err) => {
      if (err) {
        // body isn't JSON – store raw
        req.body = null;
      }
      next();
    });
  }
});

// serve dashboard
app.use(express.static(path.join(__dirname, 'public')));

// request tracking
app.use(trackRequest);

// ── dashboard API routes ────────────────────────────────
app.use('/api/providers', providersRouter);
app.use('/api/models', modelsRouter);
app.use('/api/stats', statsRouter);

// ── aggregated /v1/models endpoint ──────────────────────
app.get('/v1/models', async (_req, res) => {
  try {
    const models = await getAggregatedModels();
    res.json({ object: 'list', data: models });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── wildcard proxy (must be last) ───────────────────────
app.all(/^\/(?!api\/)(?!v1\/models$).*/, handleProxy);

// ── boot ────────────────────────────────────────────────
await initStorage();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Proxy Gateway live on :${PORT}`);
});
