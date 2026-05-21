import vm from 'vm';

export function runSandboxCode(code, reqBody, features, provider, requestContext) {
  var result = {
    body: reqBody,
    handled: {},
    url: null,
    url_path: null,
    headers: null,
    method: null,
  };

  if (!code || typeof code !== 'string' || !code.trim()) {
    return result;
  }

  try {
    var cleanCode = code.trim();
    cleanCode = cleanCode.replace(/^module\.exports\s*=\s*/, 'var __fn = ');
    if (cleanCode.indexOf('var __fn') !== 0) {
      cleanCode = 'var __fn = ' + cleanCode;
    }
    cleanCode += '\n__result = __fn(__req, __features, __provider, __context);';

    var safeReq = JSON.parse(JSON.stringify(reqBody));
    var safeFeatures = JSON.parse(JSON.stringify(features));
    var safeProvider = {
      prefix: provider.prefix,
      name: provider.name,
      upstream_url: provider.upstream_url,
      auth_type: provider.auth_type,
      auth_header: provider.auth_header || 'authorization',
      models_endpoint: provider.models_endpoint || '/v1/models'
    };
    var safeContext = {
      path: (requestContext && requestContext.path) || '/v1/chat/completions',
      method: (requestContext && requestContext.method) || 'POST',
      original_model: (requestContext && requestContext.original_model) || '',
      stripped_model: (requestContext && requestContext.stripped_model) || '',
    };

    var context = vm.createContext({
      __req: safeReq,
      __features: safeFeatures,
      __provider: safeProvider,
      __context: safeContext,
      __result: null,
      JSON: JSON,
      Array: Array,
      Object: Object,
      String: String,
      Number: Number,
      Math: Math,
      parseInt: parseInt,
      parseFloat: parseFloat,
      isNaN: isNaN,
      isFinite: isFinite,
      Date: Date,
      RegExp: RegExp,
      Error: Error,
      encodeURIComponent: encodeURIComponent,
      decodeURIComponent: decodeURIComponent,
      encodeURI: encodeURI,
      decodeURI: decodeURI,
      console: {
        log: function() {},
        error: function() {},
        warn: function() {}
      }
    });

    var script = new vm.Script(cleanCode);
    script.runInContext(context, { timeout: 5000 });

    if (context.__result) {
      var r = context.__result;

      if (r.body) {
        result.body = r.body;
      } else if (!r.handled && !r.url && !r.url_path && !r.headers && !r.method) {
        result.body = r;
      }

      if (r.handled) result.handled = r.handled;
      if (r.url) result.url = String(r.url);
      if (r.url_path) result.url_path = String(r.url_path);
      if (r.method) result.method = String(r.method).toUpperCase();
      if (r.headers && typeof r.headers === 'object') {
        result.headers = {};
        for (var hk in r.headers) {
          result.headers[hk.toLowerCase()] = String(r.headers[hk]);
        }
      }
    }
  } catch (e) {
    console.error('[sandbox-code] execution error:', e.message);
    result.body = reqBody;
    result.handled = {};
  }

  return result;
}
