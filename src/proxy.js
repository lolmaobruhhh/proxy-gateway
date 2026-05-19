import { Readable } from 'stream';
import { getProvider } from './storage.js';
import { parseCompoundKeys, getNextKey } from './keyManager.js';
import { transformRequest, injectKey } from './transformer.js';
import { recordProxyRequest } from './stats.js';

export async function handleProxy(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  // ── 1. extract prefix from model field ────────────────
  const body = req.body || {};
  const modelRaw = body.model || '';
  const colonIdx = modelRaw.indexOf(':');

  if (!modelRaw || colonIdx === -1) {
    recordProxyRequest(null, ip, true);
    return res.status(400).json({
      error: {
        message: 'Model field must include a provider prefix, e.g. "opn:gpt-4o"',
        type: 'proxy_error',
      }
    });
  }

  const prefix = modelRaw.slice(0, colonIdx).toLowerCase();
  const strippedModel = modelRaw.slice(colonIdx + 1);

  // ── 2. look up provider ───────────────────────────────
  const provider = getProvider(prefix);
  if (!provider) {
    recordProxyRequest(prefix, ip, true);
    return res.status(404).json({
      error: {
        message: `No provider registered with prefix "${prefix}".`,
        type: 'proxy_error',
      }
    });
  }

  // ── 3. gather keys ───────────────────────────────────
  const authHeader = req.headers['authorization'] || '';
  const allKeys = parseCompoundKeys(authHeader);
  const providerKeys = allKeys[prefix] || [];

  // fallback to optional_key from provider config
  if (providerKeys.length === 0 && provider.optional_key) {
    providerKeys.push(provider.optional_key);
  }

  if (providerKeys.length === 0) {
    recordProxyRequest(prefix, ip, true);
    return res.status(401).json({
      error: {
        message: `No API keys for prefix "${prefix}". Send keys as: Authorization: Bearer ${prefix}=key1,key2`,
        type: 'auth_error',
      }
    });
  }

  // ── 4. transform request ──────────────────────────────
  const transformed = transformRequest(body, provider, strippedModel, req.path);

  // ── 5. determine streaming ────────────────────────────
  const clientWantsStream = body.stream === true;
  const upstreamWillStream = transformed.body?.stream === true;

  // ── 6. try keys with fallback ─────────────────────────
  const skipped = new Set();
  let lastError = null;

  while (true) {
    const picked = getNextKey(prefix, providerKeys, skipped);
    if (!picked) break; // all exhausted

    const { key, index } = picked;
    const headers = injectKey(transformed.headers, key);

    const upstreamUrl = provider.upstream_url + transformed.url_path;

    try {
      const fetchOpts = {
        method: req.method === 'GET' ? 'GET' : (req.method || 'POST'),
        headers,
        signal: AbortSignal.timeout(300_000), // 5 min timeout for long generations
      };

      if (fetchOpts.method !== 'GET' && fetchOpts.method !== 'HEAD') {
        fetchOpts.body = JSON.stringify(transformed.body);
      }

      const upstream = await fetch(upstreamUrl, fetchOpts);

      // retryable errors → try next key
      if (upstream.status === 401 || upstream.status === 403 || upstream.status === 429) {
        skipped.add(index);
        lastError = `Key #${index + 1} returned ${upstream.status}`;
        continue;
      }

      // ── success or non-retryable error → forward ────
      const contentType = upstream.headers.get('content-type') || '';
      const isSSE = contentType.includes('text/event-stream');

      // copy response headers
      for (const [hk, hv] of upstream.headers.entries()) {
        const lower = hk.toLowerCase();
        if (['transfer-encoding', 'connection', 'keep-alive', 'content-encoding'].includes(lower)) continue;
        res.setHeader(hk, hv);
      }

      res.status(upstream.status);

      if (clientWantsStream && isSSE) {
        // ── stream → stream (direct pipe) ──────────────
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
          }
        } catch (streamErr) {
          // stream broke mid-way — not retryable
        } finally {
          res.end();
        }

        recordProxyRequest(prefix, ip, upstream.status >= 400);
        return;

      } else if (!clientWantsStream && isSSE) {
        // ── upstream streams but client wants non-stream ─
        // buffer all SSE chunks, reconstruct single response
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let model = strippedModel;
        let finishReason = 'stop';
        let responseId = '';

        try {
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // keep incomplete last line

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                responseId = parsed.id || responseId;
                model = parsed.model || model;
                const delta = parsed.choices?.[0]?.delta?.content || '';
                fullContent += delta;
                if (parsed.choices?.[0]?.finish_reason) {
                  finishReason = parsed.choices[0].finish_reason;
                }
              } catch { /* skip malformed chunks */ }
            }
          }
        } catch { /* stream error during buffering */ }

        res.setHeader('content-type', 'application/json');
        res.json({
          id: responseId || `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: `${prefix}:${model}`,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: fullContent },
            finish_reason: finishReason,
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });

        recordProxyRequest(prefix, ip, upstream.status >= 400);
        return;

      } else {
        // ── non-stream → non-stream (passthrough) ──────
        const responseBody = await upstream.text();
        res.send(responseBody);

        recordProxyRequest(prefix, ip, upstream.status >= 400);
        return;
      }

    } catch (fetchErr) {
      skipped.add(index);
      lastError = fetchErr.message;
      continue;
    }
  }

  // ── all keys exhausted ──────────────────────────────
  recordProxyRequest(prefix, ip, true);
  res.status(502).json({
    error: {
      message: `All ${providerKeys.length} key(s) for "${prefix}" failed. Last error: ${lastError}`,
      type: 'proxy_error',
    }
  });
}
