import { Router } from 'express';
import { getStats, recordRequest as _record } from './storage.js';

export const statsRouter = Router();

const activeSessions = new Map();
const ACTIVE_WINDOW = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of activeSessions) {
    if (now - ts > ACTIVE_WINDOW) activeSessions.delete(ip);
  }
}, 15_000);

export function trackRequest(req, _res, next) {
  if (req.path.startsWith('/api/') || req.path === '/v1/models' || req.path === '/health') return next();
  if (req.method === 'GET') return next();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  activeSessions.set(ip, Date.now());
  next();
}

export function recordProxyRequest(prefix, ip, errored = false) {
  _record(prefix, ip, errored);
  activeSessions.set(ip, Date.now());
}

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
