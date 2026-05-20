import vm from 'vm';

export function runSandboxCode(code, reqBody, features, provider) {
  var result = {
    body: reqBody,
    handled: {}
  };

  if (!code || typeof code !== 'string' || !code.trim()) {
    return result;
  }

  try {
    // Clean code — handle module.exports = pattern
    var cleanCode = code.trim();
    cleanCode = cleanCode.replace(/^module\.exports\s*=\s*/, 'var __fn = ');
    if (cleanCode.indexOf('var __fn') !== 0) {
      cleanCode = 'var __fn = ' + cleanCode;
    }
    cleanCode += '\n__result = __fn(__req, __features, __provider);';

    // Safe copies
    var safeReq = JSON.parse(JSON.stringify(reqBody));
    var safeFeatures = JSON.parse(JSON.stringify(features));
    var safeProvider = {
      prefix: provider.prefix,
      name: provider.name,
      upstream_url: provider.upstream_url,
      auth_type: provider.auth_type
    };

    var context = vm.createContext({
      __req: safeReq,
      __features: safeFeatures,
      __provider: safeProvider,
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
      Date: Date,
      console: {
        log: function() {},
        error: function() {},
        warn: function() {}
      }
    });

    var script = new vm.Script(cleanCode);
    script.runInContext(context, { timeout: 5000 });

    if (context.__result) {
      // Support both { body, handled } and just modified body
      if (context.__result.body) {
        result.body = context.__result.body;
        result.handled = context.__result.handled || {};
      } else {
        // User returned the body directly
        result.body = context.__result;
        result.handled = {};
      }
    }
  } catch (e) {
    console.error('[sandbox-code] execution error:', e.message);
    // Fallback to original body on error
    result.body = reqBody;
    result.handled = {};
  }

  return result;
}
