import vm from 'vm';
import { getProvider } from './storage.js';
import { parseCompoundKeys, getNextKey } from './keyManager.js';
import { transformRequest, injectKey } from './transformer.js';
import { recordProxyRequest } from './stats.js';

// ── BUILT-IN PARSERS (convenience shortcuts) ────────────────
// Each returns extracted text string or null to skip

function parseGeminiChunk(data) {
  try {
    var g = JSON.parse(data);
    if (!g.candidates || !g.candidates[0] || !g.candidates[0].content) return null;
    var parts = g.candidates[0].content.parts;
    var text = '';
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].text) text += parts[i].text;
      if (parts[i].thought) text += parts[i].thought;
    }
    return text || null;
  } catch (e) { return null; }
}

function parseAnthropicChunk(data, eventType) {
  try {
    var a = JSON.parse(data);
    if (eventType === 'content_block_delta') {
      return (a.delta && (a.delta.text || a.delta.thinking)) || null;
    }
    return null;
  } catch (e) { return null; }
}

function parseGeminiFull(responseBody) {
  try {
    var g = JSON.parse(responseBody);
    var text = '';
    if (g.candidates && g.candidates[0] && g.candidates[0].content && g.candidates[0].content.parts) {
      for (var i = 0; i < g.candidates[0].content.parts.length; i++) {
        var p = g.candidates[0].content.parts[i];
        if (p.text) text += p.text;
        if (p.thought) text += p.thought;
      }
    }
    return text;
  } catch (e) { return null; }
}

function parseAnthropicFull(responseBody) {
  try {
    var a = JSON.parse(responseBody);
    var text = '';
    if (a.content && Array.isArray(a.content)) {
      for (var i = 0; i < a.content.length; i++) {
        if (a.content[i].type === 'text') text += a.content[i].text;
        if (a.content[i].type === 'thinking') text += a.content[i].thinking;
      }
    }
    return text;
  } catch (e) { return null; }
}

// ── COMPILE CUSTOM PARSER ───────────────────────────────────
// Compiles a user-provided parser function string into a callable function
// Runs in a sandboxed VM context for safety

function compileCustomParser(parserStr) {
  if (!parserStr || typeof parserStr !== 'string') return null;
  try {
    var code = 'var __parser = ' + parserStr.trim() + ';';
    var ctx = vm.createContext({
      JSON: JSON, Array: Array, Object: Object, String: String,
      Number: Number, Math: Math, parseInt: parseInt, parseFloat: parseFloat,
      isNaN: isNaN, Date: Date, RegExp: RegExp
    });
    var script = new vm.Script(code);
    script.runInContext(ctx, { timeout: 1000 });
    if (typeof ctx.__parser === 'function') {
      return function(data, eventType) {
        try {
          ctx.__data = data;
          ctx.__event = eventType || '';
          var runScript = new vm.Script('__result = __parser(__data, __event);');
          runScript.runInContext(ctx, { timeout: 500 });
          return ctx.__result || null;
        } catch (e) {
          return null;
        }
      };
    }
    return null;
  } catch (e) {
    console.error('[proxy] failed to compile custom parser:', e.message);
    return null;
  }
}

