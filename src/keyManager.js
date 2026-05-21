const counters = {};

export function parseCompoundKeys(raw) {
  if (!raw) return {};
  const cleaned = raw.replace(/^\s*(Bearer|Basic|Token)\s+/i, '').trim();
  if (!cleaned) return {};

  const result = {};
  const segments = cleaned.split(';');

  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
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

export function getNextKey(prefix, keys, skip = new Set()) {
  if (!keys || keys.length === 0) return null;
  if (!(prefix in counters)) counters[prefix] = 0;

  const total = keys.length;
  for (let attempt = 0; attempt < total; attempt++) {
    const idx = (counters[prefix] + attempt) % total;
    if (skip.has(idx)) continue;
    counters[prefix] = (idx + 1) % total;
    return { key: keys[idx], index: idx };
  }

  return null;
}
