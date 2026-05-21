import { parseFeatures, applyThinkConfig, applySearchConfig } from './features.js';
import { runSandboxCode } from './sandboxRunner.js';

export function transformRequest(incomingBody, provider, strippedModel, requestPath, reqHeaders, reqMethod) {
  // 1. Parse and strip ALL [key=value] tags from messages
  var features = parseFeatures(incomingBody, reqHeaders);
  var hasFeatures = Object.keys(features).length > 0;

  if (hasFeatures) {
    console.log('[transform] detected features:', JSON.stringify(features));
  }

  // 2. Run sandbox code if present
  var handled = {};
  var workingBody = JSON.parse(JSON.stringify(incomingBody));
  var codeOverrides = {
    url: null,
    url_path: null,
    headers: null,
    method: null,
  };

  if (provider.sandbox_code) {
    var requestContext = {
      path: requestPath,
      method: reqMethod || 'POST',
      original_model: incomingBody.model || '',
      stripped_model: strippedModel || '',
    };

    var codeResult = runSandboxCode(provider.sandbox_code, workingBody, features, provider, requestContext);
    workingBody = codeResult.body;
    handled = codeResult.handled;
    codeOverrides.url = codeResult.url;
    codeOverrides.url_path = codeResult.url_path;
    codeOverrides.headers = codeResult.headers;
    codeOverrides.method = codeResult.method;

    console.log('[transform] sandbox code handled:', JSON.stringify(handled));
    if (codeOverrides.url) console.log('[transform] sandbox code override url:', codeOverrides.url);
    if (codeOverrides.url_path) console.log('[transform] sandbox code override path:', codeOverrides.url_path);
    if (codeOverrides.headers) console.log('[transform] sandbox code override headers:', JSON.stringify(Object.keys(codeOverrides.headers)));
    if (codeOverrides.method) console.log('[transform] sandbox code override method:', codeOverrides.method);
  }

  // 3. Apply think_config for unhandled thinking
  if (features.think && !handled.think && provider.think_config) {
    applyThinkConfig(workingBody, features.think, provider.think_config);
    console.log('[transform] applied think_config for:', features.think);
  }

  // 4. Apply search_config for unhandled search
  if (features.search && !handled.search && provider.search_config) {
    applySearchConfig(workingBody, features.search, provider.search_config);
    console.log('[transform] applied search_config for:', features.search);
  }

  // 5. Apply sandbox JSON template or default passthrough
  var sandbox = provider.sandbox || null;

  if (!sandbox) {
    if (strippedModel) workingBody.model = strippedModel;

    var defaultHeaders = buildDefaultHeaders(provider);
    if (codeOverrides.headers) {
      for (var hk in codeOverrides.headers) {
        defaultHeaders[hk] = codeOverrides.headers[hk];
      }
    }

    return {
      url: codeOverrides.url || null,
      url_path: codeOverrides.url_path || requestPath,
      headers: defaultHeaders,
      body: workingBody,
      method: codeOverrides.method || null,
    };
  }

  // Sandbox JSON present
  var urlPath = codeOverrides.url_path || sandbox.url_path || requestPath;

  var systemMsg = '';
  var nonSystemMessages = workingBody.messages || [];
  if (Array.isArray(nonSystemMessages)) {
    var sysIdx = -1;
    for (var i = 0; i < nonSystemMessages.length; i++) {
      if (nonSystemMessages[i].role === 'system') { sysIdx = i; break; }
    }
    if (sysIdx !== -1) {
      systemMsg = nonSystemMessages[sysIdx].content || '';
      nonSystemMessages = nonSystemMessages.filter(function(_, idx) { return idx !== sysIdx; });
    }
  }

  var body;
  if (sandbox.body_template) {
    body = JSON.parse(JSON.stringify(sandbox.body_template));
    body = replacePlaceholders(body, {
      '{{MODEL}}': strippedModel || workingBody.model || '',
      '{{MESSAGES}}': workingBody.messages || [],
      '{{SYSTEM_MESSAGE}}': systemMsg,
      '{{NON_SYSTEM_MESSAGES}}': nonSystemMessages,
    });

    if (workingBody && typeof workingBody === 'object') {
      var templateKeys = Object.keys(body);
      for (var key in workingBody) {
        if (key === 'model' || key === 'messages') continue;
        if (templateKeys.indexOf(key) === -1) {
          body[key] = workingBody[key];
        }
      }
    }
  } else {
    body = JSON.parse(JSON.stringify(workingBody));
    if (strippedModel) body.model = strippedModel;
  }

  if (sandbox.forced_fields) {
    deepMerge(body, sandbox.forced_fields);
  }

  var headers = sandbox.headers ? JSON.parse(JSON.stringify(sandbox.headers)) : buildDefaultHeaders(provider);
  if (codeOverrides.headers) {
    for (var hk2 in codeOverrides.headers) {
      headers[hk2] = codeOverrides.headers[hk2];
    }
  }

  return {
    url: codeOverrides.url || null,
    url_path: urlPath,
    headers: headers,
    body: body,
    method: codeOverrides.method || null,
  };
}

export function injectKey(headers, key) {
  var result = {};
  for (var k in headers) {
    if (typeof headers[k] === 'string') {
      result[k] = headers[k].replace(/{{KEY}}/g, key);
    } else {
      result[k] = headers[k];
    }
  }
  return result;
}

function buildDefaultHeaders(provider) {
  var h = { 'content-type': 'application/json' };
  var authType = (provider.auth_type || 'bearer').toLowerCase();
  var authHeader = provider.auth_header || 'authorization';

  if (authType === 'bearer') {
    h[authHeader] = 'Bearer {{KEY}}';
  } else if (authType === 'x-api-key') {
    h['x-api-key'] = '{{KEY}}';
  } else {
    h[authHeader] = '{{KEY}}';
  }
  return h;
}

function replacePlaceholders(obj, map) {
  if (typeof obj === 'string') {
    for (var ph in map) {
      if (obj === ph) return map[ph];
      if (obj.indexOf(ph) !== -1) {
        var val = map[ph];
        obj = obj.split(ph).join(typeof val === 'string' ? val : JSON.stringify(val));
      }
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(function(item) { return replacePlaceholders(item, map); });
  }
  if (obj && typeof obj === 'object') {
    var out = {};
    for (var k in obj) {
      out[k] = replacePlaceholders(obj[k], map);
    }
    return out;
  }
  return obj;
}

function deepMerge(target, source) {
  for (var k in source) {
    var v = source[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
}
