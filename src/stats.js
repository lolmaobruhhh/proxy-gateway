import { Router } from 'express';
import { getStats, recordRequest as _record } from './storage.js';

export const statsRouter = Router();

// active sessions — in-memory only
const activeSessions = new Map(); // ip → lastSeen timestamp
const ACTIVE_WINDOW = 60_000; // 60 seconds

// clean up stale sessions every 15 s
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of activeSessions) {
    if (now - ts > ACTIVE_WINDOW) activeSessions.delete(ip);
  }
}, 15_000);

// ── middleware ───────────────────────────────────────────
export function trackRequest(req, _res, next) {
  // skip dashboard API and static files
  if (req.path.startsWith('/api/') || req.path === '/v1/models') return next();
  if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.endsWith('.ico'))) return next();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  activeSessions.set(ip, Date.now());

  next();
}

// record a completed proxy request (called from proxy.js)
export function recordProxyRequest(prefix, ip, errored = false) {
  _record(prefix, ip, errored);
}

// ── routes ───────────────────────────────────────────────
statsRouter.get('/', (_req, res) => {
  const stats = getStats();
  const now = Date.now();
  let activeCount = 0;
  for (const [, ts] of activeSessions) {
    if (now - ts <= ACTIVE_WINDOW) activeCount++;
  }

  res.json({
    totalRequests: stats.totalRequests,
    totalErrors: stats.totalErrors,
    totalUniqueUsers: stats.uniqueIps.length,
    activeNow: activeCount,
    providers: Object.fromEntries(
      Object.entries(stats.providers).map(([k, v]) => [k, {
        requests: v.requests,
        errors: v.errors,
        uniqueUsers: v.uniqueIps.length,
      }])
    ),
  });
});
