import { getProvider } from './storage.js';
import { parseCompoundKeys, getNextKey } from './keyManager.js';
import { transformRequest, injectKey } from './transformer.js';
import { recordProxyRequest } from './stats.js';

export async function handleProxy(req, res) {
  var ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket ? req.socket.remoteAddress : 'unknown') || 'unknown';

  var body = req.body || {};
  var modelRaw = body.model || '';
  var colonIdx = modelRaw.indexOf(':');

  if (!modelRaw || colonIdx === -1) {
    recordProxyRequest(null, ip, true);
    return res.status(400).json({
      error: {
        message: 'Model field must include a provider prefix, e.g. "opn:gpt-4o"',
        type: 'proxy_error',
      }
    });
  }

  var prefix = modelRaw.slice(0, colonIdx).toLowerCase();
  var strippedModel = modelRaw.slice(colonIdx + 1);

  var provider = getProvider(prefix);
  if (!provider) {
    recordProxyRequest(prefix, ip, true);
    return res.status(404).json({
      error: {
        message: 'No provider registered with prefix "' + prefix + '".',
        type: 'proxy_error',
      }
    });
  }

  var authHeader = req.headers['authorization'] || '';
  var allKeys = parseCompoundKeys(authHeader);
  var providerKeys = allKeys[prefix] || [];

  if (providerKeys.length === 0 && provider.optional_key) {
    providerKeys.push(provider.optional_key);
  }

  if (providerKeys.length === 0) {
    recordProxyRequest(prefix, ip, true);
    return res.status(401).json({
      error: {
        message: 'No API keys for prefix "' + prefix + '". Send keys as: Authorization: Bearer ' + prefix + '=key1,key2',
        type: 'auth_error',
      }
    });
  }

  // Transform — passes all 6 args including req.method
  var transformed = transformRequest(body, provider, strippedModel, req.path, req.headers, req.method);
  var clientWantsStream = body.stream === true;

  var skipped = new Set();
  var lastError = null;

  while (true) {
    var picked = getNextKey(prefix, providerKeys, skipped);
    if (!picked) break;

    var key = picked.key;
    var index = picked.index;
    var headers = injectKey(transformed.headers, key);

    // Build upstream URL
    var upstreamUrl;
    if (transformed.url) {
      upstreamUrl = transformed.url.replace(/{{KEY}}/g, key);
    } else {
      upstreamUrl = provider.upstream_url + transformed.url_path;
    }

    var httpMethod = transformed.method || (req.method === 'GET' ? 'GET' : (req.method || 'POST'));

    try {
      var fetchOpts = {
        method: httpMethod,
        headers: headers,
        signal: AbortSignal.timeout(300000),
      };

      if (httpMethod !== 'GET' && httpMethod !== 'HEAD') {
        fetchOpts.body = JSON.stringify(transformed.body);
      }

      var upstream = await fetch(upstreamUrl, fetchOpts);

      if (upstream.status === 401 || upstream.status === 403 || upstream.status === 429) {
        skipped.add(index);
        lastError = 'Key #' + (index + 1) + ' returned ' + upstream.status;
        continue;
      }

      var contentType = upstream.headers.get('content-type') || '';
      var isSSE = contentType.indexOf('text/event-stream') !== -1;

      for (var pair of upstream.headers.entries()) {
        var hk = pair[0];
        var hv = pair[1];
        var lower = hk.toLowerCase();
        if (['transfer-encoding', 'connection', 'keep-alive', 'content-encoding'].indexOf(lower) !== -1) continue;
        res.setHeader(hk, hv);
      }

      res.status(upstream.status);

      if (clientWantsStream && isSSE) {
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');

        var reader = upstream.body.getReader();
        var decoder = new TextDecoder();
        try {
          while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;
            res.write(decoder.decode(chunk.value, { stream: true }));
          }
        } catch (e) {
          console.error('[proxy] stream error:', e.message);
        } finally {
          res.end();
        }
        recordProxyRequest(prefix, ip, upstream.status >= 400);
        return;

      } else if (!clientWantsStream && isSSE) {
        var reader2 = upstream.body.getReader();
        var decoder2 = new TextDecoder();
        var fullContent = '';
        var rModel = strippedModel;
        var finishReason = 'stop';
        var responseId = '';
        try {
          var buffer = '';
          while (true) {
            var chunk2 = await reader2.read();
            if (chunk2.done) break;
            buffer += decoder2.decode(chunk2.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (var li = 0; li < lines.length; li++) {
              var line = lines[li];
              if (line.indexOf('data: ') !== 0) continue;
              var data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                var parsed = JSON.parse(data);
                responseId = parsed.id || responseId;
                rModel = parsed.model || rModel;
                var delta = '';
                if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                  delta = parsed.choices[0].delta.content || '';
                }
                fullContent += delta;
                if (parsed.choices && parsed.choices[0] && parsed.choices[0].finish_reason) {
                  finishReason = parsed.choices[0].finish_reason;
                }
              } catch (pe) {}
            }
          }
        } catch (bufErr) {}

        res.setHeader('content-type', 'application/json');
        res.json({
          id: responseId || 'chatcmpl-' + Date.now(),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: prefix + ':' + rModel,
          choices: [{ index: 0, message: { role: 'assistant', content: fullContent }, finish_reason: finishReason }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
        recordProxyRequest(prefix, ip, upstream.status >= 400);
        return;

      } else {
        var responseBody = await upstream.text();
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

  recordProxyRequest(prefix, ip, true);
  res.status(502).json({
    error: {
      message: 'All ' + providerKeys.length + ' key(s) for "' + prefix + '" failed. Last error: ' + lastError,
      type: 'proxy_error',
    }
  });
}