// ── MAIN PROXY HANDLER ──────────────────────────────────────

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

  var transformed = transformRequest(body, provider, strippedModel, req.path, req.headers, req.method);
  var clientWantsStream = body.stream === true;
  var responseFormat = (transformed.response_format || 'openai').toLowerCase();

  // Compile custom parser if provided
  var customParser = null;
  if (responseFormat === 'custom' && transformed.response_parser) {
    customParser = compileCustomParser(transformed.response_parser);
    if (!customParser) {
      console.error('[proxy] custom parser compilation failed, falling back to raw');
      responseFormat = 'raw';
    }
  }

  // Select the chunk parser function
  var chunkParser = null;
  if (responseFormat === 'gemini') {
    chunkParser = parseGeminiChunk;
  } else if (responseFormat === 'anthropic') {
    chunkParser = parseAnthropicChunk;
  } else if (responseFormat === 'custom' && customParser) {
    chunkParser = customParser;
  }

  var skipped = new Set();
  var lastError = null;

  while (true) {
    var picked = getNextKey(prefix, providerKeys, skipped);
    if (!picked) break;

    var key = picked.key;
    var index = picked.index;
    var headers = injectKey(transformed.headers, key);

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

      // ── RAW MODE ──────────────────────────────────────────
      if (responseFormat === 'raw') {
        if (isSSE) {
          res.setHeader('content-type', 'text/event-stream');
          var rawReader = upstream.body.getReader();
          var rawDecoder = new TextDecoder();
          try {
            while (true) {
              var rawChunk = await rawReader.read();
              if (rawChunk.done) break;
              res.write(rawDecoder.decode(rawChunk.value, { stream: true }));
            }
          } catch (e) {}
          res.end();
        } else {
          var rawBody = await upstream.text();
          res.send(rawBody);
        }
        recordProxyRequest(prefix, ip, upstream.status >= 400);
        return;
      }

      // ── STREAMING ─────────────────────────────────────────
      if (clientWantsStream && isSSE) {
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');

        var reader = upstream.body.getReader();
        var decoder = new TextDecoder();
        var streamBuffer = '';
        var streamId = 'chatcmpl-' + Date.now();
        var fullModel = prefix + ':' + strippedModel;

        try {
          while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;

            var textChunk = decoder.decode(chunk.value, { stream: true });

            // OpenAI format — direct passthrough
            if (responseFormat === 'openai') {
              res.write(textChunk);
              continue;
            }

            // Non-OpenAI — parse and translate
            streamBuffer += textChunk;
            var lines = streamBuffer.split('\n');
            streamBuffer = lines.pop() || '';

            var currentEventType = '';

            for (var li = 0; li < lines.length; li++) {
              var line = lines[li].trim();

              if (line.indexOf('event: ') === 0) {
                currentEventType = line.slice(7).trim();
                continue;
              }

              if (line.indexOf('data: ') !== 0) continue;
              var dataStr = line.slice(6).trim();
              if (dataStr === '[DONE]') {
                res.write('data: [DONE]\n\n');
                continue;
              }

              // Use the selected parser
              var extractedText = chunkParser ? chunkParser(dataStr, currentEventType) : null;

              if (extractedText) {
                var openaiChunk = {
                  id: streamId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: fullModel,
                  choices: [{
                    index: 0,
                    delta: { content: extractedText },
                    finish_reason: null
                  }]
                };
                res.write('data: ' + JSON.stringify(openaiChunk) + '\n\n');
              }
            }
          }

          // Send final DONE
          if (responseFormat !== 'openai') {
            res.write('data: [DONE]\n\n');
          }
        } catch (e) {
          console.error('[proxy] stream error:', e.message);
        } finally {
          res.end();
        }
        recordProxyRequest(prefix, ip, upstream.status >= 400);
        return;
      }

      // ── NON-STREAM SSE (buffer to single JSON) ────────────
      if (!clientWantsStream && isSSE) {
        var reader2 = upstream.body.getReader();
        var decoder2 = new TextDecoder();
        var fullContent = '';
        var rModel = strippedModel;
        var finishReason = 'stop';
        var responseId = '';
        var currentEventType2 = '';

        try {
          var buffer2 = '';
          while (true) {
            var chunk2 = await reader2.read();
            if (chunk2.done) break;
            buffer2 += decoder2.decode(chunk2.value, { stream: true });
            var lines2 = buffer2.split('\n');
            buffer2 = lines2.pop() || '';

            for (var li2 = 0; li2 < lines2.length; li2++) {
              var line2 = lines2[li2].trim();

              if (line2.indexOf('event: ') === 0) {
                currentEventType2 = line2.slice(7).trim();
                continue;
              }

              if (line2.indexOf('data: ') !== 0) continue;
              var data2 = line2.slice(6).trim();
              if (data2 === '[DONE]') continue;

              if (chunkParser) {
                var extracted = chunkParser(data2, currentEventType2);
                if (extracted
