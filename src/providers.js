import { Router } from 'express';
import {
  getAllProviders,
  getProvider,
  addProvider,
  updateProvider,
  deleteProvider,
  getHistory,
} from './storage.js';
import { verifyPassword } from './auth.js';

export const providersRouter = Router();

// list all
providersRouter.get('/', (_req, res) => {
  res.json(getAllProviders());
});

// get one
providersRouter.get('/:prefix', (req, res) => {
  const p = getProvider(req.params.prefix.toLowerCase());
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

// get history
providersRouter.get('/:prefix/history', (req, res) => {
  res.json(getHistory(req.params.prefix.toLowerCase()));
});

// create
providersRouter.post('/', async (req, res) => {
  const { prefix, name, upstream_url, auth_type, auth_header, optional_key, models_endpoint, sandbox } = req.body;

  if (!prefix || !upstream_url) {
    return res.status(400).json({ error: 'prefix and upstream_url are required.' });
  }

  let parsedSandbox = sandbox;
  if (typeof sandbox === 'string' && sandbox.trim()) {
    try {
      parsedSandbox = JSON.parse(sandbox);
    } catch {
      return res.status(400).json({ error: 'Sandbox JSON is invalid.' });
    }
  }

  const result = await addProvider({
    prefix: prefix.toLowerCase().trim(),
    name: name || prefix,
    upstream_url: upstream_url.replace(/\/+$/, ''), // strip trailing slash
    auth_type: auth_type || 'bearer',
    auth_header: auth_header || 'authorization',
    optional_key: optional_key || '',
    models_endpoint: models_endpoint || '/v1/models',
    sandbox: parsedSandbox || null,
  });

  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.status(201).json({ message: `Provider "${prefix}" created.` });
});

// update
providersRouter.put('/:prefix', async (req, res) => {
  const prefix = req.params.prefix.toLowerCase();
  const updates = req.body;

  if (updates.sandbox && typeof updates.sandbox === 'string') {
    try {
      updates.sandbox = JSON.parse(updates.sandbox);
    } catch {
      return res.status(400).json({ error: 'Sandbox JSON is invalid.' });
    }
  }

  if (updates.upstream_url) {
    updates.upstream_url = updates.upstream_url.replace(/\/+$/, '');
  }

  const result = await updateProvider(prefix, updates);
  if (!result.ok) return res.status(404).json({ error: result.reason });
  res.json({ message: 'Updated.', changes: result.changes });
});

// delete (password protected)
providersRouter.delete('/:prefix', async (req, res) => {
  const { password } = req.body;
  if (!verifyPassword(password)) {
    return res.status(403).json({ error: 'Wrong password.' });
  }
  const result = await deleteProvider(req.params.prefix.toLowerCase());
  if (!result.ok) return res.status(404).json({ error: result.reason });
  res.json({ message: 'Deleted.' });
});
