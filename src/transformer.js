/**
 * Transform an incoming request according to a provider's sandbox config.
 *
 * Sandbox JSON shape:
 * {
 *   "url_path": "/v2/chat/completions",      // override path
 *   "headers": {                              // upstream headers
 *     "content-type": "application/json",
 *     "authorization": "Bearer {{KEY}}",
 *     "x-api-key": "{{KEY}}"
 *   },
 *   "body_template": {                        // merge base
 *     "model": "{{MODEL}}",
 *     "stream": true,
 *     "messages": "{{MESSAGES}}"
 *   },
 *   "forced_fields": {                        // always override
 *     "stream": true
 *   }
 * }
 *
 * Placeholders: {{KEY}}, {{MODEL}}, {{MESSAGES}}, {{SYSTEM}}
 */

export function transformRequest(incomingBody, provider, strippedModel, requestPath) {
  const sandbox = provider.sandbox || null;

  // ── no sandbox → default OpenAI passthrough ──────────
  if (!sandbox) {
    const body = { ...incomingBody };
    if (strippedModel) body.model = strippedModel;
    return {
      url_path: requestPath,
      headers: buildDefaultHeaders(provider),
      body,
    };
  }

  // ── sandbox present → transform ─────────────────────
  const urlPath = sandbox.url_path || requestPath;

  // extract system message if needed
  let systemMsg = '';
  let nonSystemMessages = incomingBody?.messages || [];
  if (Array.isArray(nonSystemMessages)) {
    const sysIdx = nonSystemMessages.findIndex(m => m.role === 'system');
    if (sysIdx !== -1) {
      systemMsg = nonSystemMessages[sysIdx].content || '';
      nonSystemMessages = nonSystemMessages.filter((_, i) => i !== sysIdx);
    }
  }

  // build body from template or incoming
  let body;
  if (sandbox.body_template) {
    body = structuredClone(sandbox.body_template);
    body = replacePlaceholders(body, {
      '{{MODEL}}': strippedModel || incomingBody?.model || '',
      '{{MESSAGES}}': incomingBody?.messages || [],
      '{{SYSTEM}}': systemMsg,
      '{{NON_SYSTEM_MESSAGES}}': nonSystemMessages,
    });

    // merge any extra fields from incoming that aren't in the template
    if (incomingBody && typeof incomingBody === 'object') {
      for (const [k, v] of Object.entries(incomingBody)) {
        if (k === 'model' || k === 'messages') continue; // already handled
        if (!(k in body)) {
          body[k] = v;
        }
      }
    }
  } else {
    body = { ...incomingBody };
    if (strippedModel) body.model = strippedModel;
  }

  // apply forced fields (override everything)
  if (sandbox.forced_fields) {
    deepMerge(body, sandbox.forced_fields);
  }

  // headers
  const headers = sandbox.headers ? { ...sandbox.headers } : buildDefaultHeaders(provider);

  return { url_path: urlPath, headers, body };
}

export function injectKey(headers, key) {
  const result = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') {
      result[k] = v.replace(/\{\{KEY\}\}/g, key);
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ── helpers ──────────────────────────────────────────────

function buildDefaultHeaders(provider) {
  const h = { 'content-type': 'application/json' };
  const authType = (provider.auth_type || 'bearer').toLowerCase();
  const authHeader = provider.auth_header || 'authorization';

  if (authType === 'bearer') {
    h[authHeader] = 'Bearer {{KEY}}';
  } else if (authType === 'x-api-key') {
    h['x-api-key'] = '{{KEY}}';
  } else {
    // custom — use auth_header as the header name
    h[authHeader] = '{{KEY}}';
  }
  return h;
}

function replacePlaceholders(obj, map) {
  if (typeof obj === 'string') {
    // exact match → return the replacement value directly (preserves type)
    for (const [ph, val] of Object.entries(map)) {
      if (obj === ph) return val;
      if (obj.includes(ph)) {
        obj = obj.replaceAll(ph, typeof val === 'string' ? val : JSON.stringify(val));
      }
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => replacePlaceholders(item, map));
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = replacePlaceholders(v, map);
    }
    return out;
  }
  return obj;
}

function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
}
