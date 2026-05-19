// round-robin counters per prefix (in-memory)
const counters = {};

/**
 * Parse compound key string:
 *   "opn=sk-a,sk-b;gm=AIza-1,AIza-2"
 * or from Authorization header:
 *   "Bearer opn=sk-a,sk-b;gm=AIza-1"
 */
export function parseCompoundKeys(raw) {
  if (!raw) return {};

  // strip Bearer / Basic / etc
  const cleaned = raw.replace(/^\s*(Bearer|Basic|Token)\s+/i, '').trim();
  if (!cleaned) return {};

  const result = {};
  const segments = cleaned.split(';');

  for (const seg of segments) {
    const eqIdx = seg.indexOf('=');
    if (eqIdx === -1) continue;
    const prefix = seg.slice(0, eqIdx).trim().toLowerCase();
    const keys = seg.slice(eqIdx + 1).split(',').map(k => k.trim()).filter(Boolean);
    if (prefix && keys.length) {
      result[prefix] = keys;
    }
  }

  return result;
}

/**
 * Get the next key for a prefix using round-robin.
 * Returns { key, index } or null.
 * `skip` is a Set of indices to skip (errored keys).
 */
export function getNextKey(prefix, keys, skip = new Set()) {
  if (!keys || keys.length === 0) return null;

  if (!(prefix in counters)) counters[prefix] = 0;

  const total = keys.length;
  for (let attempt = 0; attempt < total; attempt++) {
    const idx = (counters[prefix] + attempt) % total;
    if (skip.has(idx)) continue;
    // advance counter past this key for next call
    counters[prefix] = (idx + 1) % total;
    return { key: keys[idx], index: idx };
  }

  return null; // all skipped
}
